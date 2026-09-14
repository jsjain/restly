package httpx

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// roundTripperFunc adapts a plain function to http.RoundTripper.
type roundTripperFunc func(*http.Request) (*http.Response, error)

func (roundTrip roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return roundTrip(req)
}

// hostMatches reports whether entryHost (already lowercased, from ClientCert.Host) matches
// requestHost (a URL host, possibly with a port). An entry with a port requires an exact
// host:port match; without one it matches the host on any port.
func hostMatches(entryHost, requestHost string) bool {
	requestHost = strings.ToLower(requestHost)
	if strings.Contains(entryHost, ":") {
		return entryHost == requestHost
	}
	hostPart := requestHost
	if parsedHost, _, err := net.SplitHostPort(requestHost); err == nil {
		hostPart = parsedHost
	}
	return entryHost == hostPart
}

func isIPHost(host string) bool {
	return net.ParseIP(host) != nil
}

// domainMatches reports whether requestHost domain-matches cookieDomain per RFC 6265 5.1.3.
func domainMatches(cookieDomain, requestHost string) bool {
	if cookieDomain == requestHost {
		return true
	}
	if !strings.HasSuffix(requestHost, "."+cookieDomain) {
		return false
	}
	return !isIPHost(requestHost)
}

// defaultPath implements RFC 6265 5.1.4.
func defaultPath(requestPath string) string {
	if requestPath == "" || requestPath[0] != '/' {
		return "/"
	}
	lastSlash := strings.LastIndexByte(requestPath, '/')
	if lastSlash == 0 {
		return "/"
	}
	return requestPath[:lastSlash]
}

// pathMatches implements the path-match algorithm of RFC 6265 5.1.4.
func pathMatches(cookiePath, requestPath string) bool {
	if cookiePath == requestPath {
		return true
	}
	if !strings.HasPrefix(requestPath, cookiePath) {
		return false
	}
	if strings.HasSuffix(cookiePath, "/") {
		return true
	}
	return requestPath[len(cookiePath)] == '/'
}

func isSecureScheme(scheme string) bool {
	scheme = strings.ToLower(scheme)
	return scheme == "https" || scheme == "wss"
}

// writeFileAtomic writes data to a temp file in the same directory as path, then renames it
// into place, so a crash or concurrent read never sees a partially written file.
func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	tempFile, err := os.CreateTemp(dir, ".cookiejar-*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp file for %s: %w", path, err)
	}
	tempPath := tempFile.Name()
	succeeded := false
	defer func() {
		if !succeeded {
			os.Remove(tempPath) // best-effort cleanup; the write already failed
		}
	}()

	if _, err := tempFile.Write(data); err != nil {
		tempFile.Close()
		return fmt.Errorf("failed to write temp file for %s: %w", path, err)
	}
	if err := tempFile.Close(); err != nil {
		return fmt.Errorf("failed to close temp file for %s: %w", path, err)
	}
	if err := os.Chmod(tempPath, mode); err != nil {
		return fmt.Errorf("failed to set permissions on %s: %w", path, err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("failed to save %s: %w", path, err)
	}
	succeeded = true
	return nil
}
