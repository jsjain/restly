package httpx

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/url"
	"path/filepath"
	"strings"

	"restly/internal/collection"
	"restly/internal/vars"
)

// Resolve substitutes variables in the request and applies auth, the effective auth
// after inheritance, or nil for none.
func Resolve(req *collection.Request, auth *collection.Auth, scope *vars.Scope) (*Prepared, error) {
	method := strings.ToUpper(scope.Replace(req.Method))
	if method == "" {
		method = "GET"
	}
	rawURL, err := buildURL(req.URL, scope)
	if err != nil {
		return nil, err
	}
	prep := &Prepared{
		Method: method,
		URL:    rawURL,
		Header: buildHeaders(req.Header, scope),
	}
	if err := buildBody(prep, req.Body, scope); err != nil {
		return nil, err
	}
	applyAuth(prep, auth, scope)
	applyDefaultHeaders(prep)
	return prep, nil
}

func buildURL(reqURL *collection.URL, scope *vars.Scope) (string, error) {
	if reqURL == nil {
		return "", errors.New("request has no URL")
	}
	raw := scope.Replace(reqURL.Raw)
	if raw == "" {
		return "", errors.New("request has no URL")
	}
	raw = replacePathVariables(raw, reqURL.Variable, scope)
	if len(reqURL.Query) > 0 {
		raw = replaceQuery(raw, reqURL.Query, scope)
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	if _, err := url.Parse(raw); err != nil {
		return "", fmt.Errorf("invalid request URL %q: %w", raw, err)
	}
	return raw, nil
}

func replacePathVariables(raw string, variables []collection.KV, scope *vars.Scope) string {
	if len(variables) == 0 {
		return raw
	}
	before, path := splitHostAndPath(raw)
	if path == "" {
		return raw
	}
	values := make(map[string]string, len(variables))
	for _, variable := range variables {
		values[scope.Replace(variable.Key)] = scope.Replace(variable.Value)
	}
	segments := strings.Split(path, "/")
	for i, segment := range segments {
		if !strings.HasPrefix(segment, ":") {
			continue
		}
		if value, ok := values[segment[1:]]; ok {
			segments[i] = value
		}
	}
	return before + strings.Join(segments, "/")
}

// splitHostAndPath finds where the path starts so a ":name" path variable isn't confused
// with a ":port". Simplification: a literal "/" inside a query value ahead of any real path
// can fool it, but the segments are rejoined unchanged unless one matches a variable, so an
// unmatched raw URL comes back byte-for-byte.
func splitHostAndPath(raw string) (before, path string) {
	searchStart := 0
	if idx := strings.Index(raw, "://"); idx >= 0 {
		searchStart = idx + 3
	}
	if slash := strings.IndexByte(raw[searchStart:], '/'); slash >= 0 {
		return raw[:searchStart+slash], raw[searchStart+slash:]
	}
	return raw, ""
}

func replaceQuery(raw string, queryParams []collection.KV, scope *vars.Scope) string {
	if idx := strings.IndexAny(raw, "?#"); idx >= 0 {
		raw = raw[:idx]
	}
	var parts []string
	for _, param := range queryParams {
		// The URL bar leaves out rows without a key, so sending them would send a URL the user never saw.
		if param.Disabled || param.Key == "" {
			continue
		}
		key := encodeQueryComponent(scope.Replace(param.Key), true)
		value := encodeQueryComponent(scope.Replace(param.Value), false)
		parts = append(parts, key+"="+value)
	}
	if len(parts) == 0 {
		return raw
	}
	return raw + "?" + strings.Join(parts, "&")
}

// encodeQueryComponent follows postman-url-encoder: only C0 controls, a handful of
// specials, non-ASCII bytes, and "=" within a key are percent-encoded.
func encodeQueryComponent(text string, isKey bool) string {
	var builder strings.Builder
	for i := 0; i < len(text); i++ {
		char := text[i]
		if needsEncoding(char, isKey) {
			fmt.Fprintf(&builder, "%%%02X", char)
		} else {
			builder.WriteByte(char)
		}
	}
	return builder.String()
}

func needsEncoding(char byte, isKey bool) bool {
	if char < 0x20 || char >= 0x7F {
		return true
	}
	if strings.IndexByte(encodeSpecials, char) >= 0 {
		return true
	}
	return isKey && char == '='
}

// appendQueryParam is used by apikey auth with in=="query"; it reuses the same encoding
// as the query builder above so both paths agree on what gets escaped.
func appendQueryParam(rawURL, key, value string) string {
	separator := "?"
	if strings.Contains(rawURL, "?") {
		separator = "&"
	}
	return rawURL + separator + encodeQueryComponent(key, true) + "=" + encodeQueryComponent(value, false)
}

func buildHeaders(entries []collection.KV, scope *vars.Scope) []Header {
	var headers []Header
	for _, entry := range entries {
		if entry.Disabled || entry.Key == "" {
			continue
		}
		headers = append(headers, Header{Key: scope.Replace(entry.Key), Value: scope.Replace(entry.Value)})
	}
	return headers
}

func hasHeader(headers []Header, key string) bool {
	for _, header := range headers {
		if strings.EqualFold(header.Key, key) {
			return true
		}
	}
	return false
}

func buildBody(prep *Prepared, body *collection.Body, scope *vars.Scope) error {
	if body == nil || body.Mode == "" {
		return nil
	}
	switch body.Mode {
	case "raw":
		buildRawBody(prep, body, scope)
	case "urlencoded":
		buildURLEncodedBody(prep, body, scope)
	case "formdata":
		buildFormDataBody(prep, body, scope)
	case "file":
		if body.File != nil {
			prep.BodyFile = scope.Replace(body.File.Src)
		}
	case "graphql":
		return buildGraphQLBody(prep, body, scope)
	}
	return nil
}

func buildRawBody(prep *Prepared, body *collection.Body, scope *vars.Scope) {
	raw := scope.Replace(body.Raw)
	prep.Body = []byte(raw)
	if raw != "" && !hasHeader(prep.Header, "Content-Type") {
		prep.Header = append(prep.Header, Header{Key: "Content-Type", Value: rawContentType(body.RawLanguage())})
	}
}

func rawContentType(language string) string {
	switch language {
	case "json":
		return "application/json"
	case "xml":
		return "application/xml"
	case "html":
		return "text/html"
	case "javascript":
		return "application/javascript"
	default:
		return "text/plain"
	}
}

func buildURLEncodedBody(prep *Prepared, body *collection.Body, scope *vars.Scope) {
	var parts []string
	for _, field := range body.URLEncoded {
		if field.Disabled || field.Key == "" {
			continue
		}
		parts = append(parts, url.QueryEscape(scope.Replace(field.Key))+"="+url.QueryEscape(scope.Replace(field.Value)))
	}
	prep.Body = []byte(strings.Join(parts, "&"))
	if !hasHeader(prep.Header, "Content-Type") {
		prep.Header = append(prep.Header, Header{Key: "Content-Type", Value: "application/x-www-form-urlencoded"})
	}
}

func buildFormDataBody(prep *Prepared, body *collection.Body, scope *vars.Scope) {
	for _, field := range body.FormData {
		// A multipart part needs a name, so an unnamed row cannot be sent.
		if field.Disabled || field.Key == "" {
			continue
		}
		if field.Type == "file" {
			for _, path := range field.Files() {
				filePath := scope.Replace(path)
				prep.Form = append(prep.Form, FormPart{
					Key:         scope.Replace(field.Key),
					File:        filePath,
					ContentType: fileContentType(filePath),
				})
			}
			continue
		}
		prep.Form = append(prep.Form, FormPart{Key: scope.Replace(field.Key), Value: scope.Replace(field.Value)})
	}
}

func fileContentType(path string) string {
	if contentType := mime.TypeByExtension(filepath.Ext(path)); contentType != "" {
		return contentType
	}
	return "application/octet-stream"
}

type graphQLPayload struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables,omitempty"`
}

func buildGraphQLBody(prep *Prepared, body *collection.Body, scope *vars.Scope) error {
	if body.GraphQL == nil {
		return nil
	}
	payload := graphQLPayload{Query: scope.Replace(body.GraphQL.Query)}
	variablesText := strings.TrimSpace(scope.Replace(body.GraphQL.Variables))
	if variablesText != "" {
		var variables json.RawMessage
		if err := json.Unmarshal([]byte(variablesText), &variables); err != nil {
			return fmt.Errorf("failed to parse graphql variables: %w", err)
		}
		payload.Variables = variables
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to encode graphql body: %w", err)
	}
	prep.Body = data
	if !hasHeader(prep.Header, "Content-Type") {
		prep.Header = append(prep.Header, Header{Key: "Content-Type", Value: "application/json"})
	}
	return nil
}

func applyAuth(prep *Prepared, auth *collection.Auth, scope *vars.Scope) {
	if auth == nil || auth.Type == "" || auth.Type == "noauth" {
		return
	}
	params := auth.Params()
	substituted := make(map[string]string, len(params))
	for key, value := range params {
		substituted[key] = scope.Replace(value)
	}
	authorizationPresent := hasHeader(prep.Header, "Authorization")
	switch auth.Type {
	case "basic":
		if authorizationPresent {
			return
		}
		credentials := substituted["username"] + ":" + substituted["password"]
		encoded := base64.StdEncoding.EncodeToString([]byte(credentials))
		prep.Header = append(prep.Header, Header{Key: "Authorization", Value: "Basic " + encoded})
	case "bearer":
		if authorizationPresent {
			return
		}
		prep.Header = append(prep.Header, Header{Key: "Authorization", Value: "Bearer " + substituted["token"]})
	case "apikey":
		key, value := substituted["key"], substituted["value"]
		if substituted["in"] == "query" {
			prep.URL = appendQueryParam(prep.URL, key, value)
			return
		}
		if authorizationPresent && strings.EqualFold(key, "Authorization") {
			return
		}
		prep.Header = append(prep.Header, Header{Key: key, Value: value})
	}
}

func applyDefaultHeaders(prep *Prepared) {
	if !hasHeader(prep.Header, "User-Agent") {
		prep.Header = append(prep.Header, Header{Key: "User-Agent", Value: defaultUserAgent})
	}
	if !hasHeader(prep.Header, "Accept") {
		prep.Header = append(prep.Header, Header{Key: "Accept", Value: defaultAccept})
	}
}
