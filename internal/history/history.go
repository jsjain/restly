// Package history keeps the requests the user sent in a JSON Lines file.
package history

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"slices"
	"time"
)

// Open reads the history at path and keeps the newest limit entries. A missing file is an empty history.
func Open(path string, limit int) (*Store, error) {
	store := &Store{path: path, limit: limit}

	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to open history file %s: %w", path, err)
	}

	var entries []Entry
	lineCount := 0
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, bufio.MaxScanTokenSize), maxScanLineBytes)
	for scanner.Scan() {
		lineCount++
		var entry Entry
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			continue // corrupt line: skipped, and the mismatch below triggers a rewrite
		}
		entries = append(entries, entry)
	}
	// Close before a possible rewrite below renames over path: some platforms refuse
	// to replace a file that still has an open read handle.
	if err := errors.Join(scanner.Err(), file.Close()); err != nil {
		return nil, fmt.Errorf("failed to read history file %s: %w", path, err)
	}

	kept := trimNewest(entries, limit)
	store.entries = kept
	store.lineCount = len(kept)

	if len(kept) != lineCount {
		if err := writeEntriesAtomic(path, kept); err != nil {
			return nil, err
		}
	}
	return store, nil
}

// Add assigns entry an ID, appends it, and returns it.
func (store *Store) Add(entry Entry) (Entry, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	id, err := generateID()
	if err != nil {
		return Entry{}, err
	}
	entry.ID = id
	if entry.Time == 0 {
		entry.Time = time.Now().UnixMilli()
	}

	stored := entry
	line, err := encodeEntry(entry)
	if err != nil {
		return Entry{}, err
	}
	if len(line) > maxStoredLineBytes {
		stored, err = withoutBody(entry)
		if err != nil {
			return Entry{}, err
		}
		if line, err = encodeEntry(stored); err != nil {
			return Entry{}, err
		}
	}

	file, err := os.OpenFile(store.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, fileMode)
	if err != nil {
		return Entry{}, fmt.Errorf("failed to open history file %s: %w", store.path, err)
	}
	if _, err := file.Write(line); err != nil {
		return Entry{}, errors.Join(fmt.Errorf("failed to append history entry: %w", err), file.Close())
	}
	if err := file.Close(); err != nil {
		return Entry{}, fmt.Errorf("failed to close history file %s: %w", store.path, err)
	}

	store.entries = trimNewest(append(store.entries, stored), store.limit)
	store.lineCount++

	if store.limit > 0 && store.lineCount > store.limit*compactionFactor {
		if err := writeEntriesAtomic(store.path, store.entries); err != nil {
			return Entry{}, err
		}
		store.lineCount = len(store.entries)
	}

	return stored, nil
}

// List returns the entries newest first.
func (store *Store) List() []Entry {
	store.mu.Lock()
	defer store.mu.Unlock()

	out := make([]Entry, len(store.entries))
	for i, entry := range store.entries {
		out[len(out)-1-i] = entry
	}
	return out
}

func (store *Store) Delete(id string) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	before := len(store.entries)
	store.entries = slices.DeleteFunc(store.entries, func(entry Entry) bool { return entry.ID == id })
	if len(store.entries) == before {
		return nil // an unknown ID is not an error
	}

	if err := writeEntriesAtomic(store.path, store.entries); err != nil {
		return err
	}
	store.lineCount = len(store.entries)
	return nil
}

func (store *Store) Clear() error {
	store.mu.Lock()
	defer store.mu.Unlock()

	file, err := os.OpenFile(store.path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, fileMode)
	if err != nil {
		return fmt.Errorf("failed to truncate history file %s: %w", store.path, err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("failed to close history file %s: %w", store.path, err)
	}
	store.entries = nil
	store.lineCount = 0
	return nil
}
