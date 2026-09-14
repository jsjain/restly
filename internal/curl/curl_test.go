package curl

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"restly/internal/collection"
	"restly/internal/httpx"
	"restly/internal/snippet"
	"restly/internal/vars"
)

// assertEqual is the one typed helper the spec asks for, used instead of repeating
// if-blocks or comma-ok checks throughout the table tests below.
func assertEqual[T comparable](t *testing.T, label string, got, want T) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: got %v, want %v", label, got, want)
	}
}

func mustParse(t *testing.T, command string) *collection.Item {
	t.Helper()
	item, err := Parse(command)
	if err != nil {
		t.Fatalf("Parse(%q) failed: %v", command, err)
	}
	return item
}

func mustResolve(t *testing.T, item *collection.Item) *httpx.Prepared {
	t.Helper()
	prep, err := httpx.Resolve(item.Request, item.Request.Auth, vars.New())
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	return prep
}

func mustRequestJSON(t *testing.T, jsonText string) *collection.Request {
	t.Helper()
	var req collection.Request
	if err := json.Unmarshal([]byte(jsonText), &req); err != nil {
		t.Fatalf("failed to unmarshal request fixture: %v", err)
	}
	return &req
}

func mustAuthJSON(t *testing.T, jsonText string) *collection.Auth {
	t.Helper()
	var auth collection.Auth
	if err := json.Unmarshal([]byte(jsonText), &auth); err != nil {
		t.Fatalf("failed to unmarshal auth fixture: %v", err)
	}
	return &auth
}

func findHeaderKV(headers []collection.KV, key string) (string, bool) {
	for _, header := range headers {
		if strings.EqualFold(header.Key, key) {
			return header.Value, true
		}
	}
	return "", false
}

func normalizeHeaders(headers []httpx.Header) []string {
	normalized := make([]string, len(headers))
	for i, header := range headers {
		normalized[i] = strings.ToLower(header.Key) + "=" + header.Value
	}
	slices.Sort(normalized)
	return normalized
}

func TestParse_MethodDefaults(t *testing.T) {
	cases := []struct {
		name    string
		command string
		want    string
	}{
		{"bare GET", `curl https://example.com`, "GET"},
		{"POST from data", `curl -d "a=1" https://example.com`, "POST"},
		{"POST from form", `curl -F "a=1" https://example.com`, "POST"},
		{"HEAD flag", `curl -I https://example.com`, "HEAD"},
		{"explicit method wins over data", `curl -X PUT -d "a=1" https://example.com`, "PUT"},
		{"attached -XPOST", `curl -XPOST https://example.com`, "POST"},
		{"GET flag keeps GET despite data", `curl -G -d "a=1" https://example.com`, "GET"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := mustParse(t, tc.command)
			assertEqual(t, "method", item.Request.Method, tc.want)
		})
	}
}

func TestParse_URL(t *testing.T) {
	item := mustParse(t, `curl --url https://example.com/x`)
	assertEqual(t, "url", item.Request.URL.Raw, "https://example.com/x")

	item = mustParse(t, `curl https://example.com/y`)
	assertEqual(t, "url", item.Request.URL.Raw, "https://example.com/y")
}

func TestParse_Headers(t *testing.T) {
	item := mustParse(t, `curl -H "X-Foo: bar" -H "X-Baz: qux" https://example.com`)
	assertEqual(t, "header count", len(item.Request.Header), 2)
	assertEqual(t, "X-Foo", item.Request.Header[0].Value, "bar")
	assertEqual(t, "X-Baz", item.Request.Header[1].Value, "qux")
}

func TestParse_DataJoinsWithAmpersand(t *testing.T) {
	item := mustParse(t, `curl -d "a=1" --data-raw "b=2" --data-binary "c=3" --data-ascii "d=4" https://example.com`)
	prep := mustResolve(t, item)
	assertEqual(t, "body", string(prep.Body), "a=1&b=2&c=3&d=4")
}

func TestParse_DataFileBecomesFileBody(t *testing.T) {
	item := mustParse(t, `curl -d @/tmp/payload.json https://example.com`)
	assertEqual(t, "mode", item.Request.Body.Mode, "file")
	assertEqual(t, "src", item.Request.Body.File.Src, "/tmp/payload.json")
}

func TestParse_DataRawNeverTreatsAtSpecially(t *testing.T) {
	item := mustParse(t, `curl --data-raw "@literal" https://example.com`)
	assertEqual(t, "mode", item.Request.Body.Mode, "raw")
	assertEqual(t, "raw", item.Request.Body.Raw, "@literal")
}

func TestParse_JSONWithoutContentTypeStaysRaw(t *testing.T) {
	item := mustParse(t, `curl https://example.com -d '{"a":"b=c"}'`)
	assertEqual(t, "mode", item.Request.Body.Mode, "raw")
	assertEqual(t, "language", item.Request.Body.RawLanguage(), "json")
}

func TestParse_DataURLEncode(t *testing.T) {
	cases := []struct {
		name    string
		command string
		want    string
	}{
		{"name=value", `curl --data-urlencode "name=a b" https://example.com`, "name=a+b"},
		{"=value", `curl --data-urlencode "=a b" https://example.com`, "a+b"},
		{"value only", `curl --data-urlencode "a b" https://example.com`, "a+b"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := mustParse(t, tc.command)
			prep := mustResolve(t, item)
			assertEqual(t, "body", string(prep.Body), tc.want)
		})
	}
}

func TestParse_GetMovesDataToQuery(t *testing.T) {
	item := mustParse(t, `curl -G -d "a=1" --data-urlencode "b=x y" https://example.com/search?existing=1`)
	assertEqual(t, "method", item.Request.Method, "GET")
	prep := mustResolve(t, item)
	assertEqual(t, "url", prep.URL, "https://example.com/search?existing=1&a=1&b=x+y")
	assertEqual(t, "no body", len(prep.Body), 0)
}

func TestParse_FormFields(t *testing.T) {
	item := mustParse(t, `curl -F "title=hello world" -F "file=@/tmp/upload.txt;type=text/plain" https://example.com`)
	assertEqual(t, "mode", item.Request.Body.Mode, "formdata")
	assertEqual(t, "field count", len(item.Request.Body.FormData), 2)
	assertEqual(t, "title value", item.Request.Body.FormData[0].Value, "hello world")
	assertEqual(t, "title type", item.Request.Body.FormData[0].Type, "text")
	assertEqual(t, "file type", item.Request.Body.FormData[1].Type, "file")
	files := item.Request.Body.FormData[1].Files()
	if len(files) != 1 || files[0] != "/tmp/upload.txt" {
		t.Fatalf("file src = %v, want [/tmp/upload.txt]", files)
	}
}

func TestParse_FormStringNeverTreatsAtSpecially(t *testing.T) {
	item := mustParse(t, `curl --form-string "note=@handle" https://example.com`)
	assertEqual(t, "value", item.Request.Body.FormData[0].Value, "@handle")
	assertEqual(t, "type", item.Request.Body.FormData[0].Type, "text")
}

func TestParse_BasicAuth(t *testing.T) {
	item := mustParse(t, `curl -u "alice:s3cret" https://example.com`)
	assertEqual(t, "type", item.Request.Auth.Type, "basic")
	params := item.Request.Auth.Params()
	assertEqual(t, "username", params["username"], "alice")
	assertEqual(t, "password", params["password"], "s3cret")
}

func TestParse_Cookie(t *testing.T) {
	item := mustParse(t, `curl -b "session=abc123" https://example.com`)
	value, ok := findHeaderKV(item.Request.Header, "Cookie")
	if !ok {
		t.Fatal("Cookie header missing")
	}
	assertEqual(t, "cookie", value, "session=abc123")

	item = mustParse(t, `curl -b cookies.txt https://example.com`)
	if _, ok := findHeaderKV(item.Request.Header, "Cookie"); ok {
		t.Fatal("Cookie header should be absent for a value without '='")
	}
}

func TestParse_UserAgentAndReferer(t *testing.T) {
	item := mustParse(t, `curl -A "MyAgent/1.0" -e "https://ref.example.com" https://example.com`)
	ua, _ := findHeaderKV(item.Request.Header, "User-Agent")
	referer, _ := findHeaderKV(item.Request.Header, "Referer")
	assertEqual(t, "user-agent", ua, "MyAgent/1.0")
	assertEqual(t, "referer", referer, "https://ref.example.com")
}

func TestParse_CombinedShortFlags(t *testing.T) {
	item := mustParse(t, `curl -sSL https://example.com`)
	assertEqual(t, "method", item.Request.Method, "GET")

	item = mustParse(t, `curl -sSLX POST https://example.com`)
	assertEqual(t, "method", item.Request.Method, "POST")
}

func TestParse_IgnoredFlagsConsumeTheirValue(t *testing.T) {
	command := `curl -o /dev/null -m 30 --connect-timeout 5 --retry 3 -w "%{http_code}" https://example.com/path`
	item := mustParse(t, command)
	assertEqual(t, "url", item.Request.URL.Raw, "https://example.com/path")
}

func TestParse_IgnoredBooleanFlags(t *testing.T) {
	command := `curl --compressed -k -L -s -S -v -i --http1.1 https://example.com`
	item := mustParse(t, command)
	assertEqual(t, "url", item.Request.URL.Raw, "https://example.com")
	assertEqual(t, "method", item.Request.Method, "GET")
}

func TestParse_UnknownFlagSkipped(t *testing.T) {
	item := mustParse(t, `curl --totally-made-up https://example.com`)
	assertEqual(t, "url", item.Request.URL.Raw, "https://example.com")
}

func TestParse_LeadingPromptStripped(t *testing.T) {
	item := mustParse(t, "$ curl https://example.com")
	assertEqual(t, "url", item.Request.URL.Raw, "https://example.com")
}

func TestParse_CmdStyleContinuation(t *testing.T) {
	command := "curl -H \"Content-Type: application/json\" ^\n  --data-raw \"{\\\"a\\\":1}\" ^\n  \"https://example.com\""
	item := mustParse(t, command)
	assertEqual(t, "url", item.Request.URL.Raw, "https://example.com")
	assertEqual(t, "body", item.Request.Body.Raw, `{"a":1}`)
}

func TestParse_ChromeBashSample(t *testing.T) {
	command := `curl 'https://api.example.com/v1/items?limit=10' \
  -H 'authority: api.example.com' \
  -H 'accept: application/json, text/plain, */*' \
  -H $'cookie: session=abc; name=O\'Brien' \
  -H 'user-agent: Mozilla/5.0' \
  --data-raw '{"name":"widget","qty":2}'`
	item := mustParse(t, command)
	assertEqual(t, "method", item.Request.Method, "POST")
	assertEqual(t, "url", item.Request.URL.Raw, "https://api.example.com/v1/items?limit=10")
	cookie, ok := findHeaderKV(item.Request.Header, "cookie")
	if !ok {
		t.Fatal("cookie header missing")
	}
	assertEqual(t, "cookie", cookie, "session=abc; name=O'Brien")
	assertEqual(t, "body mode", item.Request.Body.Mode, "raw")
	assertEqual(t, "body", item.Request.Body.Raw, `{"name":"widget","qty":2}`)
	assertEqual(t, "language", item.Request.Body.RawLanguage(), "json")
	contentType, ok := findHeaderKV(item.Request.Header, "Content-Type")
	if !ok {
		t.Fatal("Content-Type header missing")
	}
	assertEqual(t, "content-type", contentType, defaultContentTypeForData)
}

func TestParse_FirefoxSample(t *testing.T) {
	command := `curl 'https://example.com/api/login' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/117.0' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  --data-raw '{"user":"bob","pass":"hunter2"}'`
	item := mustParse(t, command)
	assertEqual(t, "method", item.Request.Method, "POST")
	assertEqual(t, "body mode", item.Request.Body.Mode, "raw")
	contentType, _ := findHeaderKV(item.Request.Header, "Content-Type")
	assertEqual(t, "content-type", contentType, "application/json")
	assertEqual(t, "language", item.Request.Body.RawLanguage(), "json")
}

func TestParse_PostmanExportedSample(t *testing.T) {
	command := `curl --location --request POST 'https://api.example.com/v1/orders' --header 'Content-Type: application/json' --data-raw '{"id":42}'`
	item := mustParse(t, command)
	assertEqual(t, "method", item.Request.Method, "POST")
	assertEqual(t, "url", item.Request.URL.Raw, "https://api.example.com/v1/orders")
	assertEqual(t, "body", item.Request.Body.Raw, `{"id":42}`)
}

func TestParse_MultipartFormSample(t *testing.T) {
	command := `curl --location 'https://example.com/upload' --form 'title="my title"' --form 'file=@"/tmp/report.pdf"'`
	item := mustParse(t, command)
	assertEqual(t, "method", item.Request.Method, "POST")
	assertEqual(t, "mode", item.Request.Body.Mode, "formdata")
	assertEqual(t, "title value", item.Request.Body.FormData[0].Value, "my title")
	assertEqual(t, "file type", item.Request.Body.FormData[1].Type, "file")
	files := item.Request.Body.FormData[1].Files()
	if len(files) != 1 || files[0] != "/tmp/report.pdf" {
		t.Fatalf("file src = %v, want [/tmp/report.pdf]", files)
	}
}

func TestParse_Errors(t *testing.T) {
	cases := []struct {
		name    string
		command string
	}{
		{"not curl", `wget https://example.com`},
		{"unterminated single quote", `curl 'https://example.com`},
		{"unterminated double quote", `curl "https://example.com`},
		{"unterminated ansi-c quote", `curl $'https://example.com`},
		{"missing URL", `curl -H "X: 1"`},
		{"malformed header", `curl -H "NoColon" https://example.com`},
		{"empty command", ``},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Parse(tc.command); err == nil {
				t.Fatalf("Parse(%q): expected error, got nil", tc.command)
			}
		})
	}
}

// TestParse_RoundTrip builds requests the way Restly's UI would, resolves and renders
// each as a curl command with the snippet package, parses that command back, and checks
// that resolving the result reproduces the original prepared request.
func TestParse_RoundTrip(t *testing.T) {
	fixtures := []struct {
		name string
		req  *collection.Request
		auth *collection.Auth
	}{
		{
			name: "raw json body with header",
			req: mustRequestJSON(t, `{
				"method": "POST",
				"url": {"raw": "https://example.com/things?x=1"},
				"header": [{"key": "Content-Type", "value": "application/json"}],
				"body": {"mode": "raw", "raw": "{\"name\":\"widget\"}", "options": {"raw": {"language": "json"}}}
			}`),
		},
		{
			name: "urlencoded body",
			req: mustRequestJSON(t, `{
				"method": "POST",
				"url": {"raw": "https://example.com/form"},
				"body": {
					"mode": "urlencoded",
					"urlencoded": [{"key": "a", "value": "1"}, {"key": "b", "value": "two words"}]
				}
			}`),
		},
		{
			name: "formdata text part",
			req: mustRequestJSON(t, `{
				"method": "POST",
				"url": {"raw": "https://example.com/upload"},
				"body": {"mode": "formdata", "formdata": [{"key": "title", "value": "hello world", "type": "text"}]}
			}`),
		},
		{
			name: "basic auth",
			req:  mustRequestJSON(t, `{"method": "GET", "url": {"raw": "https://example.com/secure"}}`),
			auth: mustAuthJSON(t, `{"type": "basic", "basic": [{"key": "username", "value": "alice"}, {"key": "password", "value": "secret"}]}`),
		},
		{
			name: "query params",
			req: mustRequestJSON(t, `{
				"method": "GET",
				"url": {
					"raw": "https://example.com/search?old=1",
					"query": [{"key": "q", "value": "hello world"}, {"key": "page", "value": "2"}]
				}
			}`),
		},
	}

	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			originalPrep, err := httpx.Resolve(fixture.req, fixture.auth, vars.New())
			if err != nil {
				t.Fatalf("Resolve original request: %v", err)
			}
			snippetText, err := snippet.Generate("curl", originalPrep)
			if err != nil {
				t.Fatalf("Generate curl snippet: %v", err)
			}

			item, err := Parse(snippetText)
			if err != nil {
				t.Fatalf("Parse(%q): %v", snippetText, err)
			}
			reparsedPrep, err := httpx.Resolve(item.Request, item.Request.Auth, vars.New())
			if err != nil {
				t.Fatalf("Resolve reparsed request: %v", err)
			}

			assertEqual(t, "method", reparsedPrep.Method, originalPrep.Method)
			assertEqual(t, "url", reparsedPrep.URL, originalPrep.URL)
			gotHeaders, wantHeaders := normalizeHeaders(reparsedPrep.Header), normalizeHeaders(originalPrep.Header)
			if !slices.Equal(gotHeaders, wantHeaders) {
				t.Fatalf("headers mismatch:\n got: %v\nwant: %v", gotHeaders, wantHeaders)
			}
			assertEqual(t, "body", string(reparsedPrep.Body), string(originalPrep.Body))
			if !slices.Equal(reparsedPrep.Form, originalPrep.Form) {
				t.Fatalf("form mismatch:\n got: %v\nwant: %v", reparsedPrep.Form, originalPrep.Form)
			}
		})
	}
}
