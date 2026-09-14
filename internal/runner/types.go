// Package runner executes requests with their scripts, alone or as a collection run.
package runner

import (
	"time"

	"restly/internal/collection"
	"restly/internal/httpx"
	"restly/internal/script"
)

// Step is one request with the folders and collection it inherits scripts and auth from.
type Step struct {
	Collection *collection.Collection
	Ancestors  []*collection.Item // outermost first
	Item       *collection.Item
	Info       script.Info
}

// Outcome is everything one request produced.
type Outcome struct {
	Prepared    *httpx.Prepared // nil when the request was not built
	Response    *httpx.Response // nil when the request was not sent
	Tests       []script.TestResult
	Console     []string
	Err         error
	NextRequest *string
	Skipped     bool
}

type Options struct {
	Iterations int
	Delay      time.Duration
}

// Result is one executed request. The UI receives it as the "run:result" event.
type Result struct {
	Iteration int                 `json:"iteration"`
	Path      []int               `json:"path"`
	Name      string              `json:"name"`
	Method    string              `json:"method"`
	URL       string              `json:"url"`
	Code      int                 `json:"code"`
	Status    string              `json:"status"`
	TimeMs    float64             `json:"timeMs"`
	Tests     []script.TestResult `json:"tests"`
	Console   []string            `json:"console"`
	Error     string              `json:"error"`
	Skipped   bool                `json:"skipped"`
}

// Summary closes a run. The UI receives it as the "run:done" event.
type Summary struct {
	Requests int  `json:"requests"`
	Passed   int  `json:"passed"` // tests
	Failed   int  `json:"failed"` // tests
	Errors   int  `json:"errors"` // requests that failed to send or whose script threw
	Stopped  bool `json:"stopped"`
}

// entry is a request found while flattening the tree for a run.
type entry struct {
	path      []int
	ancestors []*collection.Item
	item      *collection.Item
}
