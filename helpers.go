package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sync"

	"restly/internal/httpx"
)

//go:embed wails.json
var wailsConfigJSON []byte

// Set with -ldflags "-X main.buildCommit=... -X main.buildTime=...". The Go build info cannot
// supply them, because wails build always passes -buildvcs=false.
var (
	buildCommit string
	buildTime   string
)

// buildAppInfo parses the embedded wails.json once, since it cannot change while the app runs.
var buildAppInfo = sync.OnceValues(func() (AppInfo, error) {
	var config struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if err := json.Unmarshal(wailsConfigJSON, &config); err != nil {
		return AppInfo{}, fmt.Errorf("failed to parse embedded wails.json: %w", err)
	}
	return AppInfo{
		Version:   config.Info.ProductVersion,
		Commit:    buildCommit,
		BuildTime: buildTime,
		GoVersion: goruntime.Version(),
	}, nil
})

// openInTextEditor opens path in the system's editor without waiting for it to close.
func openInTextEditor(path string) error {
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "darwin":
		// -t picks the default text editor, since .json may belong to an app that cannot edit it.
		cmd = exec.Command("open", "-t", path)
	case "windows":
		cmd = exec.Command("notepad", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to open %s in a text editor: %w", path, err)
	}
	go cmd.Wait()
	return nil
}

// revealInFileManager shows path selected in the system file manager without waiting for it to close.
func revealInFileManager(path string) error {
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	case "windows":
		// explorer exits 1 even when it succeeds, so only Start is checked.
		cmd = exec.Command("explorer", "/select,"+path)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to reveal %s: %w", path, err)
	}
	go cmd.Wait()
	return nil
}

// openLogFile opens path for appending. A file over maxLogBytes first replaces path+".1",
// so the log never grows past about two files' worth.
func openLogFile(path string) (*os.File, error) {
	if info, err := os.Stat(path); err == nil && info.Size() > maxLogBytes {
		if err := os.Rename(path, path+".1"); err != nil {
			return nil, fmt.Errorf("failed to rotate log file %s: %w", path, err)
		}
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file %s: %w", path, err)
	}
	return file, nil
}

// normalizeHistoryLimit maps an unset limit (older settings.json files) to the default and caps the rest.
func normalizeHistoryLimit(limit int) int {
	if limit <= 0 {
		return defaultHistoryLimit
	}
	return min(limit, maxHistoryLimit)
}

func defaultSettings() Settings {
	return Settings{Network: httpx.DefaultNetwork(), HistoryLimit: defaultHistoryLimit}
}
