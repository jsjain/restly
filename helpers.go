package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os/exec"
	goruntime "runtime"
	"sync"
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
