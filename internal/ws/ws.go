package ws

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"restly/internal/httpx"
)

func NewManager(emit func(Event)) *Manager {
	return &Manager{
		emit:  emit,
		conns: make(map[string]*connection),
	}
}

// Connect dials rawURL (ws, wss, http, or https) under id and returns once the handshake
// finishes or fails. Later traffic arrives through emit. dial gives the proxy, TLS, and cookie
// settings for the URL's host.
func (manager *Manager) Connect(ctx context.Context, id, rawURL string, header http.Header, dial func(host string) httpx.DialSettings) error {
	wsURL, err := normalizeWebSocketURL(rawURL)
	if err != nil {
		return fmt.Errorf("failed to connect WebSocket: %w", err)
	}

	if err := manager.reserve(id); err != nil {
		return fmt.Errorf("failed to connect WebSocket: %w", err)
	}

	settings := dial(wsURL.Host)
	dialer := &websocket.Dialer{
		Proxy:            settings.Proxy,
		TLSClientConfig:  settings.TLSConfig,
		Jar:              settings.Jar,
		HandshakeTimeout: handshakeTimeout,
	}

	conn, response, dialErr := dialer.DialContext(ctx, wsURL.String(), stripForbiddenHeaders(header))
	if dialErr != nil {
		manager.release(id)
		message := describeHandshakeError(dialErr, response)
		manager.emit(Event{ID: id, Type: EventError, Data: message, Time: time.Now().UnixMilli()})
		manager.emit(Event{ID: id, Type: EventClosed, Code: 0, Time: time.Now().UnixMilli()})
		return fmt.Errorf("failed to connect WebSocket (%s): %w", message, dialErr)
	}

	conn.SetReadLimit(maxMessageBytes)

	wsConn := &connection{conn: conn, done: make(chan struct{})}
	manager.activate(id, wsConn)

	manager.emit(Event{ID: id, Type: EventOpen, Header: flattenHeader(response.Header), Time: time.Now().UnixMilli()})

	go manager.readLoop(id, wsConn)

	return nil
}

// Send writes a text message. gorilla allows only one writer per connection at a time, so writes
// go through the connection's write mutex.
func (manager *Manager) Send(id, message string) error {
	wsConn, ok := manager.lookup(id)
	if !ok {
		return errors.New("connection is closed")
	}

	wsConn.writeMu.Lock()
	writeErr := wsConn.conn.WriteMessage(websocket.TextMessage, []byte(message))
	wsConn.writeMu.Unlock()
	if writeErr != nil {
		return fmt.Errorf("failed to send WebSocket message: %w", writeErr)
	}

	manager.emit(Event{ID: id, Type: EventSent, Data: message, Time: time.Now().UnixMilli()})
	return nil
}

// Close asks the connection to shut down and waits briefly for the peer's close frame before
// forcing it shut. The read loop, not Close, emits the resulting EventClosed.
func (manager *Manager) Close(id string) error {
	wsConn, ok := manager.lookup(id)
	if !ok {
		return nil // the UI may race a server-initiated close
	}

	wsConn.closeRequested.Store(true)

	closeMessage := websocket.FormatCloseMessage(websocket.CloseNormalClosure, "")
	wsConn.writeMu.Lock()
	writeErr := wsConn.conn.WriteControl(websocket.CloseMessage, closeMessage, time.Now().Add(closeWriteTimeout))
	wsConn.writeMu.Unlock()
	if writeErr != nil {
		// Peer is already gone, so nothing will echo a close frame back; force-close and wait for
		// the read loop to unregister so the id is free the moment Close returns.
		wsConn.conn.Close()
		<-wsConn.done
		return nil
	}

	select {
	case <-wsConn.done:
	case <-time.After(closeGracePeriod):
		// Closing here unblocks the read loop's ReadMessage immediately, so this cannot deadlock.
		wsConn.conn.Close()
		<-wsConn.done
	}
	return nil
}

// CloseAll closes every connection concurrently, such as on app quit.
func (manager *Manager) CloseAll() {
	manager.mu.Lock()
	ids := make([]string, 0, len(manager.conns))
	for id, wsConn := range manager.conns {
		if wsConn != nil {
			ids = append(ids, id)
		}
	}
	manager.mu.Unlock()

	var group sync.WaitGroup
	for _, id := range ids {
		group.Go(func() {
			if err := manager.Close(id); err != nil {
				manager.emit(Event{ID: id, Type: EventError, Data: err.Error(), Time: time.Now().UnixMilli()})
			}
		})
	}
	group.Wait()
}

// readLoop owns all reads for one connection and is the only place that unregisters it, so the
// id becomes reusable only after this returns.
func (manager *Manager) readLoop(id string, wsConn *connection) {
	defer func() {
		manager.unregister(id)
		wsConn.conn.Close()
		close(wsConn.done)
	}()

	for {
		messageType, data, err := wsConn.conn.ReadMessage()
		if err != nil {
			manager.emitReadError(id, wsConn, err)
			return
		}

		switch messageType {
		case websocket.TextMessage:
			manager.emit(Event{ID: id, Type: EventReceived, Data: string(data), Time: time.Now().UnixMilli()})
		case websocket.BinaryMessage:
			manager.emit(Event{
				ID:     id,
				Type:   EventReceived,
				Data:   base64.StdEncoding.EncodeToString(data),
				Binary: true,
				Time:   time.Now().UnixMilli(),
			})
		}
	}
}

// emitReadError turns a ReadMessage error into the EventClosed (and possibly EventError) that
// ends a connection's log, crediting whichever side actually closed it.
func (manager *Manager) emitReadError(id string, wsConn *connection, err error) {
	var closeErr *websocket.CloseError
	switch {
	case errors.As(err, &closeErr):
		manager.emit(Event{ID: id, Type: EventClosed, Code: closeErr.Code, Data: closeErr.Text, Time: time.Now().UnixMilli()})
	case wsConn.closeRequested.Load():
		manager.emit(Event{ID: id, Type: EventClosed, Code: websocket.CloseNormalClosure, Data: "closed by client", Time: time.Now().UnixMilli()})
	default:
		manager.emit(Event{ID: id, Type: EventError, Data: err.Error(), Time: time.Now().UnixMilli()})
		manager.emit(Event{ID: id, Type: EventClosed, Code: websocket.CloseAbnormalClosure, Time: time.Now().UnixMilli()})
	}
}

func (manager *Manager) reserve(id string) error {
	manager.mu.Lock()
	defer manager.mu.Unlock()

	if _, exists := manager.conns[id]; exists {
		return fmt.Errorf("connection %q is already open", id)
	}
	manager.conns[id] = nil
	return nil
}

func (manager *Manager) release(id string) {
	manager.mu.Lock()
	delete(manager.conns, id)
	manager.mu.Unlock()
}

func (manager *Manager) activate(id string, wsConn *connection) {
	manager.mu.Lock()
	manager.conns[id] = wsConn
	manager.mu.Unlock()
}

func (manager *Manager) lookup(id string) (*connection, bool) {
	manager.mu.Lock()
	defer manager.mu.Unlock()

	wsConn, exists := manager.conns[id]
	return wsConn, exists && wsConn != nil
}

func (manager *Manager) unregister(id string) {
	manager.mu.Lock()
	delete(manager.conns, id)
	manager.mu.Unlock()
}
