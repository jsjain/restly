package history

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"restly/internal/collection"
)

// requireOK fails the test on a non-nil error. Call sites bind the value first, e.g.:
//
//	store, err := Open(path, limit)
//	requireOK(t, err)
func requireOK(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func assertSameJSON(t *testing.T, label string, want, got []byte) {
	t.Helper()
	var wantValue, gotValue any
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("%s: failed to parse want: %v", label, err)
	}
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("%s: failed to parse got: %v", label, err)
	}
	if !reflect.DeepEqual(wantValue, gotValue) {
		t.Errorf("%s: JSON differs\nwant: %s\ngot:  %s", label, want, got)
	}
}

func readLines(t *testing.T, path string) []string {
	t.Helper()
	data, err := os.ReadFile(path)
	requireOK(t, err)
	trimmed := strings.TrimRight(string(data), "\n")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "\n")
}

func makeSequentialEntries(count int) []Entry {
	entries := make([]Entry, count)
	for i := range entries {
		entries[i] = Entry{
			ID:     fmt.Sprintf("e%d", i),
			Time:   int64(i),
			Method: "GET",
			URL:    fmt.Sprintf("https://example.com/%d", i),
		}
	}
	return entries
}

func writeRawEntries(t *testing.T, path string, entries []Entry) {
	t.Helper()
	var buf bytes.Buffer
	for _, entry := range entries {
		line, err := json.Marshal(entry)
		requireOK(t, err)
		buf.Write(line)
		buf.WriteByte('\n')
	}
	requireOK(t, os.WriteFile(path, buf.Bytes(), 0o600))
}

func TestAddThenListIsNewestFirstWithUniqueIDs(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "history.jsonl"), 500)
	requireOK(t, err)

	var added []Entry
	for i := range 3 {
		entry, err := store.Add(Entry{Method: "GET", URL: fmt.Sprintf("https://example.com/%d", i)})
		requireOK(t, err)
		added = append(added, entry)
	}

	seen := map[string]bool{}
	for _, entry := range added {
		if entry.ID == "" {
			t.Fatalf("Add returned an empty ID")
		}
		if seen[entry.ID] {
			t.Fatalf("Add returned duplicate ID %s", entry.ID)
		}
		seen[entry.ID] = true
	}

	listed := store.List()
	if len(listed) != len(added) {
		t.Fatalf("List() returned %d entries, want %d", len(listed), len(added))
	}
	for i, entry := range listed {
		if want := added[len(added)-1-i]; entry.ID != want.ID {
			t.Errorf("List()[%d].ID = %s, want %s (newest first)", i, entry.ID, want.ID)
		}
	}
}

func TestOpenTrimsToLimitAndRewritesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	writeRawEntries(t, path, makeSequentialEntries(10))

	store, err := Open(path, 3)
	requireOK(t, err)

	listed := store.List()
	if len(listed) != 3 {
		t.Fatalf("List() returned %d entries, want 3", len(listed))
	}
	for i, entry := range listed {
		if want := fmt.Sprintf("e%d", 9-i); entry.ID != want {
			t.Errorf("List()[%d].ID = %s, want %s", i, entry.ID, want)
		}
	}
	if lines := readLines(t, path); len(lines) != 3 {
		t.Fatalf("file has %d lines after Open, want 3", len(lines))
	}
}

func TestOpenSkipsCorruptLinesAndRewrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	valid1, err := json.Marshal(Entry{
		ID:     "e1",
		Time:   1,
		Method: "GET",
		URL:    "https://a",
	})
	requireOK(t, err)
	valid2, err := json.Marshal(Entry{
		ID:     "e2",
		Time:   2,
		Method: "GET",
		URL:    "https://b",
	})
	requireOK(t, err)
	content := string(valid1) + "\n" + "not valid json\n" + string(valid2) + "\n" + `{"broken":` + "\n"
	requireOK(t, os.WriteFile(path, []byte(content), 0o600))

	store, err := Open(path, 500)
	requireOK(t, err)

	listed := store.List()
	if len(listed) != 2 {
		t.Fatalf("List() returned %d entries, want 2", len(listed))
	}
	if lines := readLines(t, path); len(lines) != 2 {
		t.Fatalf("file has %d lines after Open, want 2 (corrupt lines dropped)", len(lines))
	}
}

func TestReopenAfterAddReturnsSameEntries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	store, err := Open(path, 500)
	requireOK(t, err)
	added, err := store.Add(Entry{Method: "GET", URL: "https://example.com"})
	requireOK(t, err)

	reopened, err := Open(path, 500)
	requireOK(t, err)
	listed := reopened.List()
	if len(listed) != 1 || listed[0].ID != added.ID {
		t.Fatalf("List() after reopen = %+v, want [%+v]", listed, added)
	}
}

func TestDeletePersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	store, err := Open(path, 500)
	requireOK(t, err)
	first, err := store.Add(Entry{Method: "GET", URL: "https://a"})
	requireOK(t, err)
	_, err = store.Add(Entry{Method: "GET", URL: "https://b"})
	requireOK(t, err)

	requireOK(t, store.Delete(first.ID))
	requireOK(t, store.Delete("does-not-exist")) // an unknown ID is not an error

	reopened, err := Open(path, 500)
	requireOK(t, err)
	listed := reopened.List()
	if len(listed) != 1 || listed[0].ID == first.ID {
		t.Fatalf("List() after reopen = %+v, want the deleted entry gone", listed)
	}
}

func TestClearPersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	store, err := Open(path, 500)
	requireOK(t, err)
	_, err = store.Add(Entry{Method: "GET", URL: "https://a"})
	requireOK(t, err)

	requireOK(t, store.Clear())
	if listed := store.List(); len(listed) != 0 {
		t.Fatalf("List() after Clear = %+v, want empty", listed)
	}

	reopened, err := Open(path, 500)
	requireOK(t, err)
	if listed := reopened.List(); len(listed) != 0 {
		t.Fatalf("List() after reopen = %+v, want empty", listed)
	}
}

func TestFileModeIs0600(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	limit := 2
	store, err := Open(path, limit)
	requireOK(t, err)
	_, err = store.Add(Entry{Method: "GET", URL: "https://a"})
	requireOK(t, err)

	info, err := os.Stat(path)
	requireOK(t, err)
	if info.Mode().Perm() != 0o600 {
		t.Errorf("file mode after Add = %v, want 0600", info.Mode().Perm())
	}

	// Push past the compaction threshold so the rewrite path (temp file + rename) also runs.
	for range limit * compactionFactor {
		_, err := store.Add(Entry{Method: "GET", URL: "https://a"})
		requireOK(t, err)
	}
	info, err = os.Stat(path)
	requireOK(t, err)
	if info.Mode().Perm() != 0o600 {
		t.Errorf("file mode after compaction = %v, want 0600", info.Mode().Perm())
	}
}

func TestCompactionTriggersPastTwiceLimit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	limit := 3
	store, err := Open(path, limit)
	requireOK(t, err)

	for i := range 2 * limit {
		_, err := store.Add(Entry{Method: "GET", URL: fmt.Sprintf("https://example.com/%d", i)})
		requireOK(t, err)
	}
	if lines := len(readLines(t, path)); lines != 2*limit {
		t.Fatalf("file has %d lines at 2x limit, want %d (no compaction yet)", lines, 2*limit)
	}

	_, err = store.Add(Entry{Method: "GET", URL: "https://example.com/trigger"})
	requireOK(t, err)

	if lines := len(readLines(t, path)); lines != limit {
		t.Fatalf("file has %d lines just past 2x limit, want %d (compacted)", lines, limit)
	}
}

func TestAddDropsOversizedBodyWithoutMutatingCaller(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	store, err := Open(path, 500)
	requireOK(t, err)

	bigBody := strings.Repeat("x", maxStoredLineBytes+1024)
	item := &collection.Item{
		Name: "big",
		Request: &collection.Request{
			Method: "POST",
			URL:    &collection.URL{Raw: "https://example.com"},
			Body:   &collection.Body{Mode: "raw", Raw: bigBody},
		},
	}

	stored, err := store.Add(Entry{Method: "POST", URL: "https://example.com", Item: item})
	requireOK(t, err)

	if stored.Item == nil || stored.Item.Request == nil || stored.Item.Request.Body != nil {
		t.Fatalf("stored entry still carries the oversized body: %+v", stored.Item)
	}
	if !strings.Contains(stored.Error, droppedBodyNotice) {
		t.Errorf("stored entry Error = %q, want it to mention %q", stored.Error, droppedBodyNotice)
	}
	if item.Request.Body == nil || item.Request.Body.Raw != bigBody {
		t.Fatalf("caller's Item was mutated: %+v", item.Request.Body)
	}

	lines := readLines(t, path)
	if len(lines) != 1 {
		t.Fatalf("file has %d lines, want 1", len(lines))
	}
	if len(lines[0]) > maxStoredLineBytes {
		t.Errorf("stored line is %d bytes, want at most %d (the oversized body should have been dropped)", len(lines[0]), maxStoredLineBytes)
	}
}

func TestOpenRoundTripsUnknownItemMembers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	store, err := Open(path, 500)
	requireOK(t, err)

	// host and protocol are included because collection.URL.MarshalJSON always derives and
	// writes them from raw, so a fixture without them would fail on the very first marshal.
	itemJSON := `{"name":"ws","x-restly-type":"websocket","protocolProfileBehavior":{"disableBodyPruning":true},` +
		`"request":{"method":"GET","url":{"raw":"wss://example.com","host":["example","com"],"protocol":"wss"}}}`
	var item collection.Item
	requireOK(t, json.Unmarshal([]byte(itemJSON), &item))

	_, err = store.Add(Entry{Method: "WS", URL: "wss://example.com", Item: &item})
	requireOK(t, err)

	reopened, err := Open(path, 500)
	requireOK(t, err)
	listed := reopened.List()
	if len(listed) != 1 {
		t.Fatalf("List() returned %d entries, want 1", len(listed))
	}

	out, err := json.Marshal(listed[0].Item)
	requireOK(t, err)
	assertSameJSON(t, "round-tripped item", []byte(itemJSON), out)
}

func TestConcurrentAddsAllLand(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	store, err := Open(path, 500)
	requireOK(t, err)

	const concurrentAdds = 50
	var waitGroup sync.WaitGroup
	waitGroup.Add(concurrentAdds)
	for i := range concurrentAdds {
		go func(index int) {
			defer waitGroup.Done()
			if _, err := store.Add(Entry{Method: "GET", URL: fmt.Sprintf("https://example.com/%d", index)}); err != nil {
				t.Errorf("Add failed: %v", err)
			}
		}(i)
	}
	waitGroup.Wait()

	listed := store.List()
	if len(listed) != concurrentAdds {
		t.Fatalf("List() returned %d entries, want %d", len(listed), concurrentAdds)
	}
	seen := map[string]bool{}
	for _, entry := range listed {
		if seen[entry.ID] {
			t.Errorf("List() contains duplicate ID %s", entry.ID)
		}
		seen[entry.ID] = true
	}
}
