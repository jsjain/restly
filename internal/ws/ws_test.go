package ws_test

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"restly/internal/httpx"
	"restly/internal/ws"
)

const testTimeout = 5 * time.Second

// recorder collects Events off a channel so tests never need to sleep.
type recorder struct {
	events chan ws.Event
}

func newRecorder() *recorder {
	return &recorder{events: make(chan ws.Event, 256)}
}

func (rec *recorder) emit(event ws.Event) {
	rec.events <- event
}

// waitFor returns the next event of eventType, ignoring others, or fails the test after testTimeout.
func (rec *recorder) waitFor(t *testing.T, eventType string) ws.Event {
	t.Helper()
	deadline := time.After(testTimeout)
	for {
		select {
		case event := <-rec.events:
			if event.Type == eventType {
				return event
			}
		case <-deadline:
			t.Fatalf("timed out waiting for event %q", eventType)
		}
	}
}

// countClosed tallies every EventClosed that arrives within window, so a test can assert none
// arrived beyond the first.
func (rec *recorder) countClosed(t *testing.T, window time.Duration) int {
	t.Helper()
	count := 0
	deadline := time.After(window)
	for {
		select {
		case event := <-rec.events:
			if event.Type == ws.EventClosed {
				count++
			}
		case <-deadline:
			return count
		}
	}
}

func dialWith(settings httpx.DialSettings) func(string) httpx.DialSettings {
	return func(string) httpx.DialSettings { return settings }
}

func findHeader(headers []httpx.Header, key string) (string, bool) {
	for _, header := range headers {
		if strings.EqualFold(header.Key, key) {
			return header.Value, true
		}
	}
	return "", false
}

func TestConnectEchoAndSchemeConversion(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		responseHeader := http.Header{}
		responseHeader.Set("X-Server-Greeting", "hello")
		conn, err := upgrader.Upgrade(writer, request, responseHeader)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			messageType, data, readErr := conn.ReadMessage()
			if readErr != nil {
				return
			}
			if writeErr := conn.WriteMessage(messageType, data); writeErr != nil {
				return
			}
		}
	}))
	defer server.Close()

	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	// server.URL is http://..., which checks the http-to-ws scheme conversion.
	if err := manager.Connect(context.Background(), "echo", server.URL, http.Header{}, dialWith(httpx.DialSettings{})); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}

	openEvent := rec.waitFor(t, ws.EventOpen)
	if greeting, ok := findHeader(openEvent.Header, "X-Server-Greeting"); !ok || greeting != "hello" {
		t.Fatalf("expected X-Server-Greeting: hello in EventOpen header, got %+v", openEvent.Header)
	}

	if err := manager.Send("echo", "hi"); err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	sentEvent := rec.waitFor(t, ws.EventSent)
	if sentEvent.Data != "hi" {
		t.Fatalf("expected sent data %q, got %q", "hi", sentEvent.Data)
	}

	receivedEvent := rec.waitFor(t, ws.EventReceived)
	if receivedEvent.Data != "hi" || receivedEvent.Binary {
		t.Fatalf("expected received text %q, got %+v", "hi", receivedEvent)
	}

	if err := manager.Close("echo"); err != nil {
		t.Fatalf("Close failed: %v", err)
	}
	rec.waitFor(t, ws.EventClosed)
}

func TestConnectSendsCustomHeaderAndCookie(t *testing.T) {
	type captured struct {
		customHeader string
		cookieValue  string
	}
	capturedCh := make(chan captured, 1)

	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var got captured
		got.customHeader = request.Header.Get("X-Custom-Header")
		if cookie, err := request.Cookie("session"); err == nil {
			got.cookieValue = cookie.Value
		}
		capturedCh <- got

		conn, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, readErr := conn.ReadMessage(); readErr != nil {
			return // draining the connection until the client closes
		}
	}))
	defer server.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("failed to build cookie jar: %v", err)
	}
	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("failed to parse server URL: %v", err)
	}
	jar.SetCookies(serverURL, []*http.Cookie{{Name: "session", Value: "abc123"}})

	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	header := http.Header{}
	header.Set("X-Custom-Header", "custom-value")

	settings := httpx.DialSettings{Jar: jar}
	if err := manager.Connect(context.Background(), "hdr", server.URL, header, dialWith(settings)); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	rec.waitFor(t, ws.EventOpen)

	select {
	case got := <-capturedCh:
		if got.customHeader != "custom-value" {
			t.Fatalf("expected custom header %q, got %q", "custom-value", got.customHeader)
		}
		if got.cookieValue != "abc123" {
			t.Fatalf("expected cookie value %q, got %q", "abc123", got.cookieValue)
		}
	case <-time.After(testTimeout):
		t.Fatal("timed out waiting for server to capture the request")
	}

	if err := manager.Close("hdr"); err != nil {
		t.Fatalf("Close failed: %v", err)
	}
	rec.waitFor(t, ws.EventClosed)
}

func TestConnectReceivesBinaryMessage(t *testing.T) {
	payload := []byte{0x01, 0x02, 0x03, 0xff}

	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if writeErr := conn.WriteMessage(websocket.BinaryMessage, payload); writeErr != nil {
			return
		}
		if _, _, readErr := conn.ReadMessage(); readErr != nil {
			return // draining the connection until the client closes
		}
	}))
	defer server.Close()

	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	if err := manager.Connect(context.Background(), "bin", server.URL, http.Header{}, dialWith(httpx.DialSettings{})); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	rec.waitFor(t, ws.EventOpen)

	receivedEvent := rec.waitFor(t, ws.EventReceived)
	if !receivedEvent.Binary {
		t.Fatalf("expected binary event, got %+v", receivedEvent)
	}
	if receivedEvent.Data != base64.StdEncoding.EncodeToString(payload) {
		t.Fatalf("expected base64 payload %q, got %q", base64.StdEncoding.EncodeToString(payload), receivedEvent.Data)
	}

	if err := manager.Close("bin"); err != nil {
		t.Fatalf("Close failed: %v", err)
	}
	rec.waitFor(t, ws.EventClosed)
}

func TestServerCloseWithCodeAndReason(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		message := websocket.FormatCloseMessage(4000, "bye")
		if writeErr := conn.WriteControl(websocket.CloseMessage, message, time.Now().Add(time.Second)); writeErr != nil {
			return
		}
	}))
	defer server.Close()

	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	if err := manager.Connect(context.Background(), "server-close", server.URL, http.Header{}, dialWith(httpx.DialSettings{})); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	rec.waitFor(t, ws.EventOpen)

	closedEvent := rec.waitFor(t, ws.EventClosed)
	if closedEvent.Code != 4000 || closedEvent.Data != "bye" {
		t.Fatalf("expected close code 4000 reason %q, got code %d reason %q", "bye", closedEvent.Code, closedEvent.Data)
	}
}

func TestClientCloseEmitsExactlyOnceAndAllowsReuse(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			if _, _, readErr := conn.ReadMessage(); readErr != nil {
				return
			}
		}
	}))
	defer server.Close()

	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	const id = "reused-id"
	if err := manager.Connect(context.Background(), id, server.URL, http.Header{}, dialWith(httpx.DialSettings{})); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	rec.waitFor(t, ws.EventOpen)

	if err := manager.Close(id); err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	if count := rec.countClosed(t, 500*time.Millisecond); count != 1 {
		t.Fatalf("expected exactly one EventClosed, got %d", count)
	}

	// Close only returns once the read loop has unregistered the id, so this must succeed.
	if err := manager.Connect(context.Background(), id, server.URL, http.Header{}, dialWith(httpx.DialSettings{})); err != nil {
		t.Fatalf("Connect after Close failed: %v", err)
	}
	rec.waitFor(t, ws.EventOpen)

	if err := manager.Close(id); err != nil {
		t.Fatalf("second Close failed: %v", err)
	}
	rec.waitFor(t, ws.EventClosed)
}

func TestDuplicateIDUnknownSendAndUnknownClose(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			if _, _, readErr := conn.ReadMessage(); readErr != nil {
				return
			}
		}
	}))
	defer server.Close()

	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	const id = "dup-id"
	if err := manager.Connect(context.Background(), id, server.URL, http.Header{}, dialWith(httpx.DialSettings{})); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	rec.waitFor(t, ws.EventOpen)

	if err := manager.Connect(context.Background(), id, server.URL, http.Header{}, dialWith(httpx.DialSettings{})); err == nil {
		t.Fatal("expected an error connecting a duplicate id")
	}

	if err := manager.Send("no-such-id", "hi"); err == nil {
		t.Fatal("expected an error sending to an unknown id")
	}

	if err := manager.Close("no-such-id"); err != nil {
		t.Fatalf("expected nil closing an unknown id, got %v", err)
	}

	if err := manager.Close(id); err != nil {
		t.Fatalf("Close failed: %v", err)
	}
	rec.waitFor(t, ws.EventClosed)
}

func TestHandshakeRejectedWith401(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, "unauthorized", http.StatusUnauthorized)
	}))
	defer server.Close()

	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	err := manager.Connect(context.Background(), "rejected", server.URL, http.Header{}, dialWith(httpx.DialSettings{}))
	if err == nil {
		t.Fatal("expected an error from a rejected handshake")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected error to mention 401, got %v", err)
	}

	rec.waitFor(t, ws.EventError)
	closedEvent := rec.waitFor(t, ws.EventClosed)
	if closedEvent.Code != 0 {
		t.Fatalf("expected close code 0 after a failed handshake, got %d", closedEvent.Code)
	}
}

func TestCloseAllClosesEveryConnection(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			if _, _, readErr := conn.ReadMessage(); readErr != nil {
				return
			}
		}
	}))
	defer server.Close()

	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	ids := []string{"close-all-1", "close-all-2", "close-all-3"}
	for _, id := range ids {
		if err := manager.Connect(context.Background(), id, server.URL, http.Header{}, dialWith(httpx.DialSettings{})); err != nil {
			t.Fatalf("Connect(%s) failed: %v", id, err)
		}
		rec.waitFor(t, ws.EventOpen)
	}

	var waitGroup sync.WaitGroup
	waitGroup.Go(manager.CloseAll)

	seen := map[string]bool{}
	deadline := time.After(testTimeout)
	for len(seen) < len(ids) {
		select {
		case event := <-rec.events:
			if event.Type == ws.EventClosed {
				seen[event.ID] = true
			}
		case <-deadline:
			t.Fatalf("timed out waiting for all connections to close, saw %v", seen)
		}
	}
	waitGroup.Wait()
}

func TestForbiddenHeaderDoesNotBreakDial(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, readErr := conn.ReadMessage(); readErr != nil {
			return // draining the connection until the client closes
		}
	}))
	defer server.Close()

	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	header := http.Header{}
	header.Set("Sec-WebSocket-Key", "this-should-be-stripped")

	if err := manager.Connect(context.Background(), "forbidden-header", server.URL, header, dialWith(httpx.DialSettings{})); err != nil {
		t.Fatalf("Connect failed with a forbidden header present: %v", err)
	}
	rec.waitFor(t, ws.EventOpen)

	if err := manager.Close("forbidden-header"); err != nil {
		t.Fatalf("Close failed: %v", err)
	}
	rec.waitFor(t, ws.EventClosed)
}

func TestConnectRejectsEmptyURL(t *testing.T) {
	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	if err := manager.Connect(context.Background(), "empty", "", http.Header{}, dialWith(httpx.DialSettings{})); err == nil {
		t.Fatal("expected an error for an empty URL")
	}
}

func TestConnectRejectsUnsupportedScheme(t *testing.T) {
	rec := newRecorder()
	manager := ws.NewManager(rec.emit)

	if err := manager.Connect(context.Background(), "bad-scheme", "ftp://example.com", http.Header{}, dialWith(httpx.DialSettings{})); err == nil {
		t.Fatal("expected an error for an unsupported scheme")
	}
}
