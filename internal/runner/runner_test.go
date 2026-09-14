package runner

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"restly/internal/collection"
	"restly/internal/httpx"
	"restly/internal/vars"
)

// runFixture logs in, jumps over "skip" with setNextRequest, and calls "me" inside a folder
// whose bearer auth uses the token the login test script stored.
const runFixture = `{
  "info": {"name": "fixture", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
  "variable": [{"key": "base", "value": "SERVER"}],
  "event": [{"listen": "prerequest", "script": {"exec": ["pm.variables.set('fromCollection', '1');"]}}],
  "item": [
    {
      "name": "login",
      "request": {"method": "POST", "url": {"raw": "{{base}}/login"}},
      "event": [{"listen": "test", "script": {"exec": [
        "pm.collectionVariables.set('token', pm.response.json().data.token);",
        "pm.execution.setNextRequest('me');"
      ]}}]
    },
    {"name": "skip", "request": {"method": "GET", "url": {"raw": "{{base}}/skip"}}},
    {
      "name": "api",
      "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{token}}", "type": "string"}]},
      "item": [{
        "name": "me",
        "request": {"method": "GET", "url": {"raw": "{{base}}/me"}},
        "event": [{"listen": "test", "script": {"exec": [
          "pm.test('status 200', () => pm.response.to.have.status(200));",
          "pm.test('local variable from collection script', () => pm.expect(pm.variables.get('fromCollection')).to.equal('1'));"
        ]}}]
      }]
    }
  ]
}`

func TestRunFollowsScriptsAuthAndNextRequest(t *testing.T) {
	var skipHits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/login":
			writer.Write([]byte(`{"data":{"token":"abc"}}`))
		case "/me":
			if req.Header.Get("Authorization") != "Bearer abc" {
				writer.WriteHeader(http.StatusUnauthorized)
				return
			}
			writer.Write([]byte(`{"id":7}`))
		case "/skip":
			skipHits.Add(1)
		}
	}))
	defer server.Close()

	var coll collection.Collection
	if err := json.Unmarshal([]byte(strings.ReplaceAll(runFixture, "SERVER", server.URL)), &coll); err != nil {
		t.Fatalf("failed to parse fixture: %v", err)
	}
	scope := vars.New()
	scope.Collection = collection.VarMap(coll.Variable)

	var results []Result
	summary := Run(context.Background(), httpx.NewClient(t.TempDir()), scope, &coll, nil, Options{Iterations: 2}, func(result Result) {
		results = append(results, result)
	})

	for _, result := range results {
		if result.Error != "" {
			t.Errorf("%s: unexpected error: %s", result.Name, result.Error)
		}
	}
	want := Summary{Requests: 4, Passed: 4}
	if summary != want {
		t.Errorf("summary = %+v, want %+v", summary, want)
	}
	if hits := skipHits.Load(); hits != 0 {
		t.Errorf("skip was requested %d times, want 0", hits)
	}
	if token := scope.Collection["token"]; token != "abc" {
		t.Errorf("collection token = %q, want abc", token)
	}
}

func TestRunFolderOnly(t *testing.T) {
	var coll collection.Collection
	if err := json.Unmarshal([]byte(runFixture), &coll); err != nil {
		t.Fatalf("failed to parse fixture: %v", err)
	}
	entries, err := flatten(&coll, []int{2})
	if err != nil {
		t.Fatalf("flatten failed: %v", err)
	}
	if len(entries) != 1 || entries[0].item.Name != "me" || len(entries[0].ancestors) != 1 {
		t.Fatalf("flatten(folder api) = %+v, want only me with one ancestor", entries)
	}
	if _, err := flatten(&coll, []int{0}); err == nil {
		t.Error("flatten accepted a request as the folder to run")
	}
}
