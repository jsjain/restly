// Package httpx turns a collection request into an HTTP request, sends it, and records the response.
package httpx

import (
	"crypto/tls"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
)

type Header struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Prepared is a request with variables substituted and auth applied, ready to send.
type Prepared struct {
	Method   string     `json:"method"`
	URL      string     `json:"url"`
	Header   []Header   `json:"header"`
	Body     []byte     `json:"-"`        // raw, urlencoded, or graphql body
	BodyFile string     `json:"bodyFile"` // body mode "file": path read at send time
	Form     []FormPart `json:"form"`     // body mode "formdata": multipart parts
}

type FormPart struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	File        string `json:"file"` // path of a file part, read at send time
	ContentType string `json:"contentType"`
}

// Timings are in milliseconds. DNS, Connect, and TLS are zero on a reused connection.
type Timings struct {
	DNS       float64 `json:"dns"`
	Connect   float64 `json:"connect"`
	TLS       float64 `json:"tls"`
	FirstByte float64 `json:"firstByte"`
	Total     float64 `json:"total"`
}

type Cookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain"`
	Path     string `json:"path"`
	Expires  string `json:"expires"`
	HTTPOnly bool   `json:"httpOnly"`
	Secure   bool   `json:"secure"`
	HostOnly bool   `json:"hostOnly"` // set without a Domain attribute, so it matches only Domain itself
}

type Response struct {
	Code    int      `json:"code"`
	Status  string   `json:"status"` // reason phrase, such as "OK"
	Header  []Header `json:"header"`
	Cookies []Cookie `json:"cookies"`
	Body    []byte   `json:"-"`
	Size    int      `json:"size"` // body bytes after decompression
	Timings Timings  `json:"timings"`
}

// Client sends requests with one connection pool and cookie jar for the whole app.
type Client struct {
	http    *http.Client
	jar     *Jar
	workDir string // base for relative file paths in form parts and file bodies

	// config is swapped atomically by Configure so a concurrent Send or DialSettings
	// call never observes a half-built transport.
	config atomic.Pointer[netConfig]
}

// Network is the proxy and TLS configuration every request and WebSocket connection uses.
type Network struct {
	ProxyMode   string       `json:"proxyMode"`   // ProxyNone, ProxyEnvironment, or ProxyCustom
	ProxyURL    string       `json:"proxyUrl"`    // for ProxyCustom, such as http://user:pass@proxy:8080
	ProxyBypass string       `json:"proxyBypass"` // for ProxyCustom, comma-separated hosts in NO_PROXY syntax
	VerifyTLS   bool         `json:"verifyTls"`
	CAFile      string       `json:"caFile"` // PEM bundle trusted in addition to the system roots, "" for none
	ClientCerts []ClientCert `json:"clientCerts"`
}

// ClientCert is a PEM certificate and key presented to one host.
type ClientCert struct {
	Host     string `json:"host"` // host, or host:port, matched against the request URL
	CertFile string `json:"certFile"`
	KeyFile  string `json:"keyFile"`
}

// DialSettings are what a WebSocket dialer needs to reach a host the way HTTP requests do.
type DialSettings struct {
	Proxy     func(*http.Request) (*url.URL, error)
	TLSConfig *tls.Config
	Jar       http.CookieJar
}

// Jar holds the cookies for every request. Unlike net/http/cookiejar it can list, edit, and persist them.
type Jar struct {
	mu      sync.Mutex
	entries map[cookieKey]storedCookie
}
