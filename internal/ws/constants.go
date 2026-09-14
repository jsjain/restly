package ws

import "time"

// Event types.
const (
	EventOpen     = "open"
	EventReceived = "received"
	EventSent     = "sent"
	EventClosed   = "closed"
	EventError    = "error"
)

const (
	handshakeTimeout = 30 * time.Second
	maxMessageBytes  = 10 * 1024 * 1024 // read limit per connection

	closeWriteTimeout = 1 * time.Second // deadline for writing the outgoing close frame
	closeGracePeriod  = 2 * time.Second // how long Close waits for the peer's close frame before forcing the connection shut

	maxHandshakeErrorBodyBytes = 1024 // response body kept in a handshake failure's error message
)
