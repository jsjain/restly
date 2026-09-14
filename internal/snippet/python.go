package snippet

import (
	"fmt"
	"path/filepath"
	"strings"

	"restly/internal/httpx"
)

func generatePython(prep *httpx.Prepared) string {
	var builder strings.Builder

	builder.WriteString("import requests\n\n")
	fmt.Fprintf(&builder, "url = %s\n\n", jsToken(prep.URL))

	var dataArg, filesArg string

	switch {
	case len(prep.Form) > 0:
		var textParts, fileParts []string
		for _, part := range prep.Form {
			if part.File != "" {
				fileParts = append(fileParts, fmt.Sprintf(
					"    (%s, (%s, open(%s, 'rb'), %s))",
					jsToken(part.Key), jsToken(filepath.Base(part.File)), jsToken(part.File), jsToken(contentTypeOrDefault(part.ContentType)),
				))
				continue
			}
			textParts = append(textParts, fmt.Sprintf("%s: %s", jsToken(part.Key), jsToken(part.Value)))
		}
		if len(textParts) > 0 {
			fmt.Fprintf(&builder, "payload = {%s}\n", strings.Join(textParts, ", "))
			dataArg = "payload"
		}
		if len(fileParts) > 0 {
			fmt.Fprintf(&builder, "files = [\n%s\n]\n", strings.Join(fileParts, ",\n"))
			filesArg = "files"
		}
	case prep.BodyFile != "":
		fmt.Fprintf(&builder, "payload = open(%s, 'rb')\n", jsToken(prep.BodyFile))
		dataArg = "payload"
	case len(prep.Body) > 0:
		fmt.Fprintf(&builder, "payload = %s\n", jsToken(string(prep.Body)))
		dataArg = "payload"
	}

	fmt.Fprintf(&builder, "headers = %s\n\n", headerObjectLiteral(prep.Header))

	callArgs := []string{jsToken(prep.Method), "url", "headers=headers"}
	if dataArg != "" {
		callArgs = append(callArgs, "data="+dataArg)
	}
	if filesArg != "" {
		callArgs = append(callArgs, "files="+filesArg)
	}
	fmt.Fprintf(&builder, "response = requests.request(%s)\n\n", strings.Join(callArgs, ", "))
	builder.WriteString("print(response.text)\n")

	return builder.String()
}
