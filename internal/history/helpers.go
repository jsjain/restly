package history

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func generateID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("failed to generate history entry ID: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

func encodeEntry(entry Entry) ([]byte, error) {
	line, err := json.Marshal(entry)
	if err != nil {
		return nil, fmt.Errorf("failed to encode history entry: %w", err)
	}
	return append(line, '\n'), nil
}

// withoutBody deep-copies entry through JSON, clears its Item's request body, and notes why,
// so the caller's own Item is never mutated when an oversized entry is trimmed for storage.
func withoutBody(entry Entry) (Entry, error) {
	data, err := json.Marshal(entry)
	if err != nil {
		return Entry{}, fmt.Errorf("failed to clone oversized history entry: %w", err)
	}
	var clone Entry
	if err := json.Unmarshal(data, &clone); err != nil {
		return Entry{}, fmt.Errorf("failed to clone oversized history entry: %w", err)
	}
	if clone.Item != nil && clone.Item.Request != nil {
		clone.Item.Request.Body = nil
	}
	if clone.Error != "" {
		clone.Error += " " + droppedBodyNotice
	} else {
		clone.Error = droppedBodyNotice
	}
	return clone, nil
}

// trimNewest assumes entries is oldest first, so the newest limit entries are the tail.
func trimNewest(entries []Entry, limit int) []Entry {
	if limit <= 0 || len(entries) <= limit {
		return entries
	}
	return append([]Entry{}, entries[len(entries)-limit:]...)
}

// writeEntriesAtomic replaces path with one JSON Lines record per entry, via a temp file
// and rename, so a crash mid-write never leaves a half-written history file.
func writeEntriesAtomic(path string, entries []Entry) error {
	tempFile, err := os.CreateTemp(filepath.Dir(path), ".history-*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp file for %s: %w", path, err)
	}
	for _, entry := range entries {
		line, err := encodeEntry(entry)
		if err != nil {
			return errors.Join(err, tempFile.Close(), os.Remove(tempFile.Name()))
		}
		if _, err := tempFile.Write(line); err != nil {
			return errors.Join(fmt.Errorf("failed to write %s: %w", path, err), tempFile.Close(), os.Remove(tempFile.Name()))
		}
	}
	if err := tempFile.Sync(); err != nil {
		return errors.Join(fmt.Errorf("failed to sync %s: %w", path, err), tempFile.Close(), os.Remove(tempFile.Name()))
	}
	if err := tempFile.Close(); err != nil {
		return errors.Join(fmt.Errorf("failed to close %s: %w", path, err), os.Remove(tempFile.Name()))
	}
	if err := os.Rename(tempFile.Name(), path); err != nil {
		return errors.Join(fmt.Errorf("failed to replace %s: %w", path, err), os.Remove(tempFile.Name()))
	}
	return nil
}
