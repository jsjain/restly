package httpx

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptrace"
	"net/textproto"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

func NewClient(workDir string) *Client {
	client := &Client{jar: NewJar(), workDir: workDir}
	client.http = &http.Client{
		Jar: client.jar,
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			return client.config.Load().transport.RoundTrip(req)
		}),
	}
	if err := client.Configure(DefaultNetwork()); err != nil {
		// DefaultNetwork has no proxy URL, CA file, or client certs, so Configure cannot fail.
		panic(fmt.Sprintf("failed to apply default network configuration: %v", err))
	}
	return client
}

func (client *Client) Send(ctx context.Context, prep *Prepared) (*Response, error) {
	body, contentType, err := client.assembleBody(prep)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, prep.Method, prep.URL, body)
	if err != nil {
		return nil, fmt.Errorf("failed to build request: %w", err)
	}
	for _, header := range prep.Header {
		if strings.EqualFold(header.Key, "Host") {
			// net/http ignores a Host entry in the header map and sends req.Host instead.
			httpReq.Host = header.Value
			continue
		}
		httpReq.Header.Add(header.Key, header.Value)
	}
	if contentType != "" {
		// Multipart's boundary is only known after assembling the body, so it overrides
		// any Content-Type header the caller set.
		httpReq.Header.Set("Content-Type", contentType)
	}

	var timings Timings
	requestStart := time.Now()
	var dnsStart, connectStart, tlsStart time.Time
	trace := &httptrace.ClientTrace{
		DNSStart:             func(httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:              func(httptrace.DNSDoneInfo) { timings.DNS = millisSince(dnsStart) },
		ConnectStart:         func(string, string) { connectStart = time.Now() },
		ConnectDone:          func(string, string, error) { timings.Connect = millisSince(connectStart) },
		TLSHandshakeStart:    func() { tlsStart = time.Now() },
		TLSHandshakeDone:     func(tls.ConnectionState, error) { timings.TLS = millisSince(tlsStart) },
		GotFirstResponseByte: func() { timings.FirstByte = millisSince(requestStart) },
	}
	httpReq = httpReq.WithContext(httptrace.WithClientTrace(httpReq.Context(), trace))

	resp, err := client.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}
	timings.Total = millisSince(requestStart)

	status := resp.Status
	if _, reason, ok := strings.Cut(resp.Status, " "); ok {
		status = reason
	}

	return &Response{
		Code:    resp.StatusCode,
		Status:  status,
		Header:  flattenHeader(resp.Header),
		Cookies: convertCookies(resp.Cookies()),
		Body:    responseBody,
		Size:    len(responseBody),
		Timings: timings,
	}, nil
}

func millisSince(start time.Time) float64 {
	if start.IsZero() {
		return 0
	}
	return float64(time.Since(start)) / float64(time.Millisecond)
}

// assembleBody returns the request body reader and, for multipart form data, the
// Content-Type the writer picked (which carries the boundary).
func (client *Client) assembleBody(prep *Prepared) (io.Reader, string, error) {
	switch {
	case len(prep.Form) > 0:
		return client.buildMultipart(prep.Form)
	case prep.BodyFile != "":
		data, err := os.ReadFile(client.resolvePath(prep.BodyFile))
		if err != nil {
			return nil, "", fmt.Errorf("failed to read body file %q: %w", prep.BodyFile, err)
		}
		return bytes.NewReader(data), "", nil
	case len(prep.Body) > 0:
		return bytes.NewReader(prep.Body), "", nil
	default:
		return nil, "", nil
	}
}

func (client *Client) buildMultipart(parts []FormPart) (io.Reader, string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for _, part := range parts {
		if part.File == "" {
			if err := writer.WriteField(part.Key, part.Value); err != nil {
				return nil, "", fmt.Errorf("failed to write form field %q: %w", part.Key, err)
			}
			continue
		}
		path := client.resolvePath(part.File)
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, "", fmt.Errorf("failed to read form file %q: %w", part.File, err)
		}
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name=%q; filename=%q`, part.Key, filepath.Base(part.File)))
		contentType := part.ContentType
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		header.Set("Content-Type", contentType)
		fileWriter, err := writer.CreatePart(header)
		if err != nil {
			return nil, "", fmt.Errorf("failed to create form file part %q: %w", part.Key, err)
		}
		if _, err := fileWriter.Write(data); err != nil {
			return nil, "", fmt.Errorf("failed to write form file part %q: %w", part.Key, err)
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", fmt.Errorf("failed to close multipart writer: %w", err)
	}
	return &buf, writer.FormDataContentType(), nil
}

func (client *Client) resolvePath(path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(client.workDir, path)
}

func flattenHeader(header http.Header) []Header {
	var headers []Header
	for _, key := range slices.Sorted(maps.Keys(header)) {
		for _, value := range header[key] {
			headers = append(headers, Header{Key: key, Value: value})
		}
	}
	return headers
}

func convertCookies(cookies []*http.Cookie) []Cookie {
	result := make([]Cookie, 0, len(cookies))
	for _, cookie := range cookies {
		expires := ""
		if !cookie.Expires.IsZero() {
			expires = cookie.Expires.Format(time.RFC1123)
		}
		result = append(result, Cookie{
			Name:     cookie.Name,
			Value:    cookie.Value,
			Domain:   cookie.Domain,
			Path:     cookie.Path,
			Expires:  expires,
			HTTPOnly: cookie.HttpOnly,
			Secure:   cookie.Secure,
		})
	}
	return result
}
