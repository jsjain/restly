package httpx

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"golang.org/x/net/http/httpproxy"
)

// hostCert is a loaded client certificate matched against a request or dial host.
type hostCert struct {
	host string // lowercased ClientCert.Host
	cert tls.Certificate
}

// hostCertTransport is a per-host transport clone carrying that host's client certificate.
type hostCertTransport struct {
	host      string
	transport *http.Transport
}

// hostRoundTripper routes each request to the transport whose client certificate matches the
// request host, falling back to a transport with no client certificate.
type hostRoundTripper struct {
	base    *http.Transport
	perHost []hostCertTransport
}

func (router *hostRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	for _, entry := range router.perHost {
		if hostMatches(entry.host, req.URL.Host) {
			return entry.transport.RoundTrip(req)
		}
	}
	return router.base.RoundTrip(req)
}

func (router *hostRoundTripper) closeIdleConnections() {
	router.base.CloseIdleConnections()
	for _, entry := range router.perHost {
		entry.transport.CloseIdleConnections()
	}
}

// netConfig is one immutable, fully-built configuration. Configure builds a new one and swaps
// it in atomically so Send and DialSettings never see a half-built transport.
type netConfig struct {
	proxyFunc func(*http.Request) (*url.URL, error)
	tlsConfig *tls.Config // base: RootCAs and InsecureSkipVerify, no client certificates
	hostCerts []hostCert
	transport *hostRoundTripper
}

// DefaultNetwork is used until the user saves settings.
func DefaultNetwork() Network {
	return Network{
		ProxyMode:   ProxyEnvironment,
		VerifyTLS:   true,
		ClientCerts: []ClientCert{},
	}
}

// Configure rebuilds the transports from network. It returns an error, and keeps the current
// transports fully in effect, when the proxy URL, a CA file, or a certificate cannot be loaded.
func (client *Client) Configure(network Network) error {
	proxyFunc, err := buildProxyFunc(network)
	if err != nil {
		return err
	}
	rootCAs, err := buildRootCAs(network.CAFile)
	if err != nil {
		return err
	}
	hostCerts, err := loadHostCerts(network.ClientCerts)
	if err != nil {
		return err
	}

	baseTLSConfig := &tls.Config{
		RootCAs:            rootCAs,
		InsecureSkipVerify: !network.VerifyTLS,
	}
	baseTransport := http.DefaultTransport.(*http.Transport).Clone()
	baseTransport.Proxy = proxyFunc
	baseTransport.TLSClientConfig = baseTLSConfig.Clone()

	perHost := make([]hostCertTransport, 0, len(hostCerts))
	for _, entry := range hostCerts {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.Proxy = proxyFunc
		tlsConfig := baseTLSConfig.Clone()
		tlsConfig.Certificates = []tls.Certificate{entry.cert}
		transport.TLSClientConfig = tlsConfig
		perHost = append(perHost, hostCertTransport{host: entry.host, transport: transport})
	}

	newConfig := &netConfig{
		proxyFunc: proxyFunc,
		tlsConfig: baseTLSConfig,
		hostCerts: hostCerts,
		transport: &hostRoundTripper{base: baseTransport, perHost: perHost},
	}

	oldConfig := client.config.Swap(newConfig)
	if oldConfig != nil {
		oldConfig.transport.closeIdleConnections()
	}
	return nil
}

// DialSettings returns what a WebSocket dial to host needs to match HTTP requests to that host.
// Safe to call concurrently with Configure.
func (client *Client) DialSettings(host string) DialSettings {
	config := client.config.Load()
	tlsConfig := config.tlsConfig.Clone()
	if cert, ok := findHostCert(config.hostCerts, host); ok {
		tlsConfig.Certificates = []tls.Certificate{cert}
	}
	return DialSettings{
		Proxy:     config.proxyFunc,
		TLSConfig: tlsConfig,
		Jar:       client.jar,
	}
}

func (client *Client) Jar() *Jar {
	return client.jar
}

func buildProxyFunc(network Network) (func(*http.Request) (*url.URL, error), error) {
	switch network.ProxyMode {
	case ProxyNone:
		return nil, nil
	case ProxyEnvironment:
		return http.ProxyFromEnvironment, nil
	case ProxyCustom:
		return buildCustomProxyFunc(network)
	default:
		return nil, fmt.Errorf("unknown proxy mode %q", network.ProxyMode)
	}
}

func buildCustomProxyFunc(network Network) (func(*http.Request) (*url.URL, error), error) {
	parsed, err := url.Parse(network.ProxyURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse proxy URL %q: %w", network.ProxyURL, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("proxy URL %q must include a scheme and host", network.ProxyURL)
	}
	proxyConfig := &httpproxy.Config{
		HTTPProxy:  network.ProxyURL,
		HTTPSProxy: network.ProxyURL,
		NoProxy:    network.ProxyBypass,
	}
	resolveProxy := proxyConfig.ProxyFunc()
	return func(req *http.Request) (*url.URL, error) {
		return resolveProxy(req.URL)
	}, nil
}

func buildRootCAs(caFile string) (*x509.CertPool, error) {
	if caFile == "" {
		return nil, nil // nil RootCAs means the Go runtime's default system pool
	}
	pool, err := x509.SystemCertPool()
	if err != nil {
		return nil, fmt.Errorf("failed to load system certificate pool: %w", err)
	}
	pemData, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read CA file %q: %w", caFile, err)
	}
	if ok := pool.AppendCertsFromPEM(pemData); !ok {
		return nil, fmt.Errorf("CA file %q contains no certificates", caFile)
	}
	return pool, nil
}

func loadHostCerts(clientCerts []ClientCert) ([]hostCert, error) {
	hostCerts := make([]hostCert, 0, len(clientCerts))
	for _, entry := range clientCerts {
		cert, err := tls.LoadX509KeyPair(entry.CertFile, entry.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("failed to load client certificate for %s (cert %q, key %q): %w", entry.Host, entry.CertFile, entry.KeyFile, err)
		}
		hostCerts = append(hostCerts, hostCert{host: strings.ToLower(entry.Host), cert: cert})
	}
	return hostCerts, nil
}

func findHostCert(hostCerts []hostCert, requestHost string) (tls.Certificate, bool) {
	for _, entry := range hostCerts {
		if hostMatches(entry.host, requestHost) {
			return entry.cert, true
		}
	}
	return tls.Certificate{}, false
}
