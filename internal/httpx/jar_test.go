package httpx

import (
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
	"time"
)

func mustURL(t *testing.T, rawURL string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("failed to parse URL %q: %v", rawURL, err)
	}
	return parsed
}

func cookieNames(cookies []*http.Cookie) []string {
	names := make([]string, 0, len(cookies))
	for _, cookie := range cookies {
		names = append(names, cookie.Name)
	}
	return names
}

func TestJar_HostOnlyVersusDomainCookieSubdomainMatching(t *testing.T) {
	jar := NewJar()
	jar.SetCookies(mustURL(t, "http://example.com/"), []*http.Cookie{{Name: "hostonly", Value: "1"}})
	jar.SetCookies(mustURL(t, "http://example.com/"), []*http.Cookie{{Name: "domainwide", Value: "2", Domain: "example.com"}})

	rootCookies := cookieNames(jar.Cookies(mustURL(t, "http://example.com/")))
	if !slices.Contains(rootCookies, "hostonly") || !slices.Contains(rootCookies, "domainwide") {
		t.Fatalf("expected both cookies at the root domain, got %v", rootCookies)
	}

	subCookies := cookieNames(jar.Cookies(mustURL(t, "http://sub.example.com/")))
	if slices.Contains(subCookies, "hostonly") {
		t.Fatalf("host-only cookie leaked to a subdomain: %v", subCookies)
	}
	if !slices.Contains(subCookies, "domainwide") {
		t.Fatalf("domain cookie did not match a subdomain: %v", subCookies)
	}
}

func TestJar_RejectsForeignDomain(t *testing.T) {
	jar := NewJar()
	jar.SetCookies(mustURL(t, "http://example.com/"), []*http.Cookie{{Name: "evil", Value: "x", Domain: "evil.com"}})

	for _, cookie := range jar.List() {
		if cookie.Name == "evil" {
			t.Fatal("cookie with a non-matching Domain attribute was stored")
		}
	}
}

func TestJar_PathMatchingAndDefaultPath(t *testing.T) {
	jar := NewJar()
	// No Path attribute: default path is the directory of "/a/b", which is "/a".
	jar.SetCookies(mustURL(t, "http://example.com/a/b"), []*http.Cookie{{Name: "p", Value: "1"}})

	if !slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://example.com/a"))), "p") {
		t.Fatal("cookie missing at its own default path")
	}
	if !slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://example.com/a/b/c"))), "p") {
		t.Fatal("cookie missing at a path below its default path")
	}
	if slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://example.com/ab"))), "p") {
		t.Fatal("cookie leaked to a sibling path that merely shares a prefix")
	}
	if slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://example.com/other"))), "p") {
		t.Fatal("cookie leaked to an unrelated path")
	}
}

func TestJar_SecureOverHTTPSVersusHTTP(t *testing.T) {
	jar := NewJar()
	jar.SetCookies(mustURL(t, "https://example.com/"), []*http.Cookie{{Name: "s", Value: "1", Secure: true}})

	if !slices.Contains(cookieNames(jar.Cookies(mustURL(t, "https://example.com/"))), "s") {
		t.Fatal("secure cookie missing over https")
	}
	if slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://example.com/"))), "s") {
		t.Fatal("secure cookie sent over plain http")
	}
	if !slices.Contains(cookieNames(jar.Cookies(mustURL(t, "wss://example.com/"))), "s") {
		t.Fatal("secure cookie missing over wss")
	}
}

func TestJar_MaxAgeDeleteAndExpiry(t *testing.T) {
	jar := NewJar()
	jar.SetCookies(mustURL(t, "http://example.com/"), []*http.Cookie{{Name: "gone", Value: "1", MaxAge: -1}})
	if slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://example.com/"))), "gone") {
		t.Fatal("MaxAge < 0 did not delete the cookie")
	}

	jar.SetCookies(mustURL(t, "http://example.com/"), []*http.Cookie{{Name: "past", Value: "1", Expires: time.Now().Add(-time.Hour)}})
	if slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://example.com/"))), "past") {
		t.Fatal("a past Expires did not delete the cookie")
	}

	jar.SetCookies(mustURL(t, "http://example.com/"), []*http.Cookie{{Name: "future", Value: "1", MaxAge: 3600}})
	if !slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://example.com/"))), "future") {
		t.Fatal("a positive MaxAge cookie is missing")
	}
	found := false
	for _, cookie := range jar.List() {
		if cookie.Name == "future" {
			found = true
			if cookie.Expires == "" {
				t.Fatal("expected a non-session Expires for a MaxAge cookie")
			}
			parsed, err := time.Parse(http.TimeFormat, cookie.Expires)
			if err != nil {
				t.Fatalf("Expires %q did not parse as %s: %v", cookie.Expires, http.TimeFormat, err)
			}
			want := time.Now().Add(time.Hour)
			if diff := parsed.Sub(want); diff < -time.Minute || diff > time.Minute {
				t.Fatalf("Expires %v is not within a minute of the expected %v (MaxAge formatted in the wrong zone?)", parsed, want)
			}
		}
	}
	if !found {
		t.Fatal("future cookie missing from List")
	}
}

func TestJar_ReplacementKeepsCreationOrder(t *testing.T) {
	jar := NewJar()
	jar.SetCookies(mustURL(t, "http://example.com/"), []*http.Cookie{{Name: "first", Value: "1"}})
	time.Sleep(2 * time.Millisecond)
	jar.SetCookies(mustURL(t, "http://example.com/"), []*http.Cookie{{Name: "second", Value: "1"}})

	// Same path length for both, so order falls back to creation time: first, then second.
	names := cookieNames(jar.Cookies(mustURL(t, "http://example.com/")))
	assertEqual(t, "initial order", names[0]+","+names[1], "first,second")

	// Replacing "first" must not bump its creation time past "second"'s.
	jar.SetCookies(mustURL(t, "http://example.com/"), []*http.Cookie{{Name: "first", Value: "2"}})
	names = cookieNames(jar.Cookies(mustURL(t, "http://example.com/")))
	assertEqual(t, "order after replacement", names[0]+","+names[1], "first,second")
}

func TestJar_List(t *testing.T) {
	jar := NewJar()
	if len(jar.List()) != 0 {
		t.Fatal("expected an empty jar to list no cookies")
	}
	jar.SetCookies(mustURL(t, "http://b.com/"), []*http.Cookie{{Name: "n", Value: "v", HttpOnly: true, Secure: true}})
	jar.SetCookies(mustURL(t, "http://a.com/"), []*http.Cookie{{Name: "n", Value: "v"}})

	listed := jar.List()
	assertEqual(t, "count", len(listed), 2)
	// Sorted by domain first, so a.com comes before b.com.
	assertEqual(t, "first domain", listed[0].Domain, "a.com")
	assertEqual(t, "second domain", listed[1].Domain, "b.com")
	assertEqual(t, "hostOnly", listed[1].HostOnly, true)
	assertEqual(t, "secure", listed[1].Secure, true)
	assertEqual(t, "httpOnly", listed[1].HTTPOnly, true)
}

func TestJar_Put(t *testing.T) {
	jar := NewJar()

	if err := jar.Put(Cookie{Domain: "example.com"}); err == nil {
		t.Fatal("expected an error for a missing cookie name")
	}
	if err := jar.Put(Cookie{Name: "n"}); err == nil {
		t.Fatal("expected an error for a missing cookie domain")
	}
	if err := jar.Put(Cookie{Name: "n", Domain: "example.com", Expires: "not a date"}); err == nil {
		t.Fatal("expected an error for a badly formatted Expires")
	}

	if err := jar.Put(Cookie{Name: "n", Domain: "example.com", Value: "v"}); err != nil {
		t.Fatalf("Put failed: %v", err)
	}
	listed := jar.List()
	assertEqual(t, "count", len(listed), 1)
	assertEqual(t, "path defaulted", listed[0].Path, "/")

	// A leading-dot domain is explicitly not host-only.
	if err := jar.Put(Cookie{Name: "d", Domain: ".example.com", Value: "v", HostOnly: true}); err != nil {
		t.Fatalf("Put failed: %v", err)
	}
	found := false
	for _, cookie := range jar.List() {
		if cookie.Name == "d" {
			found = true
			assertEqual(t, "domain stripped", cookie.Domain, "example.com")
			assertEqual(t, "hostOnly overridden by leading dot", cookie.HostOnly, false)
		}
	}
	if !found {
		t.Fatal("cookie \"d\" missing after Put")
	}
}

func TestJar_DeleteAndClear(t *testing.T) {
	jar := NewJar()
	if err := jar.Put(Cookie{Name: "n1", Domain: "example.com", Path: "/"}); err != nil {
		t.Fatalf("Put failed: %v", err)
	}
	if err := jar.Put(Cookie{Name: "n2", Domain: "example.com", Path: "/"}); err != nil {
		t.Fatalf("Put failed: %v", err)
	}

	jar.Delete("example.com", "/", "n1")
	listed := jar.List()
	assertEqual(t, "count after delete", len(listed), 1)
	assertEqual(t, "remaining cookie", listed[0].Name, "n2")

	jar.Clear()
	assertEqual(t, "count after clear", len(jar.List()), 0)
}

func TestJar_SaveLoadRoundTrip(t *testing.T) {
	jar := NewJar()
	if err := jar.Put(Cookie{Name: "session", Domain: "example.com", Value: "s"}); err != nil {
		t.Fatalf("Put failed: %v", err)
	}
	if err := jar.Put(Cookie{Name: "persistent", Domain: "example.com", Value: "p", Expires: time.Now().Add(time.Hour).UTC().Format(http.TimeFormat)}); err != nil {
		t.Fatalf("Put failed: %v", err)
	}

	path := filepath.Join(t.TempDir(), "cookies.json")
	if err := jar.Save(path); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("failed to stat saved cookie file: %v", err)
	}
	if runtime.GOOS != "windows" { // Windows files have no Unix permission bits
		assertEqual(t, "file mode", info.Mode().Perm(), os.FileMode(0o600))
	}

	loaded := NewJar()
	if err := loaded.Load(path); err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	assertEqual(t, "loaded count", len(loaded.List()), 2)

	missingPath := filepath.Join(t.TempDir(), "missing.json")
	fresh := NewJar()
	if err := fresh.Load(missingPath); err != nil {
		t.Fatalf("Load of a missing file should not error, got: %v", err)
	}
	assertEqual(t, "fresh jar after missing load", len(fresh.List()), 0)

	if err := os.WriteFile(missingPath, []byte("not json"), 0o600); err != nil {
		t.Fatalf("failed to write corrupt file: %v", err)
	}
	if err := fresh.Load(missingPath); err == nil {
		t.Fatal("expected an error loading corrupt JSON")
	}
}

func TestJar_IPHost(t *testing.T) {
	jar := NewJar()
	jar.SetCookies(mustURL(t, "http://192.168.1.1/"), []*http.Cookie{{Name: "ip", Value: "1", Domain: "192.168.1.1"}})

	listed := jar.List()
	assertEqual(t, "count", len(listed), 1)
	assertEqual(t, "hostOnly forced for an IP host", listed[0].HostOnly, true)
	assertEqual(t, "domain", listed[0].Domain, "192.168.1.1")

	if slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://192.168.1.2/"))), "ip") {
		t.Fatal("IP host cookie leaked to a different IP")
	}
	if !slices.Contains(cookieNames(jar.Cookies(mustURL(t, "http://192.168.1.1/"))), "ip") {
		t.Fatal("IP host cookie missing for its own host")
	}
}
