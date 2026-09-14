package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"restly/internal/collection"
)

// EffectiveAuth returns the request's own auth, else the nearest folder's, else the collection's.
// A missing auth or type "inherit" defers to the parent.
func EffectiveAuth(coll *collection.Collection, ancestors []*collection.Item, req *collection.Request) *collection.Auth {
	if explicit(req.Auth) {
		return req.Auth
	}
	for _, folder := range slices.Backward(ancestors) {
		if explicit(folder.Auth) {
			return folder.Auth
		}
	}
	if explicit(coll.Auth) {
		return coll.Auth
	}
	return nil
}

func explicit(auth *collection.Auth) bool {
	return auth != nil && auth.Type != "" && auth.Type != "inherit"
}

// cloneRequest copies the request so pre-request scripts never change the saved item.
func cloneRequest(item *collection.Item) (*collection.Request, error) {
	if item == nil || item.Request == nil {
		return nil, errors.New("item is not a request")
	}
	data, err := json.Marshal(item.Request)
	if err != nil {
		return nil, fmt.Errorf("failed to copy request %q: %w", item.Name, err)
	}
	var req collection.Request
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("failed to copy request %q: %w", item.Name, err)
	}
	return &req, nil
}

func flatten(coll *collection.Collection, folder []int) ([]entry, error) {
	items := coll.Item
	var ancestors []*collection.Item
	if len(folder) > 0 {
		node, parents, err := coll.At(folder)
		if err != nil {
			return nil, fmt.Errorf("failed to find folder to run: %w", err)
		}
		if !node.IsFolder() {
			return nil, fmt.Errorf("%q is not a folder", node.Name)
		}
		items = node.Item
		ancestors = append(slices.Clone(parents), node)
	}
	var entries []entry
	var walk func(items []*collection.Item, path []int, ancestors []*collection.Item)
	walk = func(items []*collection.Item, path []int, ancestors []*collection.Item) {
		for i, item := range items {
			itemPath := append(slices.Clone(path), i)
			if item.IsFolder() {
				walk(item.Item, itemPath, append(slices.Clone(ancestors), item))
				continue
			}
			if item.IsWebSocket() {
				// The HTTP runner cannot send WebSocket requests.
				continue
			}
			entries = append(entries, entry{
				path:      itemPath,
				ancestors: ancestors,
				item:      item,
			})
		}
	}
	walk(items, folder, ancestors)
	return entries, nil
}

// nextIndex applies setNextRequest. Like Postman, a null name or an unknown name stops the run.
func nextIndex(entries []entry, current int, next *string) (int, bool) {
	if next == nil {
		return current + 1, false
	}
	for i, candidate := range entries {
		if *next != "" && candidate.item.Name == *next {
			return i, false
		}
	}
	return 0, true
}

func newResult(iteration int, current entry, outcome *Outcome) Result {
	result := Result{
		Iteration: iteration,
		Path:      current.path,
		Name:      current.item.Name,
		Method:    current.item.Request.Method,
		Tests:     outcome.Tests,
		Console:   outcome.Console,
		Skipped:   outcome.Skipped,
	}
	if current.item.Request.URL != nil {
		result.URL = current.item.Request.URL.Raw
	}
	if outcome.Prepared != nil {
		result.Method = outcome.Prepared.Method
		result.URL = outcome.Prepared.URL
	}
	if outcome.Response != nil {
		result.Code = outcome.Response.Code
		result.Status = outcome.Response.Status
		result.TimeMs = outcome.Response.Timings.Total
	}
	if outcome.Err != nil {
		result.Error = outcome.Err.Error()
	}
	return result
}

func (summary *Summary) add(result Result) {
	summary.Requests++
	for _, test := range result.Tests {
		if test.Passed {
			summary.Passed++
		} else {
			summary.Failed++
		}
	}
	if result.Error != "" {
		summary.Errors++
	}
}

// sleep waits for delay and reports false when ctx ends first.
func sleep(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
