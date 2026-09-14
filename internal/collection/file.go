package collection

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// DetectKind reports whether a Postman export holds a v2 collection or an environment.
// It returns "" for anything else, including v1 collections.
func DetectKind(data []byte) string {
	var probe struct {
		Info   json.RawMessage `json:"info"`
		Values json.RawMessage `json:"values"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return ""
	}
	switch {
	case probe.Info != nil:
		return KindCollection
	case probe.Values != nil:
		return KindEnvironment
	}
	return ""
}

// LoadCollection reads a v2.1 or v2.0 collection. v2.0 auth is upgraded to the v2.1 form.
func LoadCollection(path string) (*Collection, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read collection: %w", err)
	}
	if DetectKind(data) != KindCollection {
		return nil, fmt.Errorf("%s is not a Postman v2.0 or v2.1 collection (v1 exports are not supported)", filepath.Base(path))
	}
	var coll Collection
	if err := json.Unmarshal(data, &coll); err != nil {
		return nil, fmt.Errorf("failed to parse collection %s: %w", filepath.Base(path), err)
	}
	if strings.Contains(coll.Info.Schema, "v2.0.0") {
		if err := upgradeAuth(&coll); err != nil {
			return nil, fmt.Errorf("failed to upgrade v2.0 collection %s: %w", filepath.Base(path), err)
		}
	}
	return &coll, nil
}

func SaveCollection(path string, coll *Collection) error {
	coll.Info.Schema = SchemaV21
	return writeJSON(path, coll)
}

func LoadEnvironment(path string) (*Environment, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read environment: %w", err)
	}
	var env Environment
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, fmt.Errorf("failed to parse environment %s: %w", filepath.Base(path), err)
	}
	return &env, nil
}

func SaveEnvironment(path string, env *Environment) error {
	return writeJSON(path, env)
}

func upgradeAuth(coll *Collection) error {
	auths := []*Auth{coll.Auth}
	var walk func(items []*Item)
	walk = func(items []*Item) {
		for _, item := range items {
			auths = append(auths, item.Auth)
			if item.Request != nil {
				auths = append(auths, item.Request.Auth)
			}
			walk(item.Item)
		}
	}
	walk(coll.Item)
	for _, auth := range auths {
		if err := auth.upgrade(); err != nil {
			return err
		}
	}
	return nil
}

// upgrade rewrites v2.0 attributes, stored as an object, into the v2.1 list of key, value, and type.
func (auth *Auth) upgrade() error {
	if auth == nil {
		return nil
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(auth.orig[auth.Type], &object); err != nil {
		return nil // already a list, or no attributes
	}
	type attribute struct {
		Key   string          `json:"key"`
		Value json.RawMessage `json:"value"`
		Type  string          `json:"type"`
	}
	list := make([]attribute, 0, len(object))
	for _, key := range slices.Sorted(maps.Keys(object)) {
		list = append(list, attribute{Key: key, Value: object[key], Type: "string"})
	}
	data, err := marshal(list)
	if err != nil {
		return fmt.Errorf("failed to encode %s auth: %w", auth.Type, err)
	}
	auth.orig = maps.Clone(auth.orig)
	auth.orig[auth.Type] = data
	return nil
}
