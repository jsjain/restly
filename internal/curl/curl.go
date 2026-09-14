// Package curl turns a pasted cURL command into a Postman v2.1 request item.
package curl

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"restly/internal/collection"
)

// Parse converts a cURL command line into a Postman request item.
func Parse(command string) (*collection.Item, error) {
	tokens, err := tokenize(command)
	if err != nil {
		return nil, fmt.Errorf("failed to tokenize cURL command: %w", err)
	}
	if len(tokens) == 0 || tokens[0] != "curl" {
		return nil, errors.New("input does not start with curl")
	}
	parsed, err := parseArgs(tokens)
	if err != nil {
		return nil, fmt.Errorf("failed to parse cURL flags: %w", err)
	}
	item, err := buildItem(parsed)
	if err != nil {
		return nil, fmt.Errorf("failed to build request from cURL command: %w", err)
	}
	return item, nil
}

// parseArgs walks the tokens after "curl", applying every recognized flag to a
// parsedCommand and treating the first bare token as the URL.
func parseArgs(tokens []string) (*parsedCommand, error) {
	parsed := &parsedCommand{}
	for index := 1; index < len(tokens); index++ {
		token := tokens[index]
		switch {
		case token == "--":
			for index++; index < len(tokens); index++ {
				if !parsed.urlSet {
					parsed.url, parsed.urlSet = tokens[index], true
				}
			}
		case strings.HasPrefix(token, "--"):
			name, inlineValue, hasInline := strings.Cut(token[2:], "=")
			spec, known := lookupLongFlag(name)
			if !known {
				continue // unknown flag: skip it alone and continue
			}
			value := inlineValue
			if spec.takesValue && !hasInline {
				index++
				if index >= len(tokens) {
					return nil, fmt.Errorf("flag --%s needs a value", name)
				}
				value = tokens[index]
			}
			if err := parsed.apply(spec.kind, value); err != nil {
				return nil, err
			}
		case strings.HasPrefix(token, "-") && len(token) > 1:
			next, err := parseShortBundle(parsed, tokens, index)
			if err != nil {
				return nil, err
			}
			index = next
		default:
			if !parsed.urlSet {
				parsed.url, parsed.urlSet = token, true
			}
		}
	}
	return parsed, nil
}

// parseShortBundle handles combined short flags such as "-sSL" and "-sSLX POST", and the
// attached-value form "-XPOST". It returns the token index to resume from.
func parseShortBundle(parsed *parsedCommand, tokens []string, tokenIndex int) (int, error) {
	letters := tokens[tokenIndex][1:]
	for pos := 0; pos < len(letters); pos++ {
		spec, known := lookupShortFlag(letters[pos])
		if !known {
			continue // unknown flag letter: skip it alone and continue
		}
		if !spec.takesValue {
			if err := parsed.apply(spec.kind, ""); err != nil {
				return tokenIndex, err
			}
			continue
		}
		if pos+1 < len(letters) {
			return tokenIndex, parsed.apply(spec.kind, letters[pos+1:])
		}
		tokenIndex++
		if tokenIndex >= len(tokens) {
			return tokenIndex, fmt.Errorf("flag -%c needs a value", letters[pos])
		}
		return tokenIndex, parsed.apply(spec.kind, tokens[tokenIndex])
	}
	return tokenIndex, nil
}

// apply updates parsedCommand for one recognized flag occurrence.
func (parsed *parsedCommand) apply(kind flagKind, value string) error {
	switch kind {
	case flagURL:
		parsed.url, parsed.urlSet = value, true
	case flagMethod:
		parsed.method, parsed.methodSet = value, true
	case flagHeader:
		key, headerValue, ok := strings.Cut(value, ":")
		if !ok {
			return fmt.Errorf(`malformed header %q: expected "Key: Value"`, value)
		}
		parsed.headers = append(parsed.headers, kvPair{strings.TrimSpace(key), strings.TrimLeft(headerValue, " ")})
	case flagData:
		parsed.dataParts = append(parsed.dataParts, value)
		parsed.dataFlagCount++
		if path, ok := strings.CutPrefix(value, "@"); ok {
			parsed.fileCandidates = append(parsed.fileCandidates, path)
		}
	case flagDataRaw:
		parsed.dataParts = append(parsed.dataParts, value)
		parsed.dataFlagCount++
	case flagDataURLEncode:
		parsed.dataParts = append(parsed.dataParts, encodeDataURLEncode(value))
		parsed.dataURLEncodeCount++
	case flagForm:
		field, err := parseFormField(value, true)
		if err != nil {
			return err
		}
		parsed.formFields = append(parsed.formFields, field)
	case flagFormString:
		field, err := parseFormField(value, false)
		if err != nil {
			return err
		}
		parsed.formFields = append(parsed.formFields, field)
	case flagUser:
		user, pass, _ := strings.Cut(value, ":")
		parsed.basicUser, parsed.basicPass, parsed.hasBasicAuth = user, pass, true
	case flagCookie:
		if strings.Contains(value, "=") {
			parsed.headers = append(parsed.headers, kvPair{"Cookie", value})
		}
	case flagUserAgent:
		parsed.headers = append(parsed.headers, kvPair{"User-Agent", value})
	case flagReferer:
		parsed.headers = append(parsed.headers, kvPair{"Referer", value})
	case flagGet:
		parsed.getFlag = true
	case flagHead:
		parsed.headFlag = true
	case flagIgnore:
		// deliberately does nothing to the request
	}
	return nil
}

// buildItem turns the parsed flags into a Postman item, via JSON so the collection
// package's own unmarshaling fills in what it derives (such as URL host/path).
func buildItem(parsed *parsedCommand) (*collection.Item, error) {
	if !parsed.urlSet || parsed.url == "" {
		return nil, errors.New("no URL found in cURL command")
	}

	method := resolveMethod(parsed)

	rawURL := parsed.url
	if parsed.getFlag {
		if queryText := strings.Join(parsed.dataParts, "&"); queryText != "" {
			rawURL = appendRawQuery(rawURL, queryText)
		}
		parsed.dataParts = nil
	}

	request := postmanRequest{Method: method, URL: buildURLObject(rawURL)}
	for _, header := range parsed.headers {
		request.Header = append(request.Header, postmanKV{Key: header.Key, Value: header.Value})
	}

	body, extraHeader := buildBody(parsed)
	request.Body = body
	if extraHeader != nil {
		request.Header = append(request.Header, *extraHeader)
	}

	if parsed.hasBasicAuth {
		request.Auth = &postmanAuth{
			Type: "basic",
			Basic: []postmanKV{
				{Key: "username", Value: parsed.basicUser, Type: "string"},
				{Key: "password", Value: parsed.basicPass, Type: "string"},
			},
		}
	}

	item := postmanItem{Name: deriveName(method, parsed.url), Request: request}
	data, err := json.Marshal(item)
	if err != nil {
		return nil, fmt.Errorf("failed to encode parsed request as JSON: %w", err)
	}
	var collectionItem collection.Item
	if err := json.Unmarshal(data, &collectionItem); err != nil {
		return nil, fmt.Errorf("failed to decode parsed request into a collection item: %w", err)
	}
	return &collectionItem, nil
}

func resolveMethod(parsed *parsedCommand) string {
	switch {
	case parsed.methodSet:
		return parsed.method
	case parsed.headFlag:
		return "HEAD"
	case !parsed.getFlag && (len(parsed.dataParts) > 0 || len(parsed.formFields) > 0):
		return "POST"
	default:
		return "GET"
	}
}

// buildURLObject sets raw to the URL exactly as given, and mirrors its query string
// (if any) into key/value pairs exactly as they appear, with no decoding: httpx's own
// query encoder is idempotent on already-encoded text, so this round-trips correctly.
func buildURLObject(rawURL string) postmanURL {
	urlObject := postmanURL{Raw: rawURL}
	_, query, hasQuery := strings.Cut(rawURL, "?")
	if !hasQuery || query == "" {
		return urlObject
	}
	for segment := range strings.SplitSeq(query, "&") {
		key, value, _ := strings.Cut(segment, "=")
		urlObject.Query = append(urlObject.Query, postmanKV{Key: key, Value: value})
	}
	return urlObject
}

// buildBody decides the Postman body mode from the parsed flags, and reports an extra
// header to add when httpx would otherwise send a different Content-Type than curl does.
func buildBody(parsed *parsedCommand) (*postmanBody, *postmanKV) {
	if len(parsed.formFields) > 0 {
		body := &postmanBody{Mode: "formdata"}
		for _, field := range parsed.formFields {
			if field.IsFile {
				body.FormData = append(body.FormData, postmanKV{Key: field.Key, Type: "file", Src: field.Value})
			} else {
				body.FormData = append(body.FormData, postmanKV{Key: field.Key, Type: "text", Value: field.Value})
			}
		}
		return body, nil
	}

	if !parsed.getFlag && len(parsed.fileCandidates) == 1 && parsed.dataFlagCount == 1 && parsed.dataURLEncodeCount == 0 {
		return &postmanBody{Mode: "file", File: &postmanFile{Src: parsed.fileCandidates[0]}}, nil
	}

	dataText := strings.Join(parsed.dataParts, "&")
	if dataText == "" {
		return nil, nil
	}

	contentType, hasContentType := findHeader(parsed.headers, "Content-Type")
	// JSON sent without a Content-Type is common in hand-written commands, and a value like {"a":"b=c"} would split as a form pair.
	isJSON := json.Valid([]byte(dataText))
	treatAsForm := !isJSON && (!hasContentType || strings.Contains(strings.ToLower(contentType), defaultContentTypeForData))
	if treatAsForm {
		if pairs, ok := decodeFormBody(dataText); ok {
			body := &postmanBody{Mode: "urlencoded"}
			for _, pair := range pairs {
				body.URLEncoded = append(body.URLEncoded, postmanKV{Key: pair.Key, Value: pair.Value})
			}
			return body, nil
		}
	}

	language := ""
	if strings.Contains(strings.ToLower(contentType), "json") || isJSON {
		language = "json"
	}
	body := &postmanBody{Mode: "raw", Raw: dataText}
	if language != "" {
		body.Options = &postmanBodyOptions{Raw: postmanRawOptions{Language: language}}
	}
	var extraHeader *postmanKV
	if !hasContentType {
		// httpx defaults an untyped raw body to text/plain; curl always defaults a
		// -d/--data-family body to this Content-Type, so make it explicit.
		extraHeader = &postmanKV{Key: "Content-Type", Value: defaultContentTypeForData}
	}
	return body, extraHeader
}
