<img src="icon.png" width="96"/>

# Restly

A fast desktop API client that reads and writes Postman collections directly. Design: `docs/superpowers/specs/2026-09-13-restly-design.md`.

## Requirements

- Go 1.25 or newer
- Node.js with npm
- Wails CLI v2.15: `go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0`
- macOS: Xcode command line tools. Windows: WebView2 (preinstalled on Windows 11). Linux: `libgtk-3-dev` and `libwebkit2gtk-4.1-dev`.

## Build and run

```sh
# macOS: build/bin/restly.app. The flags stamp the commit and build time shown in Settings > About.
wails build -clean -ldflags "-X main.buildCommit=$(git rev-parse --short HEAD) -X main.buildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
open build/bin/restly.app

wails dev                       # live-reload development build
```

Wails builds for the OS it runs on, so build the Windows and Linux binaries on those systems.

The app version comes from `wails.json`'s `info.productVersion` and is shown in Settings > About, alongside the build commit and date when available.

## Workspace

Collections and environments live in `~/Restly` as Postman files (`*.postman_collection.json`, `*.postman_environment.json`). Import copies Postman exports there, and Export copies them out unchanged. Variable changes made by scripts are saved to those files. Environment values are stored in plain text, as in Postman exports.

An environment created from a collection's Environments tab belongs to that collection: its file carries `"x-restly-collection"`, and only that collection's requests offer it. Environments created from the sidebar are shared by every request.

Postman exports have no WebSocket requests, so Restly saves them with an `x-restly-type` member. Postman ignores that member and imports them as plain GET requests.

## Per-machine data

Settings (proxy, SSL, client certificates), cookies, and request history live outside the workspace: `~/Library/Application Support/Restly` on macOS, `%AppData%\Restly` on Windows, and `~/.config/Restly` on Linux. They can hold tokens and session cookies in plain text, which is why they stay out of a workspace you might share or keep in git.

## Keyboard shortcuts

Press ⌘/ (Ctrl+/ on Windows and Linux) to list every shortcut. The most used:

- ⌘↵ sends a request or connects a WebSocket
- ⌘S saves
- ⌘K opens the command palette, ⌘P opens a request by name, ⌘E switches environment
- ⌘N (or ⌘T) opens a new request, ⌘O imports a cURL command, ⌘W closes the tab, ⌘⇧T reopens the last closed tab
- ⌘L focuses the URL, ⌘B toggles the sidebar, ⌘⇧F searches the sidebar
- ⌘⇧] and ⌘⇧[ (or Ctrl+PageDown and Ctrl+PageUp) move to the next and previous tab
- ⌘⇧E or ⌘0 moves focus into the collection tree. There, arrows move and expand, Enter opens, F2 renames, Delete deletes after asking, typing jumps to a name, and Escape returns to the request
- ⌥⌘C toggles the code panel, and ⇧⌥F formats a JSON, XML, or GraphQL variables body

Keys are remapped in `keybindings.json` in the per-machine data folder, using VS Code's format: `{ "key": "cmd+j", "command": "new-http-request" }` adds a key, and `"command": "-new-http-request"` removes one. The Keyboard Shortcuts overlay lists command ids and opens the file, and Restly reloads it when its window regains focus. `when` clauses and two-step chords such as `cmd+k cmd+s` are not supported.

## Themes and fonts

Settings > Appearance lists Dark (VS Code Dark Modern), Light (VS Code Light Modern), One Dark (OneDark-Pro), and imported themes. "Import VS Code theme…" accepts any VS Code color theme JSON file and copies it into `themes/` in the per-machine data folder. To make your own theme, write a VS Code color theme: the keys under `colors` (such as `editor.background` or `input.border`) and the scopes under `tokenColors` are what Restly reads. Colors that would fail WCAG AA contrast are adjusted slightly, and the theme list notes which ones. The same page sets the UI font, Inter by default, and the editor font and sizes.

## Tests

```sh
go test ./...
```

`internal/collection` round-trips the real collections listed in `collection_test.go` when they exist on the machine.

## Script support limits

Scripts run in goja, not V8. `for await` and async generators are not supported, and `require` only provides `chai`.
