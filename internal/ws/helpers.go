package ws

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"restly/internal/httpx"
)

// forbiddenHandshakeHeaders are set by gorilla itself; passing them through Dial fails the request.
var forbiddenHandshakeHeaders = []string{
	"Upgrade",
	"Connection",
	"Sec-Websocket-Key",
	"Sec-Websocket-Version",
	"Sec-Websocket-Extensions",
}

// normalizeWebSocketURL converts http/https schemes to ws/wss and passes ws/wss through as-is.
func normalizeWebSocketURL(rawURL string) (*url.URL, error) {
	if rawURL == "" {
		return nil, fmt.Errorf("WebSocket URL is empty")
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse WebSocket URL: %w", err)
	}

	switch strings.ToLower(parsed.Scheme) {
	case "ws", "wss":
	case "http":
		parsed.Scheme = "ws"
	case "https":
		parsed.Scheme = "wss"
	default:
		return nil, fmt.Errorf("unsupported WebSocket URL scheme %q", parsed.Scheme)
	}

	if parsed.Host == "" {
		return nil, fmt.Errorf("WebSocket URL %q has no host", rawURL)
	}

	return parsed, nil
}

// stripForbiddenHeaders drops the headers gorilla's Dialer refuses to accept, matched
// case-insensitively, and keeps every other header including Sec-WebSocket-Protocol.
func stripForbiddenHeaders(header http.Header) http.Header {
	cleaned := make(http.Header, len(header))
	for key, values := range header {
		if isForbiddenHandshakeHeader(key) {
			continue
		}
		cleaned[key] = values
	}
	return cleaned
}

func isForbiddenHandshakeHeader(key string) bool {
	for _, forbidden := range forbiddenHandshakeHeaders {
		if strings.EqualFold(key, forbidden) {
			return true
		}
	}
	return false
}

// flattenHeader turns a response header into the sorted list format EventOpen carries.
func flattenHeader(header http.Header) []httpx.Header {
	flattened := make([]httpx.Header, 0, len(header))
	for key, values := range header {
		for _, value := range values {
			flattened = append(flattened, httpx.Header{Key: key, Value: value})
		}
	}

	sort.Slice(flattened, func(i, j int) bool {
		if flattened[i].Key == flattened[j].Key {
			return flattened[i].Value < flattened[j].Value
		}
		return flattened[i].Key < flattened[j].Key
	})

	return flattened
}

// describeHandshakeError builds a readable message for a failed Dial, including the response
// status and up to 1 KB of its body when the server sent one back.
func describeHandshakeError(dialErr error, response *http.Response) string {
	if response == nil {
		return fmt.Sprintf("handshake failed: %v", dialErr)
	}
	defer func() { _ = response.Body.Close() }() // best-effort: the handshake already failed

	message := fmt.Sprintf("handshake failed: %s", response.Status)

	body, readErr := io.ReadAll(io.LimitReader(response.Body, maxHandshakeErrorBodyBytes))
	if readErr == nil && len(body) > 0 {
		message += ": " + string(body)
	}
	return message
}
