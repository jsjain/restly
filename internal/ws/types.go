// Package ws keeps the app's WebSocket connections and reports their traffic as events.
package ws

import (
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"

	"restly/internal/httpx"
)

// Event is one entry in a connection's message log.
type Event struct {
	ID     string         `json:"id"`   // connection id chosen by the caller
	Type   string         `json:"type"` // one of the Event constants
	Data   string         `json:"data"` // message text, base64 when Binary, close reason, or error text
	Binary bool           `json:"binary"`
	Code   int            `json:"code"`   // close code for EventClosed
	Header []httpx.Header `json:"header"` // handshake response headers for EventOpen
	Time   int64          `json:"time"`   // Unix milliseconds
}

// connection is one open WebSocket. Reads happen only on its read-loop goroutine; writes are
// serialized by writeMu because gorilla allows only one writer at a time.
type connection struct {
	conn           *websocket.Conn
	writeMu        sync.Mutex
	closeRequested atomic.Bool // set by Close, so the read loop can tell a client-initiated close from a server one
	done           chan struct{}
}

// Manager owns every open connection.
type Manager struct {
	emit func(Event)

	mu    sync.Mutex
	conns map[string]*connection // nil value reserves an id while its handshake is in flight
}
