package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"restly/internal/collection"
	"restly/internal/httpx"
)

// newTestApp builds an App on a temp workspace without Wails, so methods that need no native dialog can run.
func newTestApp(t *testing.T) *App {
	t.Helper()
	app := NewApp()
	app.ctx = context.Background()
	app.dir = t.TempDir()
	app.client = httpx.NewClient(app.dir)
	app.globals = &collection.Environment{Name: "Globals", Scope: "globals"}
	if err := app.openData(t.TempDir()); err != nil {
		t.Fatalf("openData failed: %v", err)
	}
	return app
}

const appFixture = `{
  "info": {"name": "Fixture", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
  "variable": [{"key": "base", "value": "SERVER"}],
  "item": [{
    "name": "folder",
    "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{token}}", "type": "string"}]},
    "item": [{
      "name": "login",
      "request": {"method": "POST", "url": {"raw": "{{base}}/login"}, "description": "kept on save"},
      "event": [{"listen": "test", "script": {"exec": ["pm.environment.set('token', pm.response.json().token);"]}}]
    }]
  }]
}`

func TestSendPersistsScriptVariables(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, req *http.Request) {
		writer.Write([]byte(`{"token":"t-123"}`))
	}))
	defer server.Close()

	app := newTestApp(t)
	collFile := filepath.Join(app.dir, "fixture"+collectionExt)
	if err := os.WriteFile(collFile, []byte(strings.ReplaceAll(appFixture, "SERVER", server.URL)), 0o600); err != nil {
		t.Fatalf("failed to write fixture: %v", err)
	}
	envRef, err := app.NewEnvironment("Dev", "")
	if err != nil {
		t.Fatalf("NewEnvironment failed: %v", err)
	}

	workspace, err := app.GetWorkspace()
	if err != nil {
		t.Fatalf("GetWorkspace failed: %v", err)
	}
	if len(workspace.Collections) != 1 || workspace.Collections[0].Name != "Fixture" || len(workspace.Environments) != 1 {
		t.Fatalf("workspace = %+v, want the Fixture collection and one environment", workspace)
	}

	opened, err := app.OpenCollection(collFile)
	if err != nil {
		t.Fatalf("OpenCollection failed: %v", err)
	}
	var coll collection.Collection
	if err := json.Unmarshal(opened, &coll); err != nil {
		t.Fatalf("OpenCollection returned invalid JSON: %v", err)
	}
	item, _, err := coll.At([]int{0, 0})
	if err != nil {
		t.Fatalf("failed to find login: %v", err)
	}
	input := SendInput{File: collFile, Path: []int{0, 0}, Item: item, Env: envRef.File}
	result, err := app.Send(input)
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	if result.Error != "" || result.Response == nil || result.Response.Code != http.StatusOK {
		t.Fatalf("Send result = %+v, want a 200 with no error", result)
	}
	if result.Body != `{"token":"t-123"}` {
		t.Errorf("body = %q", result.Body)
	}

	saved, err := collection.LoadEnvironment(envRef.File)
	if err != nil {
		t.Fatalf("failed to reload environment: %v", err)
	}
	if got := collection.EnvMap(saved.Values)["token"]; got != "t-123" {
		t.Errorf("saved environment token = %q, want t-123", got)
	}

	code, err := app.Snippet(input, "curl")
	if err != nil {
		t.Fatalf("Snippet failed: %v", err)
	}
	if !strings.Contains(code, "--header 'Authorization: Bearer t-123'") || !strings.Contains(code, server.URL+"/login") {
		t.Errorf("curl snippet lacks the inherited bearer token or resolved URL:\n%s", code)
	}
}

func TestSendStandaloneRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, req *http.Request) {
		writer.Write([]byte(req.Header.Get("X-Key")))
	}))
	defer server.Close()

	app := newTestApp(t)
	envRef, err := app.NewEnvironment("Dev", "")
	if err != nil {
		t.Fatalf("NewEnvironment failed: %v", err)
	}
	env, err := app.OpenEnvironment(envRef.File)
	if err != nil {
		t.Fatalf("OpenEnvironment failed: %v", err)
	}
	env.Values = collection.SetEnv(env.Values, map[string]string{"base": server.URL, "key": "k-1"})
	if err := app.SaveEnvironment(envRef.File, env); err != nil {
		t.Fatalf("SaveEnvironment failed: %v", err)
	}

	var item collection.Item
	scratch := `{
	  "name": "scratch",
	  "request": {"method": "GET", "url": "{{base}}/x", "header": [{"key": "X-Key", "value": "{{key}}"}]},
	  "event": [{"listen": "test", "script": {"exec": ["pm.environment.set('seen', pm.response.text());"]}}]
	}`
	if err := json.Unmarshal([]byte(scratch), &item); err != nil {
		t.Fatalf("failed to decode scratch request: %v", err)
	}
	input := SendInput{Item: &item, Env: envRef.File}
	result, err := app.Send(input)
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	if result.Error != "" || result.Body != "k-1" {
		t.Fatalf("Send result error = %q, body = %q, want body k-1", result.Error, result.Body)
	}
	if result.Environment == nil || collection.EnvMap(result.Environment.Values)["seen"] != "k-1" {
		t.Errorf("environment after send = %+v, want seen=k-1 set by the test script", result.Environment)
	}

	code, err := app.Snippet(input, "curl")
	if err != nil {
		t.Fatalf("Snippet failed: %v", err)
	}
	if !strings.Contains(code, server.URL+"/x") || !strings.Contains(code, "X-Key: k-1") {
		t.Errorf("curl snippet lacks the resolved URL or header:\n%s", code)
	}
}

func TestDuplicateCollection(t *testing.T) {
	app := newTestApp(t)
	original, err := app.NewCollection("Orders")
	if err != nil {
		t.Fatalf("NewCollection failed: %v", err)
	}
	copied, err := app.DuplicateCollection(original.File)
	if err != nil {
		t.Fatalf("DuplicateCollection failed: %v", err)
	}
	if copied.Name != "Orders Copy" || copied.File == original.File {
		t.Fatalf("copy = %+v, want a new file named Orders Copy", copied)
	}
	first, err := collection.LoadCollection(original.File)
	if err != nil {
		t.Fatalf("failed to load original: %v", err)
	}
	second, err := collection.LoadCollection(copied.File)
	if err != nil {
		t.Fatalf("failed to load copy: %v", err)
	}
	if first.Info.PostmanID == second.Info.PostmanID {
		t.Errorf("copy kept _postman_id %s", first.Info.PostmanID)
	}
}

func TestEnvironmentOwnedByCollection(t *testing.T) {
	app := newTestApp(t)
	collRef, err := app.NewCollection("Payments")
	if err != nil {
		t.Fatalf("NewCollection failed: %v", err)
	}
	owned, err := app.NewEnvironment("Staging", collRef.File)
	if err != nil {
		t.Fatalf("NewEnvironment with a collection failed: %v", err)
	}
	if _, err := app.NewEnvironment("Shared", ""); err != nil {
		t.Fatalf("NewEnvironment without a collection failed: %v", err)
	}
	if owned.Collection != collRef.File {
		t.Fatalf("owned.Collection = %q, want %q", owned.Collection, collRef.File)
	}

	workspace, err := app.GetWorkspace()
	if err != nil {
		t.Fatalf("GetWorkspace failed: %v", err)
	}
	owners := map[string]string{}
	for _, ref := range workspace.Environments {
		owners[ref.Name] = ref.Collection
	}
	if owners["Staging"] != collRef.File || owners["Shared"] != "" {
		t.Fatalf("environment owners = %v, want Staging owned by %s and Shared unowned", owners, collRef.File)
	}

	// Clearing the owner must reach the file, not leave the old value behind.
	env, err := app.OpenEnvironment(owned.File)
	if err != nil {
		t.Fatalf("OpenEnvironment failed: %v", err)
	}
	env.Collection = ""
	if err := app.SaveEnvironment(owned.File, env); err != nil {
		t.Fatalf("SaveEnvironment failed: %v", err)
	}
	if owner := readOwner(owned.File); owner != "" {
		t.Fatalf("owner after clearing = %q, want empty", owner)
	}
}

func TestImportedThemes(t *testing.T) {
	app := newTestApp(t)
	themes, err := app.ListThemes()
	if err != nil || len(themes) != 0 {
		t.Fatalf("ListThemes before any import = %v, %v, want none", themes, err)
	}

	source := filepath.Join(t.TempDir(), "Night Owl.json")
	text := "// VS Code themes may have comments\n{\"name\": \"Night Owl\", \"colors\": {}}"
	if err := os.WriteFile(source, []byte(text), 0o600); err != nil {
		t.Fatalf("failed to write theme fixture: %v", err)
	}
	imported, err := app.importTheme(source)
	if err != nil {
		t.Fatalf("importTheme failed: %v", err)
	}
	themes, err = app.ListThemes()
	if err != nil || len(themes) != 1 || themes[0].Data != text || themes[0].File != imported.File {
		t.Fatalf("ListThemes after import = %+v, %v, want the imported file with its text unchanged", themes, err)
	}

	if err := app.DeleteTheme(source); err == nil {
		t.Fatal("DeleteTheme accepted a file outside the themes folder")
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatalf("the original theme file is gone: %v", err)
	}
	if err := app.DeleteTheme(imported.File); err != nil {
		t.Fatalf("DeleteTheme failed: %v", err)
	}
	if themes, _ := app.ListThemes(); len(themes) != 0 {
		t.Fatalf("ListThemes after delete = %+v, want none", themes)
	}
}

func TestGetKeybindingsKeepsUserFile(t *testing.T) {
	app := newTestApp(t)
	first, err := app.GetKeybindings()
	if err != nil {
		t.Fatalf("GetKeybindings failed: %v", err)
	}
	if first.Data != keybindingsTemplate {
		t.Fatalf("new keybindings.json = %q, want the template", first.Data)
	}
	custom := `[{"key": "cmd+j", "command": "send"}]`
	if err := os.WriteFile(first.File, []byte(custom), 0o600); err != nil {
		t.Fatalf("failed to edit keybindings.json: %v", err)
	}
	second, err := app.GetKeybindings()
	if err != nil || second.Data != custom {
		t.Fatalf("GetKeybindings after an edit = %+v, %v, want the edited file", second, err)
	}
}

func TestGetAppInfoVersionMatchesWailsJSON(t *testing.T) {
	app := NewApp()
	info := app.GetAppInfo()
	if info.Version == "" {
		t.Fatal("GetAppInfo().Version is empty")
	}
	data, err := os.ReadFile("wails.json")
	if err != nil {
		t.Fatalf("failed to read wails.json: %v", err)
	}
	var config struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("failed to parse wails.json: %v", err)
	}
	if info.Version != config.Info.ProductVersion {
		t.Fatalf("GetAppInfo().Version = %q, want %q from wails.json", info.Version, config.Info.ProductVersion)
	}
}

func TestWorkspaceFileRejectsOutsidePaths(t *testing.T) {
	app := newTestApp(t)
	for _, path := range []string{"/etc/passwd", filepath.Join(app.dir, "..", "x"+collectionExt)} {
		if _, err := app.workspaceFile(path); err == nil {
			t.Errorf("workspaceFile(%q) accepted a path outside the workspace", path)
		}
	}
}

func TestCancelSendStopsTheRequest(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, req *http.Request) {
		select {
		case <-req.Context().Done():
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)

	app := newTestApp(t)
	done := make(chan *SendResult, 1)
	go func() {
		result, err := app.Send(SendInput{
			ID: "tab-1",
			Item: &collection.Item{
				Name:    "slow",
				Request: &collection.Request{Method: "GET", URL: &collection.URL{Raw: server.URL}},
			},
		})
		if err != nil {
			t.Errorf("Send failed: %v", err)
		}
		done <- result
	}()
	for registered := false; !registered; {
		app.mu.Lock()
		registered = app.sends["tab-1"] != nil
		app.mu.Unlock()
	}
	app.CancelSend("tab-1")

	select {
	case result := <-done:
		if result == nil || result.Error != errSendCancelled {
			t.Fatalf("result = %+v, want error %q", result, errSendCancelled)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Send did not return after CancelSend")
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if len(app.sends) != 0 {
		t.Fatalf("sends = %v, want empty after the send returns", app.sends)
	}
}
