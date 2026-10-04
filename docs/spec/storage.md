# Storage and per-machine data

Where collections, environments, settings, and other files live. Part of the [Restly spec](README.md).

## D1 Storage

On-disk format is Postman v2.1 collection JSON, one file per collection, and `.postman_environment.json` for environments, in a workspace folder. Import copies the file (v2.0 converted, v1 rejected). Export writes the file. Typed Go fields cover what the app edits. Unknown fields are kept so load and save never drop data. Saves write a temp file and rename it. Ceiling: each save rewrites the whole collection file. The webview opens and saves collection JSON as raw bytes, skipping the Go model, which also keeps the file's key order. Go decodes the file only for sends and runs.

## D12 Per-machine data

Settings, cookies, history, imported themes (`themes/`, kept as the original VS Code files), `keybindings.json`, and `restly.log` live in the OS config folder (`~/Library/Application Support/Restly` on macOS), not the workspace. They hold proxy credentials, session cookies, and resolved tokens, and a workspace may be shared or kept in git. Nothing is encrypted.
