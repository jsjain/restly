package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

// cookieKey identifies a stored cookie the way RFC 6265 storage does: by domain, path, and name.
type cookieKey struct {
	domain string
	path   string
	name   string
}

// storedCookie is the internal representation; Cookie is the JSON-facing view used by List and Put.
type storedCookie struct {
	name     string
	value    string
	domain   string // lowercased, no leading dot
	path     string
	hostOnly bool
	secure   bool
	httpOnly bool
	expires  time.Time // zero means a session cookie
	created  time.Time
}

// NewJar returns an empty, listable, persistent cookie jar.
func NewJar() *Jar {
	return &Jar{entries: make(map[cookieKey]storedCookie)}
}

// SetCookies implements http.CookieJar for responses received on target.
func (jar *Jar) SetCookies(target *url.URL, cookies []*http.Cookie) {
	jar.mu.Lock()
	defer jar.mu.Unlock()
	requestHost := strings.ToLower(target.Hostname())
	requestPath := target.EscapedPath()
	for _, cookie := range cookies {
		jar.setCookieLocked(requestHost, requestPath, cookie)
	}
}

func (jar *Jar) setCookieLocked(requestHost, requestPath string, cookie *http.Cookie) {
	if cookie.Name == "" {
		return
	}
	domain, hostOnly, accepted := domainForCookie(requestHost, cookie.Domain)
	if !accepted {
		return // Domain attribute doesn't domain-match the request host; RFC 6265 5.3 rejects it
	}
	path := cookie.Path
	if path == "" || path[0] != '/' {
		path = defaultPath(requestPath)
	}
	expires, deleted := resolveExpiry(cookie.MaxAge, cookie.Expires)
	key := cookieKey{domain: domain, path: path, name: cookie.Name}
	if deleted {
		delete(jar.entries, key)
		return
	}
	created := time.Now()
	if existing, ok := jar.entries[key]; ok {
		created = existing.created // replacing a cookie keeps its original creation time
	}
	jar.entries[key] = storedCookie{
		name:     cookie.Name,
		value:    cookie.Value,
		domain:   domain,
		path:     path,
		hostOnly: hostOnly,
		secure:   cookie.Secure,
		httpOnly: cookie.HttpOnly,
		expires:  expires,
		created:  created,
	}
}

// domainForCookie applies RFC 6265 5.3's domain acceptance rule.
//
// ponytail: no public-suffix check, so a server could in principle set a very broad Domain
// (e.g. "co.uk") and match every subdomain; add golang.org/x/net/publicsuffix if Restly ever
// needs to resist a malicious multi-tenant host.
func domainForCookie(requestHost, domainAttr string) (domain string, hostOnly bool, accepted bool) {
	if domainAttr == "" || isIPHost(requestHost) {
		return requestHost, true, true
	}
	candidate := strings.ToLower(strings.TrimPrefix(domainAttr, "."))
	if !domainMatches(candidate, requestHost) {
		return "", false, false
	}
	return candidate, false, true
}

// resolveExpiry returns the cookie's expiry, or deleted=true when MaxAge or Expires says to remove it.
func resolveExpiry(maxAge int, expiresAttr time.Time) (expires time.Time, deleted bool) {
	if maxAge < 0 {
		return time.Time{}, true
	}
	if maxAge > 0 {
		return time.Now().Add(time.Duration(maxAge) * time.Second), false
	}
	if !expiresAttr.IsZero() {
		if expiresAttr.Before(time.Now()) {
			return time.Time{}, true
		}
		return expiresAttr, false
	}
	return time.Time{}, false // session cookie
}

// Cookies implements http.CookieJar for requests being sent to target.
func (jar *Jar) Cookies(target *url.URL) []*http.Cookie {
	jar.mu.Lock()
	defer jar.mu.Unlock()
	requestHost := strings.ToLower(target.Hostname())
	requestPath := target.EscapedPath()
	if requestPath == "" {
		requestPath = "/"
	}
	secureAllowed := isSecureScheme(target.Scheme)
	now := time.Now()

	var matches []storedCookie
	for key, entry := range jar.entries {
		if !entry.expires.IsZero() && !entry.expires.After(now) {
			delete(jar.entries, key) // lazily purge expired cookies
			continue
		}
		if entry.secure && !secureAllowed {
			continue
		}
		if entry.hostOnly {
			if entry.domain != requestHost {
				continue
			}
		} else if !domainMatches(entry.domain, requestHost) {
			continue
		}
		if !pathMatches(entry.path, requestPath) {
			continue
		}
		matches = append(matches, entry)
	}
	sort.Slice(matches, func(i, j int) bool {
		if len(matches[i].path) != len(matches[j].path) {
			return len(matches[i].path) > len(matches[j].path)
		}
		return matches[i].created.Before(matches[j].created)
	})

	result := make([]*http.Cookie, 0, len(matches))
	for _, entry := range matches {
		result = append(result, &http.Cookie{Name: entry.name, Value: entry.value})
	}
	return result
}

// List returns every stored, non-expired cookie sorted by domain, then path, then name.
func (jar *Jar) List() []Cookie {
	jar.mu.Lock()
	defer jar.mu.Unlock()
	now := time.Now()
	result := make([]Cookie, 0, len(jar.entries))
	for key, entry := range jar.entries {
		if !entry.expires.IsZero() && !entry.expires.After(now) {
			delete(jar.entries, key)
			continue
		}
		result = append(result, toCookie(entry))
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Domain != result[j].Domain {
			return result[i].Domain < result[j].Domain
		}
		if result[i].Path != result[j].Path {
			return result[i].Path < result[j].Path
		}
		return result[i].Name < result[j].Name
	})
	return result
}

func toCookie(entry storedCookie) Cookie {
	expires := ""
	if !entry.expires.IsZero() {
		expires = entry.expires.UTC().Format(http.TimeFormat)
	}
	return Cookie{
		Name:     entry.name,
		Value:    entry.value,
		Domain:   entry.domain,
		Path:     entry.path,
		Expires:  expires,
		HTTPOnly: entry.httpOnly,
		Secure:   entry.secure,
		HostOnly: entry.hostOnly,
	}
}

// Put adds cookie, or replaces the stored one with the same domain, path, and name.
func (jar *Jar) Put(cookie Cookie) error {
	if cookie.Name == "" {
		return errors.New("cookie name is required")
	}
	if cookie.Domain == "" {
		return errors.New("cookie domain is required")
	}
	domain := strings.ToLower(cookie.Domain)
	hostOnly := cookie.HostOnly
	if strings.HasPrefix(domain, ".") {
		domain = domain[1:]
		hostOnly = false
	}
	path := cookie.Path
	if path == "" {
		path = "/"
	}
	expires, deleted, err := parseExpires(cookie.Expires)
	if err != nil {
		return err
	}

	jar.mu.Lock()
	defer jar.mu.Unlock()
	key := cookieKey{domain: domain, path: path, name: cookie.Name}
	if deleted {
		delete(jar.entries, key)
		return nil
	}
	created := time.Now()
	if existing, ok := jar.entries[key]; ok {
		created = existing.created
	}
	jar.entries[key] = storedCookie{
		name:     cookie.Name,
		value:    cookie.Value,
		domain:   domain,
		path:     path,
		hostOnly: hostOnly,
		secure:   cookie.Secure,
		httpOnly: cookie.HTTPOnly,
		expires:  expires,
		created:  created,
	}
	return nil
}

// parseExpires accepts "" (session), http.TimeFormat, or RFC 1123.
func parseExpires(text string) (expires time.Time, deleted bool, err error) {
	if text == "" {
		return time.Time{}, false, nil
	}
	parsed, err := time.Parse(http.TimeFormat, text)
	if err != nil {
		parsed, err = time.Parse(time.RFC1123, text)
	}
	if err != nil {
		return time.Time{}, false, fmt.Errorf("failed to parse cookie expiry %q: %w", text, err)
	}
	if parsed.Before(time.Now()) {
		return time.Time{}, true, nil
	}
	return parsed, false, nil
}

// Delete removes one cookie identified by its storage key.
func (jar *Jar) Delete(domain, path, name string) {
	jar.mu.Lock()
	defer jar.mu.Unlock()
	delete(jar.entries, cookieKey{domain: strings.ToLower(domain), path: path, name: name})
}

// Clear removes every cookie.
func (jar *Jar) Clear() {
	jar.mu.Lock()
	defer jar.mu.Unlock()
	jar.entries = make(map[cookieKey]storedCookie)
}

// persistedCookie is the on-disk JSON shape for Save and Load.
type persistedCookie struct {
	Name     string    `json:"name"`
	Value    string    `json:"value"`
	Domain   string    `json:"domain"`
	Path     string    `json:"path"`
	HostOnly bool      `json:"hostOnly"`
	Secure   bool      `json:"secure"`
	HTTPOnly bool      `json:"httpOnly"`
	Expires  time.Time `json:"expires"` // zero value means a session cookie
	Created  time.Time `json:"created"`
}

// Save writes every non-expired cookie, session cookies included, as JSON, atomically and
// with mode 0600.
func (jar *Jar) Save(path string) error {
	jar.mu.Lock()
	now := time.Now()
	persisted := make([]persistedCookie, 0, len(jar.entries))
	for key, entry := range jar.entries {
		if !entry.expires.IsZero() && !entry.expires.After(now) {
			delete(jar.entries, key)
			continue
		}
		persisted = append(persisted, persistedCookie{
			Name:     entry.name,
			Value:    entry.value,
			Domain:   entry.domain,
			Path:     entry.path,
			HostOnly: entry.hostOnly,
			Secure:   entry.secure,
			HTTPOnly: entry.httpOnly,
			Expires:  entry.expires,
			Created:  entry.created,
		})
	}
	jar.mu.Unlock()

	data, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode cookie jar: %w", err)
	}
	if err := writeFileAtomic(path, data, 0o600); err != nil {
		return err
	}
	return nil
}

// Load replaces the stored cookies with the ones saved at path. A missing file clears the
// jar and returns nil.
func (jar *Jar) Load(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			jar.mu.Lock()
			jar.entries = make(map[cookieKey]storedCookie)
			jar.mu.Unlock()
			return nil
		}
		return fmt.Errorf("failed to read cookie jar %s: %w", path, err)
	}
	var persisted []persistedCookie
	if err := json.Unmarshal(data, &persisted); err != nil {
		return fmt.Errorf("failed to parse cookie jar %s: %w", path, err)
	}
	entries := make(map[cookieKey]storedCookie, len(persisted))
	for _, entry := range persisted {
		key := cookieKey{domain: entry.Domain, path: entry.Path, name: entry.Name}
		entries[key] = storedCookie{
			name:     entry.Name,
			value:    entry.Value,
			domain:   entry.Domain,
			path:     entry.Path,
			hostOnly: entry.HostOnly,
			secure:   entry.Secure,
			httpOnly: entry.HTTPOnly,
			expires:  entry.Expires,
			created:  entry.Created,
		}
	}

	jar.mu.Lock()
	jar.entries = entries
	jar.mu.Unlock()
	return nil
}
