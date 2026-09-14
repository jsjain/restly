package snippet

import (
	"fmt"
	"strings"

	"restly/internal/httpx"
)

func generateCurl(prep *httpx.Prepared) string {
	lines := []string{fmt.Sprintf("curl --location --request %s %s", prep.Method, shellQuote(prep.URL))}

	for _, header := range prep.Header {
		lines = append(lines, "--header "+shellQuote(header.Key+": "+header.Value))
	}

	switch {
	case len(prep.Form) > 0:
		for _, part := range prep.Form {
			if part.File != "" {
				lines = append(lines, "--form "+shellQuote(part.Key+`=@"`+curlFormEscape(part.File)+`"`))
			} else {
				lines = append(lines, "--form "+shellQuote(part.Key+`="`+curlFormEscape(part.Value)+`"`))
			}
		}
	case prep.BodyFile != "":
		lines = append(lines, "--data-binary "+shellQuote("@"+prep.BodyFile))
	case len(prep.Body) > 0:
		lines = append(lines, "--data-raw "+shellQuote(string(prep.Body)))
	}

	return strings.Join(lines, " \\\n")
}
