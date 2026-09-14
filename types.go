package main

import (
	"restly/internal/collection"
	"restly/internal/httpx"
	"restly/internal/script"
	"restly/internal/vars"
)

// AppInfo is the version information shown in Settings > About.
type AppInfo struct {
	Version   string `json:"version"`   // wails.json info.productVersion, compiled in
	Commit    string `json:"commit"`    // main.buildCommit from -ldflags, "" when not set
	BuildTime string `json:"buildTime"` // main.buildTime from -ldflags, RFC 3339, "" when not set
	GoVersion string `json:"goVersion"`
}

type Workspace struct {
	Dir          string    `json:"dir"`
	Collections  []FileRef `json:"collections"`
	Environments []FileRef `json:"environments"`
	Globals      string    `json:"globals"` // globals file, opened and saved like an environment
}

// Settings are per-machine preferences stored outside the workspace.
type Settings struct {
	Network httpx.Network `json:"network"`
}

type FileRef struct {
	File       string `json:"file"` // absolute path
	Name       string `json:"name"`
	Collection string `json:"collection,omitempty"` // an environment's owning collection file, absolute path
}

// TextFile is a file from the per-machine data folder with its text: an imported theme or keybindings.json.
type TextFile struct {
	File string `json:"file"` // absolute path
	Data string `json:"data"`
}

type SendInput struct {
	File string           `json:"file"` // collection file
	Path []int            `json:"path"` // item position from the collection root
	Item *collection.Item `json:"item"` // editor state, which may be unsaved
	Env  string           `json:"env"`  // environment file, "" for none
}

type SendResult struct {
	Response    *httpx.Response         `json:"response"` // nil when the request was not sent
	Body        string                  `json:"body"`     // at most maxBodyView bytes
	Binary      bool                    `json:"binary"`   // body is not UTF-8 text, so Body is empty
	Truncated   bool                    `json:"truncated"`
	Tests       []script.TestResult     `json:"tests"`
	Console     []string                `json:"console"`
	Error       string                  `json:"error"`
	Variables   []collection.Variable   `json:"variables"`   // collection variables after scripts ran
	Environment *collection.Environment `json:"environment"` // nil when no environment is selected
}

// target is the collection context a request runs in.
type target struct {
	collFile string
	coll     *collection.Collection
	envFile  string                  // "" when no environment is selected
	env      *collection.Environment // nil when no environment is selected
	scope    *vars.Scope
}

type RunInput struct {
	File       string `json:"file"`
	Path       []int  `json:"path"` // folder to run, empty for the whole collection
	Env        string `json:"env"`
	Iterations int    `json:"iterations"`
	DelayMs    int    `json:"delayMs"`
}
