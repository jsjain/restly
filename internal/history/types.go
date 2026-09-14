// Package history keeps the requests the user sent in a JSON Lines file.
package history

import (
	"sync"

	"restly/internal/collection"
)

type Entry struct {
	ID         string           `json:"id"`
	Time       int64            `json:"time"`   // Unix milliseconds
	Method     string           `json:"method"` // "WS" for a WebSocket connection
	URL        string           `json:"url"`    // as sent, with variables substituted, "" when the request was never built
	Code       int              `json:"code"`   // 0 when no response arrived
	DurationMs float64          `json:"durationMs"`
	Size       int              `json:"size"`
	Error      string           `json:"error"`
	Item       *collection.Item `json:"item"` // the editor state that was sent, reopened as a standalone request
}

type Store struct {
	mu        sync.Mutex
	path      string
	limit     int
	entries   []Entry // oldest first, as in the file
	lineCount int     // lines currently on disk, tracked to know when to compact
}
