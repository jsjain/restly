package snippet

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"restly/internal/httpx"
)

// generateGo builds a complete net/http program. Body construction mirrors
// httpx.Client.assembleBody/buildMultipart so the snippet sends the same bytes.
func generateGo(prep *httpx.Prepared) string {
	imports := map[string]bool{"fmt": true, "io": true, "net/http": true}
	var bodySetup strings.Builder
	bodyReader := "nil"

	switch {
	case len(prep.Form) > 0:
		imports["bytes"] = true
		imports["mime/multipart"] = true
		imports["net/textproto"] = true
		imports["os"] = true
		writeGoFormBody(&bodySetup, prep.Form)
		bodyReader = "&requestBody"

	case prep.BodyFile != "":
		imports["os"] = true
		fmt.Fprintf(&bodySetup, "\trequestBody, err := os.Open(%s)\n\tif err != nil {\n\t\tfmt.Println(\"open body file:\", err)\n\t\treturn\n\t}\n\tdefer requestBody.Close()\n", strconv.Quote(prep.BodyFile))
		bodyReader = "requestBody"

	case len(prep.Body) > 0:
		imports["bytes"] = true
		fmt.Fprintf(&bodySetup, "\trequestBody := bytes.NewReader([]byte(%s))\n", strconv.Quote(string(prep.Body)))
		bodyReader = "requestBody"
	}

	var headerSetup strings.Builder
	if len(prep.Form) > 0 {
		headerSetup.WriteString("\trequest.Header.Set(\"Content-Type\", writer.FormDataContentType())\n")
	}
	for _, header := range prep.Header {
		fmt.Fprintf(&headerSetup, "\trequest.Header.Add(%s, %s)\n", strconv.Quote(header.Key), strconv.Quote(header.Value))
	}

	var program strings.Builder
	program.WriteString("package main\n\nimport (\n")
	program.WriteString(sortedQuotedImports(imports))
	program.WriteString(")\n\n")
	program.WriteString("func main() {\n")
	fmt.Fprintf(&program, "\tmethod := %s\n\trequestURL := %s\n\n", strconv.Quote(prep.Method), strconv.Quote(prep.URL))
	program.WriteString(bodySetup.String())
	program.WriteString("\n")
	fmt.Fprintf(&program, "\trequest, err := http.NewRequest(method, requestURL, %s)\n\tif err != nil {\n\t\tfmt.Println(\"build request:\", err)\n\t\treturn\n\t}\n\n", bodyReader)
	program.WriteString(headerSetup.String())
	program.WriteString("\n")
	program.WriteString("\tresponse, err := http.DefaultClient.Do(request)\n\tif err != nil {\n\t\tfmt.Println(\"send request:\", err)\n\t\treturn\n\t}\n\tdefer response.Body.Close()\n\n")
	program.WriteString("\tresponseBody, err := io.ReadAll(response.Body)\n\tif err != nil {\n\t\tfmt.Println(\"read response body:\", err)\n\t\treturn\n\t}\n\n")
	program.WriteString("\tfmt.Println(response.Status)\n\tfmt.Println(string(responseBody))\n")
	program.WriteString("}\n")

	return program.String()
}

// writeGoFormBody mirrors httpx.Client.buildMultipart so the generated program sends identical bytes.
func writeGoFormBody(bodySetup *strings.Builder, parts []httpx.FormPart) {
	bodySetup.WriteString("\tvar requestBody bytes.Buffer\n")
	bodySetup.WriteString("\twriter := multipart.NewWriter(&requestBody)\n\n")

	fileIndex := 0
	for _, part := range parts {
		if part.File == "" {
			fmt.Fprintf(bodySetup, "\tif err := writer.WriteField(%s, %s); err != nil {\n\t\tfmt.Println(\"write field:\", err)\n\t\treturn\n\t}\n\n", strconv.Quote(part.Key), strconv.Quote(part.Value))
			continue
		}

		fileVar := fmt.Sprintf("formFile%d", fileIndex)
		headerVar := fmt.Sprintf("formHeader%d", fileIndex)
		partVar := fmt.Sprintf("formPart%d", fileIndex)
		fileIndex++

		disposition := fmt.Sprintf(`form-data; name=%q; filename=%q`, part.Key, filepath.Base(part.File))
		contentType := contentTypeOrDefault(part.ContentType)

		fmt.Fprintf(bodySetup, "\t%s, err := os.Open(%s)\n\tif err != nil {\n\t\tfmt.Println(\"open %s:\", err)\n\t\treturn\n\t}\n\tdefer %s.Close()\n\n", fileVar, strconv.Quote(part.File), part.Key, fileVar)
		fmt.Fprintf(bodySetup, "\t%s := textproto.MIMEHeader{}\n\t%s.Set(\"Content-Disposition\", %s)\n\t%s.Set(\"Content-Type\", %s)\n", headerVar, headerVar, strconv.Quote(disposition), headerVar, strconv.Quote(contentType))
		fmt.Fprintf(bodySetup, "\t%s, err := writer.CreatePart(%s)\n\tif err != nil {\n\t\tfmt.Println(\"create form part:\", err)\n\t\treturn\n\t}\n", partVar, headerVar)
		fmt.Fprintf(bodySetup, "\tif _, err := io.Copy(%s, %s); err != nil {\n\t\tfmt.Println(\"copy form file:\", err)\n\t\treturn\n\t}\n\n", partVar, fileVar)
	}

	bodySetup.WriteString("\tif err := writer.Close(); err != nil {\n\t\tfmt.Println(\"close multipart writer:\", err)\n\t\treturn\n\t}\n")
}

func sortedQuotedImports(imports map[string]bool) string {
	names := slices.Sorted(maps.Keys(imports))

	var block strings.Builder
	for _, name := range names {
		fmt.Fprintf(&block, "\t%s\n", strconv.Quote(name))
	}
	return block.String()
}
