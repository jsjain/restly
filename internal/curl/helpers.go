package curl

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// tokenize splits a command line the way a POSIX shell would: single and double quotes,
// $'...' ANSI-C strings, and backslash escapes and line continuations. It also treats a
// caret-newline (cmd.exe's line continuation, from Chrome's "Copy as cURL (cmd)") as a
// continuation, since bash never gives '^' any meaning of its own, so this is free to add.
func tokenize(command string) ([]string, error) {
	command = strings.TrimPrefix(strings.TrimSpace(command), "$ ")
	runes := []rune(command)
	var tokens []string
	var current strings.Builder
	inToken := false
	index := 0
	for index < len(runes) {
		char := runes[index]
		switch {
		case char == ' ' || char == '\t' || char == '\n' || char == '\r':
			if inToken {
				tokens = append(tokens, current.String())
				current.Reset()
				inToken = false
			}
			index++
		case char == '\'':
			content, next, err := scanSingleQuoted(runes, index+1)
			if err != nil {
				return nil, err
			}
			current.WriteString(content)
			inToken, index = true, next
		case char == '"':
			content, next, err := scanDoubleQuoted(runes, index+1)
			if err != nil {
				return nil, err
			}
			current.WriteString(content)
			inToken, index = true, next
		case char == '$' && index+1 < len(runes) && runes[index+1] == '\'':
			content, next, err := scanANSICQuoted(runes, index+2)
			if err != nil {
				return nil, err
			}
			current.WriteString(content)
			inToken, index = true, next
		case char == '\\' && index+1 < len(runes) && runes[index+1] == '\n':
			index += 2 // line continuation: no separator, no character emitted
		case char == '\\':
			if index+1 >= len(runes) {
				return nil, errors.New("trailing backslash at end of command")
			}
			current.WriteRune(runes[index+1])
			inToken, index = true, index+2
		case char == '^' && isLineEnd(runes, index+1):
			index = skipLineEnd(runes, index+1) // cmd.exe line continuation
		default:
			current.WriteRune(char)
			inToken, index = true, index+1
		}
	}
	if inToken {
		tokens = append(tokens, current.String())
	}
	return tokens, nil
}

func isLineEnd(runes []rune, index int) bool {
	if index >= len(runes) {
		return false
	}
	if runes[index] == '\n' {
		return true
	}
	return runes[index] == '\r' && index+1 < len(runes) && runes[index+1] == '\n'
}

func skipLineEnd(runes []rune, index int) int {
	if runes[index] == '\r' {
		return index + 2
	}
	return index + 1
}

func scanSingleQuoted(runes []rune, start int) (content string, next int, err error) {
	for index := start; index < len(runes); index++ {
		if runes[index] == '\'' {
			return string(runes[start:index]), index + 1, nil
		}
	}
	return "", 0, errors.New("unterminated single quote")
}

// scanDoubleQuoted follows POSIX: backslash keeps its meaning only before $, `, ", \,
// and newline (a continuation); any other backslash is kept in the output literally.
func scanDoubleQuoted(runes []rune, start int) (content string, next int, err error) {
	var out strings.Builder
	index := start
	for index < len(runes) {
		char := runes[index]
		if char == '"' {
			return out.String(), index + 1, nil
		}
		if char == '\\' && index+1 < len(runes) {
			switch escaped := runes[index+1]; escaped {
			case '\\', '"', '$', '`':
				out.WriteRune(escaped)
				index += 2
				continue
			case '\n':
				index += 2 // continuation
				continue
			}
		}
		out.WriteRune(char)
		index++
	}
	return "", 0, errors.New("unterminated double quote")
}

// scanANSICQuoted interprets $'...' escapes: the common backslash letters plus \xHH.
// Octal and \u/\U escapes are not supported.
func scanANSICQuoted(runes []rune, start int) (content string, next int, err error) {
	var out strings.Builder
	index := start
	for index < len(runes) {
		char := runes[index]
		if char == '\'' {
			return out.String(), index + 1, nil
		}
		if char == '\\' && index+1 < len(runes) {
			escaped := runes[index+1]
			switch escaped {
			case 'n':
				out.WriteByte('\n')
				index += 2
			case 't':
				out.WriteByte('\t')
				index += 2
			case 'r':
				out.WriteByte('\r')
				index += 2
			case 'a':
				out.WriteByte('\a')
				index += 2
			case 'b':
				out.WriteByte('\b')
				index += 2
			case 'f':
				out.WriteByte('\f')
				index += 2
			case 'v':
				out.WriteByte('\v')
				index += 2
			case '\\', '\'', '"':
				out.WriteRune(escaped)
				index += 2
			case 'x':
				hexEnd := index + 2
				for hexEnd < len(runes) && hexEnd < index+4 && isHexDigit(runes[hexEnd]) {
					hexEnd++
				}
				if hexEnd == index+2 {
					out.WriteRune(char)
					index++
					continue
				}
				value, _ := strconv.ParseInt(string(runes[index+2:hexEnd]), 16, 32)
				out.WriteRune(rune(value))
				index = hexEnd
			default:
				out.WriteRune(escaped)
				index += 2
			}
			continue
		}
		out.WriteRune(char)
		index++
	}
	return "", 0, errors.New("unterminated $'...' string")
}

func isHexDigit(char rune) bool {
	return (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')
}

func lookupLongFlag(name string) (flagSpec, bool) {
	for _, spec := range flagTable {
		if spec.long == name {
			return spec, true
		}
	}
	return flagSpec{}, false
}

func lookupShortFlag(letter byte) (flagSpec, bool) {
	for _, spec := range flagTable {
		if spec.short == letter {
			return spec, true
		}
	}
	return flagSpec{}, false
}

func findHeader(headers []kvPair, key string) (string, bool) {
	for _, header := range headers {
		if strings.EqualFold(header.Key, key) {
			return header.Value, true
		}
	}
	return "", false
}

func appendRawQuery(rawURL, extra string) string {
	if strings.Contains(rawURL, "?") {
		return rawURL + "&" + extra
	}
	return rawURL + "?" + extra
}

// deriveName gives a curl-imported item a short name, such as "GET /users/42", or the
// host when the URL has no path.
func deriveName(method, rawURL string) string {
	probe := rawURL
	if !strings.Contains(probe, "://") {
		probe = "http://" + probe
	}
	parsed, err := url.Parse(probe)
	if err != nil || parsed.Host == "" {
		return method + " " + rawURL
	}
	if parsed.Path == "" || parsed.Path == "/" {
		return method + " " + parsed.Host
	}
	return method + " " + parsed.Path
}

// encodeDataURLEncode renders one --data-urlencode value the way curl does: "name=value"
// URL-encodes only the value, "=value" URL-encodes the value with no leading "=", and a
// bare "value" URL-encodes the whole string.
func encodeDataURLEncode(value string) string {
	name, content, hasEquals := strings.Cut(value, "=")
	if !hasEquals {
		return url.QueryEscape(value)
	}
	if name == "" {
		return url.QueryEscape(content)
	}
	return name + "=" + url.QueryEscape(content)
}

// decodeFormBody reports whether data is exactly what httpx's own urlencoded-body
// builder would produce from some set of key/value pairs, and returns those pairs
// decoded. Requiring the round trip, not just successful decoding, is what rejects a
// JSON body, a bare key, or any escaping httpx would re-encode differently: mode
// "urlencoded" only fires when it reproduces curl's exact bytes.
func decodeFormBody(data string) ([]kvPair, bool) {
	if data == "" {
		return nil, false
	}
	segments := strings.Split(data, "&")
	pairs := make([]kvPair, 0, len(segments))
	reencoded := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment == "" {
			return nil, false
		}
		key, value, _ := strings.Cut(segment, "=")
		decodedKey, err := url.QueryUnescape(key)
		if err != nil {
			return nil, false
		}
		decodedValue, err := url.QueryUnescape(value)
		if err != nil {
			return nil, false
		}
		pairs = append(pairs, kvPair{decodedKey, decodedValue})
		reencoded = append(reencoded, url.QueryEscape(decodedKey)+"="+url.QueryEscape(decodedValue))
	}
	if strings.Join(reencoded, "&") != data {
		return nil, false
	}
	return pairs, true
}

// parseFormField reads one -F/--form-string value. allowFile enables the "@path" file
// form, which --form-string never treats specially.
func parseFormField(value string, allowFile bool) (formField, error) {
	name, rest, ok := strings.Cut(value, "=")
	if !ok {
		return formField{}, fmt.Errorf("malformed form field %q: expected name=value", value)
	}
	isFile := allowFile && strings.HasPrefix(rest, "@")
	content := rest
	if isFile {
		content = rest[1:]
	}
	if len(content) >= 2 && content[0] == '"' && content[len(content)-1] == '"' {
		content = curlFormUnescape(content[1 : len(content)-1])
	} else {
		content, _, _ = strings.Cut(content, ";") // drop ;type=...;filename=... suffixes
	}
	return formField{Key: name, Value: content, IsFile: isFile}, nil
}

// curlFormUnescape reverses the backslash escaping curl's own -F value quoting uses
// (and that Restly's snippet generator applies): \" and \\ are the only two sequences.
func curlFormUnescape(text string) string {
	var out strings.Builder
	for index := 0; index < len(text); index++ {
		if text[index] == '\\' && index+1 < len(text) && (text[index+1] == '"' || text[index+1] == '\\') {
			out.WriteByte(text[index+1])
			index++
			continue
		}
		out.WriteByte(text[index])
	}
	return out.String()
}
