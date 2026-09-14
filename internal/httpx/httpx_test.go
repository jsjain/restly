package httpx

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"restly/internal/collection"
	"restly/internal/vars"
)

// assertEqual is the one typed helper the spec asks for, used instead of repeating if-blocks.
func assertEqual[T comparable](t *testing.T, label string, got, want T) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: got %v, want %v", label, got, want)
	}
}

func mustRequest(t *testing.T, jsonText string) *collection.Request {
	t.Helper()
	var req collection.Request
	if err := json.Unmarshal([]byte(jsonText), &req); err != nil {
		t.Fatalf("failed to unmarshal request: %v", err)
	}
	return &req
}

func mustAuth(t *testing.T, jsonText string) *collection.Auth {
	t.Helper()
	var auth collection.Auth
	if err := json.Unmarshal([]byte(jsonText), &auth); err != nil {
		t.Fatalf("failed to unmarshal auth: %v", err)
	}
	return &auth
}

func scopeWith(values map[string]string) *vars.Scope {
	scope := vars.New()
	scope.Environment = values
	return scope
}

func headerValue(headers []Header, key string) (string, bool) {
	for _, header := range headers {
		if header.Key == key {
			return header.Value, true
		}
	}
	return "", false
}

func TestResolve_VariableSubstitutionInURLHeaderAndBody(t *testing.T) {
	req := mustRequest(t, `{
		"method": "post",
		"url": {"raw": "{{base}}/items"},
		"header": [{"key": "X-Token", "value": "{{token}}"}],
		"body": {"mode": "raw", "raw": "hello {{name}}"}
	}`)
	scope := scopeWith(map[string]string{"base": "http://example.com", "token": "abc123", "name": "world"})

	prep, err := Resolve(req, nil, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	assertEqual(t, "method", prep.Method, "POST")
	assertEqual(t, "url", prep.URL, "http://example.com/items")
	value, ok := headerValue(prep.Header, "X-Token")
	if !ok {
		t.Fatal("X-Token header missing")
	}
	assertEqual(t, "header value", value, "abc123")
	assertEqual(t, "body", string(prep.Body), "hello world")
}

func TestResolve_QueryArrayReplacesRawQuery(t *testing.T) {
	req := mustRequest(t, `{
		"method": "GET",
		"url": {
			"raw": "http://example.com/search?old=1",
			"query": [
				{"key": "q", "value": "{{term}}"},
				{"key": "skip", "value": "yes", "disabled": true},
				{"key": "page", "value": "2"},
				{"key": "a=b", "value": "x y&z=1"}
			]
		}
	}`)
	scope := scopeWith(map[string]string{"term": "cats"})

	prep, err := Resolve(req, nil, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	// The last entry pins the percent-encoding rules: "=" only encoded in a key,
	// space and "&" always encoded.
	assertEqual(t, "url", prep.URL, "http://example.com/search?q=cats&page=2&a%3Db=x%20y%26z=1")
}

// The editors keep rows the user added but never filled, so the sender must drop them.
func TestResolve_SkipsEmptyRows(t *testing.T) {
	req := mustRequest(t, `{
		"method": "POST",
		"url": {
			"raw": "http://example.com/search",
			"query": [{"key": "", "value": ""}, {"key": "q", "value": "x"}, {"key": "", "value": "only-value"}]
		},
		"body": {"mode": "urlencoded", "urlencoded": [{"key": "", "value": ""}, {"key": "a", "value": "1"}, {"key": "", "value": "orphan"}]}
	}`)
	prep, err := Resolve(req, nil, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	assertEqual(t, "url", prep.URL, "http://example.com/search?q=x")
	assertEqual(t, "body", string(prep.Body), "a=1")

	form := mustRequest(t, `{
		"method": "POST",
		"url": {"raw": "http://example.com/upload"},
		"body": {"mode": "formdata", "formdata": [{"key": "", "value": "orphan", "type": "text"}, {"key": "f", "value": "v", "type": "text"}]}
	}`)
	prep, err = Resolve(form, nil, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed for form data: %v", err)
	}
	if len(prep.Form) != 1 || prep.Form[0].Key != "f" {
		t.Fatalf("form parts = %+v, want only the named field f", prep.Form)
	}
}

func TestResolve_PathVariables(t *testing.T) {
	req := mustRequest(t, `{
		"method": "GET",
		"url": {
			"raw": "http://example.com:8080/users/:id/orders/:orderId",
			"variable": [
				{"key": "id", "value": "{{userID}}"},
				{"key": "orderId", "value": "77"}
			]
		}
	}`)
	scope := scopeWith(map[string]string{"userID": "42"})

	prep, err := Resolve(req, nil, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	assertEqual(t, "url", prep.URL, "http://example.com:8080/users/42/orders/77")
}

func TestResolve_RawJSONDefaultContentType(t *testing.T) {
	req := mustRequest(t, `{
		"method": "POST",
		"url": {"raw": "http://example.com/x"},
		"body": {"mode": "raw", "raw": "{}", "options": {"raw": {"language": "json"}}}
	}`)

	prep, err := Resolve(req, nil, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	value, ok := headerValue(prep.Header, "Content-Type")
	if !ok {
		t.Fatal("Content-Type header missing")
	}
	assertEqual(t, "content-type", value, "application/json")
}

func TestResolve_URLEncodedOrderAndEncoding(t *testing.T) {
	req := mustRequest(t, `{
		"method": "POST",
		"url": {"raw": "http://example.com/x"},
		"body": {
			"mode": "urlencoded",
			"urlencoded": [
				{"key": "a b", "value": "1&2"},
				{"key": "skip", "value": "no", "disabled": true},
				{"key": "c", "value": "{{val}}"}
			]
		}
	}`)
	scope := scopeWith(map[string]string{"val": "z"})

	prep, err := Resolve(req, nil, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	assertEqual(t, "body", string(prep.Body), "a+b=1%262&c=z")
	value, _ := headerValue(prep.Header, "Content-Type")
	assertEqual(t, "content-type", value, "application/x-www-form-urlencoded")
}

func TestResolve_FileBody(t *testing.T) {
	tempFile := filepath.Join(t.TempDir(), "body.txt")
	if err := os.WriteFile(tempFile, []byte("file contents"), 0o644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	req := mustRequest(t, `{
		"method": "POST",
		"url": {"raw": "http://example.com/x"},
		"body": {"mode": "file", "file": {"src": "{{path}}"}}
	}`)
	scope := scopeWith(map[string]string{"path": tempFile})

	prep, err := Resolve(req, nil, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	assertEqual(t, "bodyFile", prep.BodyFile, tempFile)

	var observedBody string
	var readErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// t.Fatalf from a server goroutine calls FailNow on the wrong goroutine; capture
		// and assert after Send returns instead.
		data, err := io.ReadAll(r.Body)
		observedBody, readErr = string(data), err
	}))
	defer server.Close()
	prep.URL = server.URL

	client := NewClient(t.TempDir())
	if _, err := client.Send(context.Background(), prep); err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	if readErr != nil {
		t.Fatalf("server failed to read body: %v", readErr)
	}
	assertEqual(t, "server-observed body", observedBody, "file contents")
}

func TestResolve_FormData(t *testing.T) {
	tempFile := filepath.Join(t.TempDir(), "upload.txt")
	if err := os.WriteFile(tempFile, []byte("upload contents"), 0o644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	req := mustRequest(t, `{
		"method": "POST",
		"url": {"raw": "http://example.com/x"},
		"body": {
			"mode": "formdata",
			"formdata": [
				{"key": "name", "value": "{{who}}"},
				{"key": "attachment", "type": "file", "src": "PLACEHOLDER"}
			]
		}
	}`)
	req.Body.FormData[1].Src = json.RawMessage(`"` + tempFile + `"`)
	scope := scopeWith(map[string]string{"who": "restly"})

	prep, err := Resolve(req, nil, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}

	var observedName, observedFileContents string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("server failed to parse multipart form: %v", err)
		}
		observedName = r.FormValue("name")
		file, _, err := r.FormFile("attachment")
		if err != nil {
			t.Fatalf("server failed to read form file: %v", err)
		}
		defer file.Close()
		data, err := io.ReadAll(file)
		if err != nil {
			t.Fatalf("server failed to read file contents: %v", err)
		}
		observedFileContents = string(data)
	}))
	defer server.Close()
	prep.URL = server.URL

	client := NewClient(t.TempDir())
	if _, err := client.Send(context.Background(), prep); err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	assertEqual(t, "form name field", observedName, "restly")
	assertEqual(t, "form file contents", observedFileContents, "upload contents")
}

func TestResolve_GraphQLBody(t *testing.T) {
	req := mustRequest(t, `{
		"method": "POST",
		"url": {"raw": "http://example.com/graphql"},
		"body": {
			"mode": "graphql",
			"graphql": {"query": "{ {{field}} }", "variables": "{\"id\": 1}"}
		}
	}`)
	scope := scopeWith(map[string]string{"field": "ping"})

	prep, err := Resolve(req, nil, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	assertEqual(t, "body", string(prep.Body), `{"query":"{ ping }","variables":{"id":1}}`)
	value, _ := headerValue(prep.Header, "Content-Type")
	assertEqual(t, "content-type", value, "application/json")
}

func TestResolve_GraphQLInvalidVariablesErrors(t *testing.T) {
	req := mustRequest(t, `{
		"method": "POST",
		"url": {"raw": "http://example.com/graphql"},
		"body": {"mode": "graphql", "graphql": {"query": "{ ping }", "variables": "not json"}}
	}`)

	if _, err := Resolve(req, nil, vars.New()); err == nil {
		t.Fatal("expected an error for invalid graphql variables JSON")
	}
}

func TestResolve_AuthBasic(t *testing.T) {
	req := mustRequest(t, `{"method": "GET", "url": {"raw": "http://example.com/x"}}`)
	auth := mustAuth(t, `{"type": "basic", "basic": [{"key": "username", "value": "{{user}}"}, {"key": "password", "value": "secret"}]}`)
	scope := scopeWith(map[string]string{"user": "alice"})

	prep, err := Resolve(req, auth, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	value, ok := headerValue(prep.Header, "Authorization")
	if !ok {
		t.Fatal("Authorization header missing")
	}
	assertEqual(t, "authorization", value, "Basic YWxpY2U6c2VjcmV0")
}

func TestResolve_AuthBearer(t *testing.T) {
	req := mustRequest(t, `{"method": "GET", "url": {"raw": "http://example.com/x"}}`)
	auth := mustAuth(t, `{"type": "bearer", "bearer": [{"key": "token", "value": "{{tok}}"}]}`)
	scope := scopeWith(map[string]string{"tok": "xyz"})

	prep, err := Resolve(req, auth, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	value, _ := headerValue(prep.Header, "Authorization")
	assertEqual(t, "authorization", value, "Bearer xyz")
}

func TestResolve_AuthAPIKeyHeader(t *testing.T) {
	req := mustRequest(t, `{"method": "GET", "url": {"raw": "http://example.com/x"}}`)
	auth := mustAuth(t, `{"type": "apikey", "apikey": [{"key": "key", "value": "X-Api-Key"}, {"key": "value", "value": "{{secret}}"}, {"key": "in", "value": "header"}]}`)
	scope := scopeWith(map[string]string{"secret": "s3cret"})

	prep, err := Resolve(req, auth, scope)
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	value, ok := headerValue(prep.Header, "X-Api-Key")
	if !ok {
		t.Fatal("X-Api-Key header missing")
	}
	assertEqual(t, "api key header", value, "s3cret")
}

func TestResolve_AuthAPIKeyQuery(t *testing.T) {
	req := mustRequest(t, `{"method": "GET", "url": {"raw": "http://example.com/x"}}`)
	auth := mustAuth(t, `{"type": "apikey", "apikey": [{"key": "key", "value": "token"}, {"key": "value", "value": "abc"}, {"key": "in", "value": "query"}]}`)

	prep, err := Resolve(req, auth, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	assertEqual(t, "url", prep.URL, "http://example.com/x?token=abc")
}

func TestResolve_ExistingAuthorizationHeaderNotOverwritten(t *testing.T) {
	req := mustRequest(t, `{
		"method": "GET",
		"url": {"raw": "http://example.com/x"},
		"header": [{"key": "Authorization", "value": "Custom xyz"}]
	}`)
	auth := mustAuth(t, `{"type": "bearer", "bearer": [{"key": "token", "value": "should-not-appear"}]}`)

	prep, err := Resolve(req, auth, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	var authHeaders []string
	for _, header := range prep.Header {
		if strings.EqualFold(header.Key, "Authorization") {
			authHeaders = append(authHeaders, header.Value)
		}
	}
	// headerValue alone would pass even if a second Authorization header got appended,
	// since it only checks the first match; count entries instead.
	assertEqual(t, "authorization header count", len(authHeaders), 1)
	assertEqual(t, "authorization", authHeaders[0], "Custom xyz")
}

func TestResolve_MissingSchemeGetsHTTP(t *testing.T) {
	req := mustRequest(t, `{"method": "GET", "url": {"raw": "example.com/path"}}`)

	prep, err := Resolve(req, nil, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	assertEqual(t, "url", prep.URL, "http://example.com/path")
}

func TestResolve_MissingURLErrors(t *testing.T) {
	req := mustRequest(t, `{"method": "GET", "url": {"raw": ""}}`)
	if _, err := Resolve(req, nil, vars.New()); err == nil {
		t.Fatal("expected an error for an empty URL")
	}
}

func TestSend_CookiesPersistAcrossRequests(t *testing.T) {
	var requestCount int
	var secondRequestCookie string
	var secondRequestErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "abc"})
			return
		}
		cookie, err := r.Cookie("session")
		secondRequestErr = err
		if cookie != nil {
			secondRequestCookie = cookie.Value
		}
	}))
	defer server.Close()

	client := NewClient(t.TempDir())
	req := mustRequest(t, `{"method": "GET", "url": {"raw": "PLACEHOLDER"}}`)
	req.URL.Raw = server.URL
	prep, err := Resolve(req, nil, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}

	if _, err := client.Send(context.Background(), prep); err != nil {
		t.Fatalf("first Send failed: %v", err)
	}
	if _, err := client.Send(context.Background(), prep); err != nil {
		t.Fatalf("second Send failed: %v", err)
	}
	assertEqual(t, "request count", requestCount, 2)
	if secondRequestErr != nil {
		t.Fatalf("second request missing session cookie: %v", secondRequestErr)
	}
	assertEqual(t, "cookie value", secondRequestCookie, "abc")
}

func TestSend_GzipResponseDecompressed(t *testing.T) {
	var writeErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		gzipWriter := gzip.NewWriter(w)
		if _, err := gzipWriter.Write([]byte("plain text body")); err != nil {
			writeErr = err
		}
		if err := gzipWriter.Close(); err != nil && writeErr == nil {
			writeErr = err
		}
	}))
	defer server.Close()

	client := NewClient(t.TempDir())
	req := mustRequest(t, `{"method": "GET", "url": {"raw": "PLACEHOLDER"}}`)
	req.URL.Raw = server.URL
	prep, err := Resolve(req, nil, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}

	resp, err := client.Send(context.Background(), prep)
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	if writeErr != nil {
		t.Fatalf("server failed to write gzip body: %v", writeErr)
	}
	assertEqual(t, "decompressed body", string(resp.Body), "plain text body")
}

func TestSend_TimingsTotalPositive(t *testing.T) {
	var writeErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, writeErr = w.Write([]byte("ok"))
	}))
	defer server.Close()

	client := NewClient(t.TempDir())
	req := mustRequest(t, `{"method": "GET", "url": {"raw": "PLACEHOLDER"}}`)
	req.URL.Raw = server.URL
	prep, err := Resolve(req, nil, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}

	resp, err := client.Send(context.Background(), prep)
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	if writeErr != nil {
		t.Fatalf("server failed to write response: %v", writeErr)
	}
	if resp.Timings.Total <= 0 {
		t.Fatalf("expected Timings.Total > 0, got %v", resp.Timings.Total)
	}
	assertEqual(t, "status", resp.Status, "OK")
	assertEqual(t, "code", resp.Code, http.StatusOK)
}
