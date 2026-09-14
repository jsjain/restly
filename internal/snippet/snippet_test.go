package snippet

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"restly/internal/httpx"
)

type recordedRequest struct {
	method       string
	pathAndQuery string
	header       http.Header
	body         []byte
}

func startRecordingServer(t *testing.T) (*httptest.Server, *recordedRequest) {
	t.Helper()
	recorded := &recordedRequest{}
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(responseWriter, fmt.Sprintf("read request body: %v", err), http.StatusInternalServerError)
			return
		}
		recorded.method = request.Method
		recorded.pathAndQuery = request.URL.RequestURI()
		recorded.header = request.Header.Clone()
		recorded.body = body
		responseWriter.WriteHeader(http.StatusOK)
		fmt.Fprint(responseWriter, "ok")
	}))
	t.Cleanup(server.Close)
	return server, recorded
}

func assertEqual[T comparable](t *testing.T, label string, got, want T) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: got %v, want %v", label, got, want)
	}
}

func requireTool(t *testing.T, name string) {
	t.Helper()
	if _, err := exec.LookPath(name); err != nil {
		t.Skipf("%s not found in PATH: %v", name, err)
	}
}

func writeTempFile(t *testing.T, name, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
	return path
}

// parseMultipart re-derives the boundary from the recorded Content-Type header, since
// curl and the generated Go program each pick a fresh random boundary per run.
func parseMultipart(t *testing.T, recorded *recordedRequest) (fields map[string]string, files map[string][]byte) {
	t.Helper()
	_, params, err := mime.ParseMediaType(recorded.header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("parse content-type: %v", err)
	}

	fields = map[string]string{}
	files = map[string][]byte{}
	reader := multipart.NewReader(bytes.NewReader(recorded.body), params["boundary"])
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("read multipart part: %v", err)
		}
		data, err := io.ReadAll(part)
		if err != nil {
			t.Fatalf("read multipart part body: %v", err)
		}
		if part.FileName() != "" {
			files[part.FormName()] = data
		} else {
			fields[part.FormName()] = string(data)
		}
	}
	return fields, files
}

func TestGenerateUnknownLang(t *testing.T) {
	prep := &httpx.Prepared{Method: "GET", URL: "https://example.com"}
	cases := []string{"", "ruby", "CURL", "Go", "httpie"}
	for _, lang := range cases {
		t.Run(lang, func(t *testing.T) {
			if _, err := Generate(lang, prep); err == nil {
				t.Fatalf("Generate(%q): expected error, got nil", lang)
			}
		})
	}
}

func runCurlSnippet(t *testing.T, prep *httpx.Prepared) {
	t.Helper()
	snippetText, err := Generate("curl", prep)
	if err != nil {
		t.Fatalf("Generate(curl): %v", err)
	}
	// --silent/--output keep the response body out of the test log; the server side
	// recording is what the assertions check.
	script := snippetText + " --silent --output /dev/null"
	output, err := exec.Command("sh", "-c", script).CombinedOutput()
	if err != nil {
		t.Fatalf("run curl snippet: %v\noutput: %s\nsnippet:\n%s", err, output, snippetText)
	}
}

func TestGenerateCurlRoundTrip(t *testing.T) {
	requireTool(t, "curl")

	t.Run("raw json body with quote and newline", func(t *testing.T) {
		server, recorded := startRecordingServer(t)
		body := []byte("{\n  \"name\": \"O'Brien\"\n}")
		prep := &httpx.Prepared{
			Method: "POST",
			URL:    server.URL + "/things?x=1",
			Header: []httpx.Header{{Key: "Content-Type", Value: "application/json"}},
			Body:   body,
		}
		runCurlSnippet(t, prep)

		assertEqual(t, "method", recorded.method, "POST")
		assertEqual(t, "path and query", recorded.pathAndQuery, "/things?x=1")
		assertEqual(t, "content-type header", recorded.header.Get("Content-Type"), "application/json")
		assertEqual(t, "body", string(recorded.body), string(body))
	})

	t.Run("urlencoded body", func(t *testing.T) {
		server, recorded := startRecordingServer(t)
		body := []byte("a=1&b=two+words")
		prep := &httpx.Prepared{
			Method: "POST",
			URL:    server.URL + "/form",
			Header: []httpx.Header{{Key: "Content-Type", Value: "application/x-www-form-urlencoded"}},
			Body:   body,
		}
		runCurlSnippet(t, prep)

		assertEqual(t, "method", recorded.method, "POST")
		assertEqual(t, "body", string(recorded.body), string(body))
	})

	t.Run("form with text and file part", func(t *testing.T) {
		server, recorded := startRecordingServer(t)
		filePath := writeTempFile(t, "curl-upload.txt", "file contents\nwith a newline")
		prep := &httpx.Prepared{
			Method: "POST",
			URL:    server.URL + "/upload",
			Form: []httpx.FormPart{
				{Key: "title", Value: "restly"},
				{Key: "file", File: filePath, ContentType: "text/plain"},
			},
		}
		runCurlSnippet(t, prep)

		assertEqual(t, "method", recorded.method, "POST")
		fields, files := parseMultipart(t, recorded)
		assertEqual(t, "form field title", fields["title"], "restly")
		assertEqual(t, "form file contents", string(files["file"]), "file contents\nwith a newline")
	})

	t.Run("body file", func(t *testing.T) {
		server, recorded := startRecordingServer(t)
		filePath := writeTempFile(t, "curl-body.bin", "raw file body")
		prep := &httpx.Prepared{
			Method:   "PUT",
			URL:      server.URL + "/file",
			BodyFile: filePath,
		}
		runCurlSnippet(t, prep)

		assertEqual(t, "method", recorded.method, "PUT")
		assertEqual(t, "body", string(recorded.body), "raw file body")
	})
}

func runGoSnippet(t *testing.T, prep *httpx.Prepared) {
	t.Helper()
	snippetText, err := Generate("go", prep)
	if err != nil {
		t.Fatalf("Generate(go): %v", err)
	}
	mainPath := filepath.Join(t.TempDir(), "main.go")
	if err := os.WriteFile(mainPath, []byte(snippetText), 0o644); err != nil {
		t.Fatalf("write generated go program: %v", err)
	}
	output, err := exec.Command("go", "run", mainPath).CombinedOutput()
	if err != nil {
		t.Fatalf("run generated go program: %v\noutput: %s\nsnippet:\n%s", err, output, snippetText)
	}
}

func TestGenerateGoRoundTrip(t *testing.T) {
	requireTool(t, "go")

	t.Run("raw body", func(t *testing.T) {
		server, recorded := startRecordingServer(t)
		body := []byte("{\n  \"key\": \"value\"\n}")
		prep := &httpx.Prepared{
			Method: "POST",
			URL:    server.URL + "/go/raw",
			Header: []httpx.Header{{Key: "Content-Type", Value: "application/json"}},
			Body:   body,
		}
		runGoSnippet(t, prep)

		assertEqual(t, "method", recorded.method, "POST")
		assertEqual(t, "body", string(recorded.body), string(body))
	})

	t.Run("form", func(t *testing.T) {
		server, recorded := startRecordingServer(t)
		filePath := writeTempFile(t, "go-upload.txt", "go form file contents")
		prep := &httpx.Prepared{
			Method: "POST",
			URL:    server.URL + "/go/form",
			Form: []httpx.FormPart{
				{Key: "title", Value: "hello"},
				{Key: "file", File: filePath, ContentType: "text/plain"},
			},
		}
		runGoSnippet(t, prep)

		assertEqual(t, "method", recorded.method, "POST")
		fields, files := parseMultipart(t, recorded)
		assertEqual(t, "form field title", fields["title"], "hello")
		assertEqual(t, "form file contents", string(files["file"]), "go form file contents")
	})
}

func TestGeneratePythonRoundTrip(t *testing.T) {
	if err := exec.Command("python3", "-c", "import requests").Run(); err != nil {
		t.Skipf("python3 requests module not available: %v", err)
	}

	server, recorded := startRecordingServer(t)
	body := []byte("{\n  \"key\": \"value\"\n}")
	prep := &httpx.Prepared{
		Method: "POST",
		URL:    server.URL + "/python/raw",
		Header: []httpx.Header{{Key: "Content-Type", Value: "application/json"}},
		Body:   body,
	}
	snippetText, err := Generate("python", prep)
	if err != nil {
		t.Fatalf("Generate(python): %v", err)
	}
	scriptPath := filepath.Join(t.TempDir(), "snippet.py")
	if err := os.WriteFile(scriptPath, []byte(snippetText), 0o644); err != nil {
		t.Fatalf("write python snippet: %v", err)
	}
	output, err := exec.Command("python3", scriptPath).CombinedOutput()
	if err != nil {
		t.Fatalf("run python snippet: %v\noutput: %s\nsnippet:\n%s", err, output, snippetText)
	}

	assertEqual(t, "method", recorded.method, "POST")
	assertEqual(t, "body", string(recorded.body), string(body))
}

func TestGenerateFetchRoundTrip(t *testing.T) {
	requireTool(t, "node")

	server, recorded := startRecordingServer(t)
	body := []byte("{\n  \"key\": \"value\"\n}")
	prep := &httpx.Prepared{
		Method: "POST",
		URL:    server.URL + "/fetch/raw",
		Header: []httpx.Header{{Key: "Content-Type", Value: "application/json"}},
		Body:   body,
	}
	snippetText, err := Generate("fetch", prep)
	if err != nil {
		t.Fatalf("Generate(fetch): %v", err)
	}
	scriptPath := filepath.Join(t.TempDir(), "snippet.js")
	if err := os.WriteFile(scriptPath, []byte(snippetText), 0o644); err != nil {
		t.Fatalf("write fetch snippet: %v", err)
	}
	output, err := exec.Command("node", scriptPath).CombinedOutput()
	if err != nil {
		t.Fatalf("run fetch snippet: %v\noutput: %s\nsnippet:\n%s", err, output, snippetText)
	}

	assertEqual(t, "method", recorded.method, "POST")
	assertEqual(t, "body", string(recorded.body), string(body))
}
