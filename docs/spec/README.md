# Restly spec

A fast desktop Postman alternative. Approved 2026-09-13. This folder records what Restly does and why, as numbered decisions (D1, D2, ...), one file per feature. Read only the file for the feature you are changing, and change its decision when the behavior changes. A new feature gets a new file and the next free D number, listed in the table below. UI rules are in [ui-guidelines.md](../ui-guidelines.md), and the script and variable reference is [variables-and-scripts.md](../variables-and-scripts.md).

## Scope

v1 features: collections, variables, environments, pre-request and test scripts, collection runner, code snippets, Postman v2.1 import and export.
Platforms: macOS, Windows, Linux desktop. Storage is local files.

Out of scope for v1: cloud sync, mocks, monitors, OAuth2 token flows, CLI runner, runner data files, gRPC, encrypted secrets.

## Stack

- Go core, Wails v2.15 shell (v3 is still beta), React + TypeScript + CodeMirror 6 frontend. React replaced Svelte on 2026-09-13 at the user's request for the larger, longer-lived ecosystem.
- Scripts run in Go with goja and the goja_nodejs event loop, not in the webview.
- Only `main.go` and `app.go` import Wails.

Verified before approval: goja runs `await` on a Promise resolved from a goroutine, Chai 4 `expect` works in goja, and `setTimeout` works. goja rejects `for await` and async generators.

## Layout

```
main.go, app.go         Wails window and bindings
titlebar_darwin.go      compact macOS title bar (no-op elsewhere, titlebar_other.go)
internal/collection/    Postman v2.1 and environment types, load, save, v2.0 import
internal/vars/          {{var}} resolution, scopes, dynamic variables
internal/httpx/         build and send requests, timings, body modes, auth
internal/script/        goja runtime, pm shim (JS, go:embed), Chai 4 (go:embed)
internal/runner/        collection runner
internal/snippet/       code snippet generation
internal/curl/          cURL import
internal/history/       send history
internal/ws/            WebSocket client
frontend/               React + TypeScript + CodeMirror 6
```

## Features

| File | Decisions | Covers |
|---|---|---|
| [storage.md](storage.md) | D1, D12 | Where collections, environments, settings, and other files live. |
| [variables.md](variables.md) | D2, D19, D22, D25 | Variable scopes, secrets and globals, variables in editors, and collection environments. |
| [http.md](http.md) | D3, D13, D14 | Sending requests, auth, proxy, TLS, User-Agent, and the cookie jar. |
| [scripts.md](scripts.md) | D4 | The script runtime and the pm and restly API. |
| [runner.md](runner.md) | D5 | Running a collection or folder. |
| [code-snippets.md](code-snippets.md) | D6, D28 | Code generation and the code panel. |
| [requests.md](requests.md) | D10, D11, D27, D29, D30 | Standalone requests, cURL import, request names, key-value editors, and body formatting. |
| [history.md](history.md) | D15 | The send history. |
| [websocket.md](websocket.md) | D16 | WebSocket requests. |
| [saving.md](saving.md) | D17 | Dirty tracking, the quit prompt, and auto-save. |
| [sidebar.md](sidebar.md) | D18 | Search, the environments block, and drag to reorder. |
| [themes.md](themes.md) | D20 | VS Code themes, color tokens, and the contrast guard. |
| [ui.md](ui.md) | D7, D21, D26, D34 | The main layout, window chrome, in-app controls, and the UI system. |
| [keyboard.md](keyboard.md) | D23 | Commands, shortcuts, keybindings.json, and find. |
| [collection-pages.md](collection-pages.md) | D24 | Overview, authorization, scripts, environments, and runs. |
| [settings.md](settings.md) | D33 | The Settings tab and its sections. |
| [testing.md](testing.md) | D8, D9 | How Restly is tested and its performance targets. |
| [releases.md](releases.md) | D31, D32 | The version source, logo, CI builds, and release files. |
| [error-log.md](error-log.md) | D35 | restly.log and error reports from the webview. |

The next free decision number is D36.
