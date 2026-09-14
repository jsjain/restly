package collection

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

func writeJSON(path string, value any) error {
	data, err := marshal(value)
	if err != nil {
		return fmt.Errorf("failed to encode %s: %w", filepath.Base(path), err)
	}
	return WriteJSON(path, data)
}

// WriteJSON writes JSON in Postman's tab-indented layout, replacing the file atomically.
func WriteJSON(path string, data []byte) error {
	var indented bytes.Buffer
	if err := json.Indent(&indented, data, "", "\t"); err != nil {
		return fmt.Errorf("failed to indent %s: %w", filepath.Base(path), err)
	}
	indented.WriteByte('\n')
	return writeFileAtomic(path, indented.Bytes())
}

// writeFileAtomic writes a temp file and renames it over path, so a crash never leaves a half-written file.
func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".restly-*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp file for %s: %w", path, err)
	}
	// CreateTemp makes the file 0600, which would leave every saved collection owner-only.
	mode := os.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	if err := tmp.Chmod(mode); err != nil {
		return errors.Join(fmt.Errorf("failed to set mode on %s: %w", path, err), tmp.Close(), os.Remove(tmp.Name()))
	}
	if _, err := tmp.Write(data); err != nil {
		return errors.Join(fmt.Errorf("failed to write %s: %w", path, err), tmp.Close(), os.Remove(tmp.Name()))
	}
	if err := tmp.Sync(); err != nil {
		return errors.Join(fmt.Errorf("failed to sync %s: %w", path, err), tmp.Close(), os.Remove(tmp.Name()))
	}
	if err := tmp.Close(); err != nil {
		return errors.Join(fmt.Errorf("failed to close %s: %w", path, err), os.Remove(tmp.Name()))
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return errors.Join(fmt.Errorf("failed to replace %s: %w", path, err), os.Remove(tmp.Name()))
	}
	return nil
}

// IsWebSocket reports whether Restly saved this item as a WebSocket request.
func (item *Item) IsWebSocket() bool {
	var kind string
	return json.Unmarshal(item.orig[TypeKey], &kind) == nil && kind == TypeWebSocket
}

// members holds an object's JSON members as read from the file.
type members map[string]json.RawMessage

// decode fills target, a pointer to a method-less copy of the struct, and returns the members read.
func decode(data []byte, target any) (members, error) {
	if err := json.Unmarshal(data, target); err != nil {
		return nil, err
	}
	var orig members
	if err := json.Unmarshal(data, &orig); err != nil {
		return nil, err
	}
	return orig, nil
}

// encode writes source, a method-less copy of the struct, over the original members.
// An empty modeled member is left out unless it was in the file or is listed in keep.
// When both the file and the struct hold an empty value, the file's form (null, "", [])
// is kept so an unchanged load and save rewrites nothing.
//
// ponytail: every nesting level re-parses its subtree, so a 5 MB collection takes about 200 ms
// to encode. The webview path skips this (App.OpenCollection and SaveCollection pass raw JSON).
// If script variable saves on large collections get slow, build the object by reflection
// without the Unmarshal and re-marshal steps.
func encode(source any, orig members, keep ...string) ([]byte, error) {
	data, err := marshal(source)
	if err != nil {
		return nil, err
	}
	var current members
	if err := json.Unmarshal(data, &current); err != nil {
		return nil, err
	}
	out := maps.Clone(orig)
	if out == nil {
		out = make(members, len(current))
	}
	for key, raw := range current {
		old, had := orig[key]
		switch {
		case !isEmpty(raw):
			out[key] = raw
		case had && isEmpty(old):
		case had || slices.Contains(keep, key):
			out[key] = raw
		}
	}
	return marshal(out)
}

// marshal is json.Marshal without HTML escaping, so "&" in URLs stays readable in saved files.
func marshal(source any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(source); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

func isEmpty(raw json.RawMessage) bool {
	if len(raw) > 64 {
		return false
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return false
	}
	switch compact.String() {
	case "null", `""`, "false", "0", "[]", "{}":
		return true
	}
	return false
}

func jsonString(data []byte) (string, bool) {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || data[0] != '"' {
		return "", false
	}
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return "", false
	}
	return text, true
}

// scalarText returns a JSON value as text: strings unquoted, null as "", anything else as written.
func scalarText(raw json.RawMessage) string {
	if text, ok := jsonString(raw); ok {
		return text
	}
	trimmed := string(bytes.TrimSpace(raw))
	if trimmed == "null" {
		return ""
	}
	return trimmed
}

// headerList reads a header list, which the schema also allows as a string of "Key: Value" lines.
func headerList(raw json.RawMessage) ([]KV, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	if text, ok := jsonString(raw); ok {
		var headers []KV
		for line := range strings.Lines(text) {
			if key, value, ok := strings.Cut(line, ":"); ok {
				headers = append(headers, KV{Key: strings.TrimSpace(key), Value: strings.TrimSpace(value)})
			}
		}
		return headers, nil
	}
	var headers []KV
	if err := json.Unmarshal(raw, &headers); err != nil {
		return nil, fmt.Errorf("failed to read header list: %w", err)
	}
	return headers, nil
}

// parseRaw splits a raw URL into the protocol, host, port, and path members Postman stores beside raw.
func parseRaw(raw string) members {
	parsed := members{}
	put := func(key string, value any) {
		data, err := marshal(value)
		if err == nil {
			parsed[key] = data
		}
	}
	rest := raw
	if i := strings.IndexAny(rest, "?#"); i >= 0 {
		rest = rest[:i]
	}
	if protocol, after, ok := strings.Cut(rest, "://"); ok {
		put("protocol", protocol)
		rest = after
	}
	hostPort, path, hasPath := strings.Cut(rest, "/")
	if host, port, ok := strings.Cut(hostPort, ":"); ok {
		hostPort = host
		put("port", port)
	}
	put("host", strings.Split(hostPort, "."))
	if hasPath {
		put("path", strings.Split(path, "/"))
	}
	return parsed
}

// At returns the item at path and its ancestor folders, outermost first.
// Each path element indexes the Item slice one level down from the collection root.
func (coll *Collection) At(path []int) (*Item, []*Item, error) {
	if len(path) == 0 {
		return nil, nil, errors.New("empty item path")
	}
	items := coll.Item
	chain := make([]*Item, 0, len(path))
	for depth, index := range path {
		if index < 0 || index >= len(items) {
			return nil, nil, fmt.Errorf("no item at path %v", path[:depth+1])
		}
		chain = append(chain, items[index])
		items = items[index].Item
	}
	return chain[len(chain)-1], chain[:len(chain)-1], nil
}

// Code returns the source of the enabled scripts for listen ("prerequest" or "test"), in order.
func Code(events []Event, listen string) string {
	var sources []string
	for _, event := range events {
		if event.Listen == listen && !event.Disabled && event.Script != nil {
			sources = append(sources, strings.Join(event.Script.Exec, "\n"))
		}
	}
	return strings.Join(sources, "\n")
}

// Params returns the attributes of the auth type, such as username and password for basic.
// It reads both the v2.1 list form and the v2.0 object form.
func (auth *Auth) Params() map[string]string {
	params := map[string]string{}
	if auth == nil {
		return params
	}
	raw := auth.orig[auth.Type]
	var list []struct {
		Key   string          `json:"key"`
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(raw, &list); err == nil {
		for _, attr := range list {
			params[attr.Key] = scalarText(attr.Value)
		}
		return params
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err == nil {
		for key, value := range object {
			params[key] = scalarText(value)
		}
	}
	return params
}

func VarMap(variables []Variable) map[string]string {
	values := make(map[string]string, len(variables))
	for _, variable := range variables {
		if !variable.Disabled {
			values[variable.Key] = variable.Value
		}
	}
	return values
}

// SetVars makes the enabled variables match values. Existing entries keep their position,
// removed keys are dropped, and new keys are appended in name order.
func SetVars(variables []Variable, values map[string]string) []Variable {
	seen := map[string]bool{}
	out := make([]Variable, 0, len(values))
	for _, variable := range variables {
		if !variable.Disabled {
			value, ok := values[variable.Key]
			if !ok {
				continue
			}
			seen[variable.Key] = true
			variable.Value = value
		}
		out = append(out, variable)
	}
	for _, key := range slices.Sorted(maps.Keys(values)) {
		if !seen[key] {
			out = append(out, Variable{Key: key, Value: values[key]})
		}
	}
	return out
}

func EnvMap(envValues []EnvValue) map[string]string {
	values := make(map[string]string, len(envValues))
	for _, envValue := range envValues {
		if envValue.Enabled {
			values[envValue.Key] = envValue.Value
		}
	}
	return values
}

// SetEnv is SetVars for environment values.
func SetEnv(envValues []EnvValue, values map[string]string) []EnvValue {
	seen := map[string]bool{}
	out := make([]EnvValue, 0, len(values))
	for _, envValue := range envValues {
		if envValue.Enabled {
			value, ok := values[envValue.Key]
			if !ok {
				continue
			}
			seen[envValue.Key] = true
			envValue.Value = value
		}
		out = append(out, envValue)
	}
	for _, key := range slices.Sorted(maps.Keys(values)) {
		if !seen[key] {
			out = append(out, EnvValue{Key: key, Value: values[key], Type: "default", Enabled: true})
		}
	}
	return out
}
