// Package snippet generates code that sends a prepared request.
package snippet

import (
	"fmt"
	"strings"

	"restly/internal/httpx"
)

// Langs lists the supported languages in menu order.
var Langs = []string{"curl", "fetch", "python", "go"}

// Generate renders prep as a standalone snippet in the given language. prep has
// variables already substituted and auth applied, so this only prints it.
func Generate(lang string, prep *httpx.Prepared) (string, error) {
	switch lang {
	case "curl":
		return generateCurl(prep), nil
	case "fetch":
		return generateFetch(prep), nil
	case "python":
		return generatePython(prep), nil
	case "go":
		return generateGo(prep), nil
	default:
		return "", fmt.Errorf("unsupported snippet language %q (want one of %s)", lang, strings.Join(Langs, ", "))
	}
}
