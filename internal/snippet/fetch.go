package snippet

import (
	"fmt"
	"path/filepath"
	"strings"

	"restly/internal/httpx"
)

func generateFetch(prep *httpx.Prepared) string {
	var builder strings.Builder

	fmt.Fprintf(&builder, "const url = %s;\n\n", jsToken(prep.URL))

	optionLines := []string{
		fmt.Sprintf("method: %s", jsToken(prep.Method)),
		"headers: " + headerObjectLiteral(prep.Header),
	}

	switch {
	case len(prep.Form) > 0:
		builder.WriteString("const formdata = new FormData();\n")
		for _, part := range prep.Form {
			if part.File != "" {
				builder.WriteString("// replace fileInput with the actual file input element or Blob\n")
				fmt.Fprintf(&builder, "formdata.append(%s, fileInput.files[0], %s);\n", jsToken(part.Key), jsToken(filepath.Base(part.File)))
			} else {
				fmt.Fprintf(&builder, "formdata.append(%s, %s);\n", jsToken(part.Key), jsToken(part.Value))
			}
		}
		builder.WriteString("\n")
		optionLines = append(optionLines, "body: formdata")
	case prep.BodyFile != "":
		fmt.Fprintf(&builder, "// body reads from %s at send time; replace `file` with your File/Blob\n", prep.BodyFile)
		optionLines = append(optionLines, "body: file")
	case len(prep.Body) > 0:
		optionLines = append(optionLines, "body: "+jsToken(string(prep.Body)))
	}

	optionLines = append(optionLines, `redirect: "follow"`)

	builder.WriteString("const options = {\n")
	for _, line := range optionLines {
		fmt.Fprintf(&builder, "  %s,\n", line)
	}
	builder.WriteString("};\n\n")

	builder.WriteString("fetch(url, options)\n")
	builder.WriteString("  .then((response) => response.text())\n")
	builder.WriteString("  .then((result) => console.log(result))\n")
	builder.WriteString("  .catch((error) => console.error(error));\n")

	return builder.String()
}
