// Package collection reads and writes Postman Collection v2.1 and environment files.
// They are Restly's storage format, so a load followed by a save must keep every field.
//
// Each type keeps the JSON members it was read from in orig. MarshalJSON writes the
// modeled fields over them, so members Restly does not model survive a save.
package collection

import (
	"encoding/json"
	"maps"
	"strings"
)

type Collection struct {
	Info     Info       `json:"info"`
	Item     []*Item    `json:"item"`
	Event    []Event    `json:"event"`
	Variable []Variable `json:"variable"`
	Auth     *Auth      `json:"auth"`
	orig     members
}

func (coll *Collection) UnmarshalJSON(data []byte) error {
	type plain Collection
	orig, err := decode(data, (*plain)(coll))
	coll.orig = orig
	return err
}

func (coll Collection) MarshalJSON() ([]byte, error) {
	type plain Collection
	if coll.Item == nil {
		coll.Item = []*Item{}
	}
	return encode(plain(coll), coll.orig, "info", "item")
}

type Info struct {
	PostmanID string `json:"_postman_id"`
	Name      string `json:"name"`
	Schema    string `json:"schema"`
	orig      members
}

func (info *Info) UnmarshalJSON(data []byte) error {
	type plain Info
	orig, err := decode(data, (*plain)(info))
	info.orig = orig
	return err
}

func (info Info) MarshalJSON() ([]byte, error) {
	type plain Info
	return encode(plain(info), info.orig, "name", "schema")
}

// Item is a request, or a folder when Request is nil.
type Item struct {
	Name     string     `json:"name"`
	Request  *Request   `json:"request"`
	Item     []*Item    `json:"item"`
	Event    []Event    `json:"event"`
	Variable []Variable `json:"variable"`
	Auth     *Auth      `json:"auth"`
	orig     members
}

func (item *Item) IsFolder() bool {
	return item.Request == nil
}

func (item *Item) UnmarshalJSON(data []byte) error {
	type plain Item
	orig, err := decode(data, (*plain)(item))
	item.orig = orig
	return err
}

func (item Item) MarshalJSON() ([]byte, error) {
	type plain Item
	if item.Request != nil {
		return encode(plain(item), item.orig, "name")
	}
	if item.Item == nil {
		// Postman rejects an item that has neither "request" nor "item".
		item.Item = []*Item{}
	}
	return encode(plain(item), item.orig, "name", "item")
}

type Request struct {
	Method string `json:"method"`
	URL    *URL   `json:"url"`
	Header []KV   `json:"header"`
	Body   *Body  `json:"body"`
	Auth   *Auth  `json:"auth"`
	orig   members
}

func (req *Request) UnmarshalJSON(data []byte) error {
	if raw, ok := jsonString(data); ok {
		// The schema allows a request to be only its URL.
		*req = Request{Method: "GET", URL: &URL{Raw: raw}}
		return nil
	}
	type plain Request
	var shadow struct {
		*plain
		Header json.RawMessage `json:"header"`
	}
	shadow.plain = (*plain)(req)
	orig, err := decode(data, &shadow)
	if err != nil {
		return err
	}
	req.orig = orig
	req.Header, err = headerList(shadow.Header)
	return err
}

func (req Request) MarshalJSON() ([]byte, error) {
	type plain Request
	return encode(plain(req), req.orig, "method")
}

// URL keeps raw as the source of truth. Restly sends raw, with the query replaced by
// the enabled Query entries when Query is not empty.
type URL struct {
	Raw      string `json:"raw"`
	Query    []KV   `json:"query"`
	Variable []KV   `json:"variable"`
	orig     members
	str      bool // read as a plain JSON string
}

func (url *URL) UnmarshalJSON(data []byte) error {
	if raw, ok := jsonString(data); ok {
		*url = URL{Raw: raw, str: true}
		return nil
	}
	type plain URL
	orig, err := decode(data, (*plain)(url))
	url.orig = orig
	return err
}

func (url URL) MarshalJSON() ([]byte, error) {
	if url.str && len(url.Query) == 0 && len(url.Variable) == 0 {
		return marshal(url.Raw)
	}
	orig := url.orig
	if _, ok := orig["host"]; !ok && url.Raw != "" {
		// The UI drops host and path when raw is edited. Postman needs them to import the URL.
		orig = maps.Clone(orig)
		if orig == nil {
			orig = members{}
		}
		maps.Copy(orig, parseRaw(url.Raw))
	}
	type plain URL
	return encode(plain(url), orig, "raw")
}

// KV is a header, query parameter, path variable, urlencoded field, or formdata field.
type KV struct {
	Key      string          `json:"key"`
	Value    string          `json:"value"`
	Disabled bool            `json:"disabled"`
	Type     string          `json:"type"` // formdata only: "text" or "file"
	Src      json.RawMessage `json:"src"`  // formdata file: a path string, a list of paths, or null
	orig     members
}

func (field *KV) UnmarshalJSON(data []byte) error {
	type plain KV
	var shadow struct {
		*plain
		Value json.RawMessage `json:"value"`
	}
	shadow.plain = (*plain)(field)
	orig, err := decode(data, &shadow)
	field.orig = orig
	field.Value = scalarText(shadow.Value)
	return err
}

func (field KV) MarshalJSON() ([]byte, error) {
	type plain KV
	if field.Type == "file" {
		// File fields carry src instead of value.
		return encode(plain(field), field.orig, "key")
	}
	return encode(plain(field), field.orig, "key", "value")
}

// Files returns the paths of a formdata file field.
func (field *KV) Files() []string {
	if path, ok := jsonString(field.Src); ok {
		return []string{path}
	}
	var paths []string
	if err := json.Unmarshal(field.Src, &paths); err != nil {
		return nil
	}
	return paths
}

type Body struct {
	Mode       string    `json:"mode"` // raw, urlencoded, formdata, file, or graphql
	Raw        string    `json:"raw"`
	URLEncoded []KV      `json:"urlencoded"`
	FormData   []KV      `json:"formdata"`
	File       *BodyFile `json:"file"`
	GraphQL    *GraphQL  `json:"graphql"`
	orig       members
}

func (body *Body) UnmarshalJSON(data []byte) error {
	type plain Body
	orig, err := decode(data, (*plain)(body))
	body.orig = orig
	return err
}

func (body Body) MarshalJSON() ([]byte, error) {
	type plain Body
	return encode(plain(body), body.orig, "mode")
}

// RawLanguage returns options.raw.language, such as "json", or "" when it is not set.
func (body *Body) RawLanguage() string {
	var options struct {
		Raw struct {
			Language string `json:"language"`
		} `json:"raw"`
	}
	if err := json.Unmarshal(body.orig["options"], &options); err != nil {
		return ""
	}
	return options.Raw.Language
}

type BodyFile struct {
	Src  string `json:"src"`
	orig members
}

func (file *BodyFile) UnmarshalJSON(data []byte) error {
	type plain BodyFile
	orig, err := decode(data, (*plain)(file))
	file.orig = orig
	return err
}

func (file BodyFile) MarshalJSON() ([]byte, error) {
	type plain BodyFile
	return encode(plain(file), file.orig)
}

type GraphQL struct {
	Query     string `json:"query"`
	Variables string `json:"variables"` // JSON text, as Postman stores it
	orig      members
}

func (gql *GraphQL) UnmarshalJSON(data []byte) error {
	type plain GraphQL
	orig, err := decode(data, (*plain)(gql))
	gql.orig = orig
	return err
}

func (gql GraphQL) MarshalJSON() ([]byte, error) {
	type plain GraphQL
	return encode(plain(gql), gql.orig, "query")
}

type Event struct {
	Listen   string  `json:"listen"` // "prerequest" or "test"
	Script   *Script `json:"script"`
	Disabled bool    `json:"disabled"`
	orig     members
}

func (event *Event) UnmarshalJSON(data []byte) error {
	type plain Event
	orig, err := decode(data, (*plain)(event))
	event.orig = orig
	return err
}

func (event Event) MarshalJSON() ([]byte, error) {
	type plain Event
	return encode(plain(event), event.orig, "listen")
}

type Script struct {
	Type string   `json:"type"`
	Exec []string `json:"exec"`
	orig members
	str  bool // exec was read as one string
}

func (script *Script) UnmarshalJSON(data []byte) error {
	type plain Script
	var shadow struct {
		*plain
		Exec json.RawMessage `json:"exec"`
	}
	shadow.plain = (*plain)(script)
	orig, err := decode(data, &shadow)
	if err != nil {
		return err
	}
	script.orig = orig
	if code, ok := jsonString(shadow.Exec); ok {
		script.Exec, script.str = strings.Split(code, "\n"), true
		return nil
	}
	if len(shadow.Exec) == 0 {
		return nil
	}
	return json.Unmarshal(shadow.Exec, &script.Exec)
}

func (script Script) MarshalJSON() ([]byte, error) {
	type plain Script
	if !script.str {
		return encode(plain(script), script.orig, "exec")
	}
	shadow := struct {
		plain
		Exec string `json:"exec"`
	}{plain(script), strings.Join(script.Exec, "\n")}
	return encode(shadow, script.orig, "exec")
}

// Auth models only the type. The attributes stay in orig and are read with Params.
type Auth struct {
	Type string `json:"type"`
	orig members
}

func (auth *Auth) UnmarshalJSON(data []byte) error {
	type plain Auth
	orig, err := decode(data, (*plain)(auth))
	auth.orig = orig
	return err
}

func (auth Auth) MarshalJSON() ([]byte, error) {
	type plain Auth
	return encode(plain(auth), auth.orig, "type")
}

type Variable struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Type     string `json:"type"`
	Disabled bool   `json:"disabled"`
	orig     members
}

func (variable *Variable) UnmarshalJSON(data []byte) error {
	type plain Variable
	var shadow struct {
		*plain
		Value json.RawMessage `json:"value"`
	}
	shadow.plain = (*plain)(variable)
	orig, err := decode(data, &shadow)
	variable.orig = orig
	variable.Value = scalarText(shadow.Value)
	return err
}

func (variable Variable) MarshalJSON() ([]byte, error) {
	type plain Variable
	if old, ok := variable.orig["value"]; ok && scalarText(old) == variable.Value {
		// Keeps a number or boolean value from being rewritten as a string.
		shadow := struct {
			plain
			Value json.RawMessage `json:"value"`
		}{plain(variable), old}
		return encode(shadow, variable.orig, "key", "value")
	}
	return encode(plain(variable), variable.orig, "key", "value")
}

// Environment is a Postman environment file. Globals use the same shape.
type Environment struct {
	ID     string     `json:"id"`
	Name   string     `json:"name"`
	Values []EnvValue `json:"values"`
	Scope  string     `json:"_postman_variable_scope"` // "environment" or "globals"
	// Collection is the file name of the collection that owns this environment, "" for a shared one.
	// No omitempty: encode must see "" to remove an owner the file already has.
	Collection string `json:"x-restly-collection"`
	orig       members
}

func (env *Environment) UnmarshalJSON(data []byte) error {
	type plain Environment
	orig, err := decode(data, (*plain)(env))
	env.orig = orig
	return err
}

func (env Environment) MarshalJSON() ([]byte, error) {
	type plain Environment
	if env.Values == nil {
		env.Values = []EnvValue{}
	}
	return encode(plain(env), env.orig, "name", "values")
}

type EnvValue struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Type    string `json:"type"` // "default" or "secret"
	Enabled bool   `json:"enabled"`
	orig    members
}

func (value *EnvValue) UnmarshalJSON(data []byte) error {
	type plain EnvValue
	value.Enabled = true // a value without "enabled" is in use
	var shadow struct {
		*plain
		Value json.RawMessage `json:"value"`
	}
	shadow.plain = (*plain)(value)
	orig, err := decode(data, &shadow)
	value.orig = orig
	value.Value = scalarText(shadow.Value)
	return err
}

func (value EnvValue) MarshalJSON() ([]byte, error) {
	type plain EnvValue
	return encode(plain(value), value.orig, "key", "value", "enabled")
}
