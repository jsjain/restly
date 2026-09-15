package collection

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

// realCollections are the user's Postman exports. Tests skip the ones not present on this machine.
var realCollections = []string{}

func assertSameJSON(t *testing.T, label string, want, got []byte) {
	t.Helper()
	var wantValue, gotValue any
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("%s: failed to parse want: %v", label, err)
	}
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("%s: failed to parse got: %v", label, err)
	}
	if !reflect.DeepEqual(wantValue, gotValue) {
		t.Errorf("%s: JSON differs\nwant: %s\ngot:  %s", label, want, got)
	}
}

func TestRoundTripRealCollections(t *testing.T) {
	for _, path := range realCollections {
		original, err := os.ReadFile(path)
		if errors.Is(err, fs.ErrNotExist) {
			t.Logf("skipping missing %s", path)
			continue
		}
		if err != nil {
			t.Fatalf("failed to read %s: %v", path, err)
		}
		coll, err := LoadCollection(path)
		if err != nil {
			t.Fatalf("failed to load %s: %v", path, err)
		}
		out := filepath.Join(t.TempDir(), "saved.json")
		if err := SaveCollection(out, coll); err != nil {
			t.Fatalf("failed to save %s: %v", path, err)
		}
		saved, err := os.ReadFile(out)
		if err != nil {
			t.Fatalf("failed to read saved copy of %s: %v", path, err)
		}
		if !reflect.DeepEqual(parse(t, original), parse(t, saved)) {
			t.Errorf("%s: saved file differs from the original", path)
		}
	}
}

func parse(t *testing.T, data []byte) any {
	t.Helper()
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatalf("failed to parse JSON: %v", err)
	}
	return value
}

func TestRoundTripEdgeCases(t *testing.T) {
	cases := []struct {
		name string
		json string
	}{
		{name: "string url", json: `{"name":"r","request":{"method":"GET","url":"{{base}}/users?page=1"}}`},
		{name: "exec as one string", json: `{"name":"r","request":{"method":"GET"},"event":[{"listen":"test","script":{"exec":"a\nb"}}]}`},
		{name: "file part without value", json: `{"name":"r","request":{"method":"POST","body":{"mode":"formdata","formdata":[{"key":"f","type":"file","src":"/tmp/a.png"}]}}}`},
		{name: "null and empty values", json: `{"name":"r","request":{"method":"GET","description":null,"header":[],"body":{"mode":"raw","raw":""},"url":{"raw":"x","host":["x"],"query":[{"key":"flag","value":null}]}}}`},
		{name: "unknown members", json: `{"name":"r","protocolProfileBehavior":{"disableBodyPruning":true},"response":[{"name":"ok","code":200}],"request":{"method":"GET","url":{"raw":"x","host":["x"]}}}`},
		{name: "empty folder", json: `{"name":"f","item":[]}`},
	}
	for _, tc := range cases {
		var item Item
		if err := json.Unmarshal([]byte(tc.json), &item); err != nil {
			t.Fatalf("%s: failed to parse: %v", tc.name, err)
		}
		out, err := json.Marshal(item)
		if err != nil {
			t.Fatalf("%s: failed to encode: %v", tc.name, err)
		}
		assertSameJSON(t, tc.name, []byte(tc.json), out)
	}

	var variable Variable
	if err := json.Unmarshal([]byte(`{"key":"n","value":5,"type":"number"}`), &variable); err != nil {
		t.Fatalf("failed to parse numeric variable: %v", err)
	}
	out, err := json.Marshal(variable)
	if err != nil {
		t.Fatalf("failed to encode numeric variable: %v", err)
	}
	assertSameJSON(t, "numeric variable", []byte(`{"key":"n","value":5,"type":"number"}`), out)
}

func TestNewItemsEncode(t *testing.T) {
	folder, err := json.Marshal(&Item{Name: "f"})
	if err != nil {
		t.Fatalf("failed to encode folder: %v", err)
	}
	assertSameJSON(t, "new folder", []byte(`{"name":"f","item":[]}`), folder)

	req, err := json.Marshal(&Request{Method: "GET", URL: &URL{Raw: "https://api.example.com:8443/v1/users?x=1"}})
	if err != nil {
		t.Fatalf("failed to encode request: %v", err)
	}
	want := `{"method":"GET","url":{"raw":"https://api.example.com:8443/v1/users?x=1","protocol":"https",` +
		`"host":["api","example","com"],"port":"8443","path":["v1","users"]}}`
	assertSameJSON(t, "new request fills host and path", []byte(want), req)
}

func TestLoadV20UpgradesAuth(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v20.json")
	v20 := `{"info":{"name":"old","schema":"https://schema.getpostman.com/json/collection/v2.0.0/collection.json"},` +
		`"auth":{"type":"basic","basic":{"username":"u","password":"p"}},"item":[]}`
	if err := os.WriteFile(path, []byte(v20), 0o600); err != nil {
		t.Fatalf("failed to write fixture: %v", err)
	}
	coll, err := LoadCollection(path)
	if err != nil {
		t.Fatalf("failed to load v2.0 collection: %v", err)
	}
	if got := coll.Auth.Params(); got["username"] != "u" || got["password"] != "p" {
		t.Errorf("Params() = %v, want username u and password p", got)
	}
	if err := SaveCollection(path, coll); err != nil {
		t.Fatalf("failed to save: %v", err)
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}
	want := `{"info":{"name":"old","schema":"` + SchemaV21 + `"},"auth":{"type":"basic","basic":[` +
		`{"key":"password","value":"p","type":"string"},{"key":"username","value":"u","type":"string"}]},"item":[]}`
	assertSameJSON(t, "upgraded v2.0", []byte(want), saved)
}

func TestLoadRejectsV1(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v1.json")
	if err := os.WriteFile(path, []byte(`{"id":"1","name":"old","order":[],"requests":[]}`), 0o600); err != nil {
		t.Fatalf("failed to write fixture: %v", err)
	}
	if _, err := LoadCollection(path); err == nil {
		t.Error("LoadCollection accepted a v1 collection")
	}
}

func TestIsWebSocket(t *testing.T) {
	cases := map[string]bool{
		`{"name":"chat","x-restly-type":"websocket","request":{"method":"GET","url":"wss://example.com"}}`: true,
		`{"name":"plain","request":{"method":"GET","url":"https://example.com"}}`:                          false,
	}
	for input, want := range cases {
		var item Item
		if err := json.Unmarshal([]byte(input), &item); err != nil {
			t.Fatal(err)
		}
		if got := item.IsWebSocket(); got != want {
			t.Errorf("IsWebSocket() = %v for %s", got, input)
		}
	}
}

func TestWriteJSONKeepsFileMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows files have no Unix permission bits to keep")
	}
	dir := t.TempDir()
	fresh := filepath.Join(dir, "fresh.json")
	private := filepath.Join(dir, "private.json")
	if err := os.WriteFile(private, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{fresh, private} {
		if err := WriteJSON(path, json.RawMessage(`{"a":"b"}`)); err != nil {
			t.Fatal(err)
		}
	}
	for path, want := range map[string]os.FileMode{fresh: 0o644, private: 0o600} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != want {
			t.Errorf("%s mode = %o, want %o", filepath.Base(path), got, want)
		}
	}
}

func TestSetVars(t *testing.T) {
	variables := []Variable{
		{Key: "keep", Value: "old"},
		{Key: "off", Value: "x", Disabled: true},
		{Key: "gone", Value: "y"},
	}
	got := SetVars(variables, map[string]string{"keep": "new", "added": "z"})
	want := []Variable{
		{Key: "keep", Value: "new"},
		{Key: "off", Value: "x", Disabled: true},
		{Key: "added", Value: "z"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("SetVars() = %+v, want %+v", got, want)
	}
}
