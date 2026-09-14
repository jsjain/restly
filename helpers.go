package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os/exec"
	goruntime "runtime"
	"runtime/debug"
	"sync"
)

//go:embed wails.json
var wailsConfigJSON []byte

// buildAppInfo parses the embedded wails.json and the Go build info once, since neither
// changes while the app runs.
var buildAppInfo = sync.OnceValues(func() (AppInfo, error) {
	var config struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if err := json.Unmarshal(wailsConfigJSON, &config); err != nil {
		return AppInfo{}, fmt.Errorf("failed to parse embedded wails.json: %w", err)
	}
	info := AppInfo{Version: config.Info.ProductVersion}
	buildInfo, ok := debug.ReadBuildInfo()
	if !ok {
		return info, nil
	}
	info.GoVersion = buildInfo.GoVersion
	var revision string
	var dirty bool
	for _, setting := range buildInfo.Settings {
		switch setting.Key {
		case "vcs.revision":
			revision = setting.Value
		case "vcs.time":
			info.BuildTime = setting.Value
		case "vcs.modified":
			dirty = setting.Value == "true"
		}
	}
	if len(revision) >= 7 {
		info.Commit = revision[:7]
		if dirty {
			info.Commit += "-dirty"
		}
	}
	return info, nil
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
