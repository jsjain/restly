// Package vars resolves {{name}} references against Postman's variable scopes.
package vars

import (
	"regexp"
	"strings"
)

// Scope holds one map per Postman scope. Scripts change the maps in place, and the caller
// writes them back to the collection and environment files.
type Scope struct {
	Local       map[string]string
	Data        map[string]string
	Environment map[string]string
	Collection  map[string]string
	Globals     map[string]string
}

func New() *Scope {
	return &Scope{
		Local:       map[string]string{},
		Data:        map[string]string{},
		Environment: map[string]string{},
		Collection:  map[string]string{},
		Globals:     map[string]string{},
	}
}

// Get looks a name up from the narrowest scope to the widest.
func (scope *Scope) Get(name string) (string, bool) {
	for _, layer := range []map[string]string{scope.Local, scope.Data, scope.Environment, scope.Collection, scope.Globals} {
		if value, ok := layer[name]; ok {
			return value, true
		}
	}
	return "", false
}

var reference = regexp.MustCompile(`\{\{([^{}]+)\}\}`)

// maxDepth stops a variable that refers to itself from looping forever.
const maxDepth = 10

// Replace substitutes {{name}} and dynamic {{$guid}}-style references. Unknown names are
// left as written. A value that holds references is resolved again, up to maxDepth times.
func (scope *Scope) Replace(text string) string {
	for range maxDepth {
		if !strings.Contains(text, "{{") {
			return text
		}
		changed := false
		text = reference.ReplaceAllStringFunc(text, func(match string) string {
			name := match[2 : len(match)-2]
			if value, ok := scope.Get(name); ok {
				changed = true
				return value
			}
			if value, ok := dynamic(name); ok {
				changed = true
				return value
			}
			return match
		})
		if !changed {
			return text
		}
	}
	return text
}
