package httpx

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// generateSelfSignedCert writes a fresh self-signed certificate and key to temp files and
// returns their paths along with the parsed certificate, so tests never touch fixtures on disk.
func generateSelfSignedCert(t *testing.T) (certPath, keyPath string, certificate *x509.Certificate) {
	t.Helper()
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(time.Now().UnixNano()),
		Subject:               pkix.Name{CommonName: "restly-test-client"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatalf("failed to create certificate: %v", err)
	}
	parsedCert, err := x509.ParseCertificate(derBytes)
	if err != nil {
		t.Fatalf("failed to parse generated certificate: %v", err)
	}

	dir := t.TempDir()
	certPath = filepath.Join(dir, "cert.pem")
	keyPath = filepath.Join(dir, "key.pem")
	writePEM(t, certPath, "CERTIFICATE", derBytes)
	keyBytes, err := x509.MarshalECPrivateKey(privateKey)
	if err != nil {
		t.Fatalf("failed to marshal private key: %v", err)
	}
	writePEM(t, keyPath, "EC PRIVATE KEY", keyBytes)
	return certPath, keyPath, parsedCert
}

func writePEM(t *testing.T, path, blockType string, bytes []byte) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("failed to create %s: %v", path, err)
	}
	defer file.Close()
	if err := pem.Encode(file, &pem.Block{Type: blockType, Bytes: bytes}); err != nil {
		t.Fatalf("failed to write PEM to %s: %v", path, err)
	}
}

func sendGet(t *testing.T, client *Client, targetURL string) (*Response, error) {
	t.Helper()
	return client.Send(context.Background(), &Prepared{Method: "GET", URL: targetURL})
}

func TestNetwork_VerifyTLS(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer server.Close()

	client := NewClient(t.TempDir())

	if err := client.Configure(Network{ProxyMode: ProxyEnvironment, VerifyTLS: false}); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	if _, err := sendGet(t, client, server.URL); err != nil {
		t.Fatalf("expected success with VerifyTLS false, got: %v", err)
	}

	if err := client.Configure(Network{ProxyMode: ProxyEnvironment, VerifyTLS: true}); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	if _, err := sendGet(t, client, server.URL); err == nil {
		t.Fatal("expected failure with VerifyTLS true against an untrusted certificate")
	}
}

func TestNetwork_CAFileTrustsServerCertificate(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer server.Close()

	caPath := filepath.Join(t.TempDir(), "ca.pem")
	writePEM(t, caPath, "CERTIFICATE", server.Certificate().Raw)

	client := NewClient(t.TempDir())
	if err := client.Configure(Network{ProxyMode: ProxyEnvironment, VerifyTLS: true, CAFile: caPath}); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	if _, err := sendGet(t, client, server.URL); err != nil {
		t.Fatalf("expected success trusting the server cert via CAFile, got: %v", err)
	}
}

func TestNetwork_ClientCertificates(t *testing.T) {
	certPath, keyPath, certificate := generateSelfSignedCert(t)
	clientCAs := x509.NewCertPool()
	clientCAs.AddCert(certificate)

	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	server.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: clientCAs}
	server.StartTLS()
	defer server.Close()

	serverHost := strings.TrimPrefix(server.URL, "https://")

	client := NewClient(t.TempDir())
	matching := Network{
		ProxyMode: ProxyEnvironment,
		VerifyTLS: false,
		ClientCerts: []ClientCert{
			{Host: serverHost, CertFile: certPath, KeyFile: keyPath},
		},
	}
	if err := client.Configure(matching); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	if _, err := sendGet(t, client, server.URL); err != nil {
		t.Fatalf("expected success with a matching client certificate, got: %v", err)
	}

	nonMatching := Network{
		ProxyMode: ProxyEnvironment,
		VerifyTLS: false,
		ClientCerts: []ClientCert{
			{Host: "nonexistent.example:9999", CertFile: certPath, KeyFile: keyPath},
		},
	}
	if err := client.Configure(nonMatching); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	if _, err := sendGet(t, client, server.URL); err == nil {
		t.Fatal("expected failure when no client certificate matches the server host")
	}
}

func TestNetwork_CustomProxyAndBypass(t *testing.T) {
	var proxyRequests int
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyRequests++
		// A forward proxy receives the absolute-URI form; confirm it's really the target,
		// not just that some request arrived.
		if r.URL.Host != "fake-target.restly-test.invalid" {
			t.Errorf("proxy received unexpected target host %q", r.URL.Host)
		}
		w.Write([]byte("proxied"))
	}))
	defer proxyServer.Close()

	// golang.org/x/net/http/httpproxy always bypasses loopback targets, so httptest servers
	// (always 127.0.0.1) can't be the "target" here. Use an unresolvable host instead: with a
	// proxy in play, the client never resolves it itself, it just sends the absolute-URI to
	// the proxy, which is all this test needs to observe.
	const fakeTarget = "http://fake-target.restly-test.invalid/path"
	client := NewClient(t.TempDir())

	bypassing := Network{ProxyMode: ProxyCustom, ProxyURL: proxyServer.URL, ProxyBypass: "fake-target.restly-test.invalid", VerifyTLS: true}
	if err := client.Configure(bypassing); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	if _, err := sendGet(t, client, fakeTarget); err == nil {
		t.Fatal("expected a direct connection to an unresolvable host to fail when bypassed")
	}
	assertEqual(t, "proxy requests while bypassed", proxyRequests, 0)

	notBypassing := Network{ProxyMode: ProxyCustom, ProxyURL: proxyServer.URL, VerifyTLS: true}
	if err := client.Configure(notBypassing); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	resp, err := sendGet(t, client, fakeTarget)
	if err != nil {
		t.Fatalf("Send through the proxy failed: %v", err)
	}
	assertEqual(t, "proxied body", string(resp.Body), "proxied")
	assertEqual(t, "proxy requests once routed through the proxy", proxyRequests, 1)
}

func TestNetwork_ProxyNoneIgnoresEnvironment(t *testing.T) {
	targetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("direct-target"))
	}))
	defer targetServer.Close()

	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("proxied"))
	}))
	defer proxyServer.Close()

	t.Setenv("HTTP_PROXY", proxyServer.URL)

	client := NewClient(t.TempDir())
	if err := client.Configure(Network{ProxyMode: ProxyNone, VerifyTLS: true}); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	resp, err := sendGet(t, client, targetServer.URL)
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	assertEqual(t, "body with ProxyNone despite HTTP_PROXY", string(resp.Body), "direct-target")
}

func TestNetwork_ConfigureMissingCertFileKeepsOldSettings(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer server.Close()

	client := NewClient(t.TempDir())
	if err := client.Configure(Network{ProxyMode: ProxyEnvironment, VerifyTLS: true}); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	if _, err := sendGet(t, client, server.URL); err != nil {
		t.Fatalf("expected the initial configuration to work, got: %v", err)
	}

	broken := Network{
		ProxyMode: ProxyEnvironment,
		VerifyTLS: true,
		ClientCerts: []ClientCert{
			{Host: "example.com", CertFile: "/nonexistent/cert.pem", KeyFile: "/nonexistent/key.pem"},
		},
	}
	if err := client.Configure(broken); err == nil {
		t.Fatal("expected an error for a missing certificate file")
	}

	if _, err := sendGet(t, client, server.URL); err != nil {
		t.Fatalf("expected the old configuration to still work after a failed Configure, got: %v", err)
	}
}

func TestNetwork_TLSTimingNonZero(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer server.Close()

	client := NewClient(t.TempDir())
	if err := client.Configure(Network{ProxyMode: ProxyEnvironment, VerifyTLS: false}); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	resp, err := sendGet(t, client, server.URL)
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	if resp.Timings.TLS <= 0 {
		t.Fatalf("expected Timings.TLS > 0 on a fresh TLS connection, got %v", resp.Timings.TLS)
	}
}

func TestNetwork_DialSettingsReturnsMatchingCertificate(t *testing.T) {
	certPathA, keyPathA, certA := generateSelfSignedCert(t)

	client := NewClient(t.TempDir())
	network := Network{
		ProxyMode: ProxyEnvironment,
		VerifyTLS: true,
		ClientCerts: []ClientCert{
			{Host: "hosta.example:1234", CertFile: certPathA, KeyFile: keyPathA},
		},
	}
	if err := client.Configure(network); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}

	matching := client.DialSettings("hosta.example:1234")
	if len(matching.TLSConfig.Certificates) != 1 {
		t.Fatalf("expected one matching certificate, got %d", len(matching.TLSConfig.Certificates))
	}
	if string(matching.TLSConfig.Certificates[0].Certificate[0]) != string(certA.Raw) {
		t.Fatal("DialSettings returned the wrong certificate for a matching host")
	}

	nonMatching := client.DialSettings("hostb.example:5678")
	if len(nonMatching.TLSConfig.Certificates) != 0 {
		t.Fatal("expected no certificate for a non-matching host")
	}

	if matching.Jar != client.Jar() {
		t.Fatal("expected DialSettings to return the client's jar")
	}
}
