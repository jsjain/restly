package main

const (
	eventRunResult    = "run:result"
	eventRunDone      = "run:done"
	eventHistoryAdded = "history:added"
	eventWebSocket    = "ws:event"
	eventQuitRequest  = "app:quit-requested"

	// maxBodyView caps the body sent to the webview. Larger bodies are saved to a file instead.
	maxBodyView = 10 << 20

	collectionExt  = ".postman_collection.json"
	environmentExt = ".postman_environment.json"
	globalsFile    = "globals.postman_globals.json"

	// Files in the per-machine data folder.
	settingsFile = "settings.json"
	cookiesFile  = "cookies.json"
	historyFile  = "history.jsonl"
	historyLimit = 500

	themesDir       = "themes" // imported VS Code color themes, kept as the original files
	keybindingsFile = "keybindings.json"
	maxThemeSize    = 5 << 20
)

// keybindingsTemplate is written when keybindings.json does not exist yet.
const keybindingsTemplate = `// Restly keybindings, in the shape of VS Code's keybindings.json.
// Each entry binds a key to a command id. Keyboard Shortcuts (cmd+/ or ctrl+/) lists the ids.
// A command starting with "-" removes that key from the command, so the default can be replaced.
// The defaults, in this format ("mod" is cmd on macOS and ctrl elsewhere), are listed at
// https://github.com/jsjain/restly/blob/main/frontend/src/keybindings.default.json
// Restly reloads this file when its window regains focus.
[
  // { "key": "cmd+shift+]", "command": "next-tab" },
  // { "key": "cmd+t", "command": "-new-http-request" }
]
`
