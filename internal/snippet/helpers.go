package snippet

import (
	"encoding/json"
	"fmt"
	"strings"

	"restly/internal/httpx"
)

// jsToken renders text as a double-quoted string literal valid in JS, JSON, and Python.
// json.Marshal never fails on a string; the panic path is unreachable defense.
func jsToken(text string) string {
	encoded, err := json.Marshal(text)
	if err != nil {
		panic(fmt.Sprintf("marshal string literal: %v", err))
	}
	return string(encoded)
}

func shellQuote(text string) string {
	return "'" + strings.ReplaceAll(text, "'", `'\''`) + "'"
}

var curlFormReplacer = strings.NewReplacer(`\`, `\\`, `"`, `\"`)

func curlFormEscape(text string) string {
	return curlFormReplacer.Replace(text)
}

// headerObjectLiteral renders headers as a single-line object literal, valid in both JS and Python.
func headerObjectLiteral(headers []httpx.Header) string {
	if len(headers) == 0 {
		return "{}"
	}
	pairs := make([]string, len(headers))
	for i, header := range headers {
		pairs[i] = fmt.Sprintf("%s: %s", jsToken(header.Key), jsToken(header.Value))
	}
	return "{ " + strings.Join(pairs, ", ") + " }"
}

// contentTypeOrDefault mirrors httpx.Client's fallback for form file parts with no explicit type.
func contentTypeOrDefault(contentType string) string {
	if contentType == "" {
		return "application/octet-stream"
	}
	return contentType
}
