<p align="center">
  <img src="icon.png" width="112" alt="Restly logo">
</p>

<h1 align="center">Restly</h1>

<p align="center">
  A fast desktop API client that works directly on your Postman collections.<br>
  <a href="https://github.com/jsjain/restly/releases/latest"><b>Download for macOS, Windows, and Linux</b></a>
</p>

## Why Restly

- **Your collections stay plain files.** Restly reads and writes Postman v2.1 collection and environment files in `~/Restly`. You can keep them in git, review changes in a pull request, and still open them in Postman. There is no account, sign-in, or cloud sync.
- **Your Postman scripts keep running.** Pre-request and test scripts use the same `pm` API and Chai assertions, including `pm.sendRequest` and `setNextRequest`.
- **It is light.** The app is a Go core in the system webview, not a bundled browser. The Apple silicon build is 18 MB and uses about 120 MB of memory after launch, and a 5 MB collection decodes in 124 ms on an M4 Pro.
- **It works from the keyboard.** Every action has a command in the palette, shortcuts can be remapped, and the collection tree is navigable with arrow keys. Themes and keybindings use VS Code's formats, so existing ones carry over.

## Features

- **Requests.** Params, headers, and body as raw JSON, XML, or text, URL-encoded, form data with files, binary, or GraphQL. Basic, bearer, and API key auth, inherited from folders and collections. JSON, XML, and GraphQL variable bodies can be formatted.
- **Responses.** Body, headers, cookies, test results, console output, and timings.
- **Variables and environments.** `{{variables}}` resolve from local, data, environment, collection, and global scopes, with `$guid`, `$timestamp`, `$isoTimestamp`, and `$randomInt`. Editors color each variable by whether it resolves, show its value on hover, and suggest names as you type. Values can be marked secret, and an environment can belong to one collection or be shared by all.
- **Scripts.** Pre-request and test scripts at collection, folder, and request level.
- **Collection runner.** Runs a collection or folder for several iterations with an optional delay, streaming results per request.
- **Code generation.** cURL, JavaScript fetch, Python requests, and Go, in a side panel that updates as you edit.
- **cURL import.** Paste a cURL command into the URL bar or the import dialog.
- **WebSocket requests.** Connect, send text messages, and read the event log.
- **History and cookies.** The last 500 sends reopen as editable requests, and the cookie jar can be viewed and edited.
- **Network settings.** Proxy with a bypass list, TLS verification toggle, extra CA certificates, and client certificates per host.
- **Collections.** Import and export Postman files, clone collections, and edit the description, auth, and scripts of collections and folders, and collection variables.
- **Themes.** Dark, Light, and One Dark built in, plus any imported VS Code color theme, with configurable UI and editor fonts.

## Install

Download the file for your system from the [latest release](https://github.com/jsjain/restly/releases/latest).

| System | File |
| --- | --- |
| macOS 12 or newer, Apple silicon and Intel | `Restly-<version>-macos-universal.zip` |
| Windows 10 or 11, 64-bit | `Restly-<version>-windows-amd64-setup.exe`, or the `portable.exe` without installing |
| Ubuntu 24.04, Debian 13, or newer, x86-64 | `restly_<version>_amd64.deb` |
| Other Linux x86-64 with glibc 2.39 or newer (Fedora 40 or newer) | `Restly-<version>-linux-amd64.tar.gz`, which needs GTK 3 and WebKitGTK 4.1 |

The builds are not signed with an Apple or Windows certificate, so the first launch shows a warning.

- **macOS.** Unzip, move Restly to Applications, and run `xattr -dr com.apple.quarantine /Applications/Restly.app` once, or open it and allow it under System Settings > Privacy & Security.
- **Windows.** In the SmartScreen dialog, choose More info > Run anyway. The installer adds WebView2 if it is missing.
- **Linux.** On Ubuntu or Debian, `sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0`, then run `./restly`.

## Keyboard shortcuts

The default shortcuts are listed in [`frontend/src/keybindings.default.json`](frontend/src/keybindings.default.json), where `mod` means ⌘ on macOS and Ctrl elsewhere. To change them, run "Open Keybindings File" from the command palette (⌘K or Ctrl+K) and add entries in the same format: `{ "key": "cmd+j", "command": "send" }` adds a key, and `{ "key": "mod+enter", "command": "-send" }` removes one. Press ⌘/ or Ctrl+/ to see every shortcut in the app.

## Themes

Settings > Appearance lists the built-in themes and imports any VS Code color theme JSON file. Restly reads a theme's `colors` and `tokenColors`. Colors VS Code has no key for can be set with `restly.<token>` keys under `colors`, using the names in [`frontend/src/theme/tokens.ts`](frontend/src/theme/tokens.ts), for example `"restly.methodGet": "#00c853"`. Every color in the interface comes from these tokens. Colors that would fail WCAG AA contrast are adjusted slightly, and the theme list notes which ones.

## Where data is stored

Collections and environments live in `~/Restly`. Import copies Postman exports there, and Export copies them out unchanged. Restly adds two members that Postman ignores: `x-restly-collection` on an environment that belongs to one collection, and `x-restly-type` on WebSocket requests, which Postman imports as plain GET requests.

Settings, cookies, history, imported themes, and `keybindings.json` stay on the machine: `~/Library/Application Support/Restly` on macOS, `%AppData%\Restly` on Windows, and `~/.config/Restly` on Linux. They can hold tokens and session cookies in plain text, which is why they are kept out of a workspace you might share. Environment values are also plain text, as in Postman exports.

## Build from source

Requirements: Go 1.25 or newer, Node.js 22.18 or newer, and the Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0`). macOS needs the Xcode command line tools, Windows needs WebView2, and Linux needs `libgtk-3-dev` and `libwebkit2gtk-4.1-dev`.

```sh
wails dev    # development build with live reload

# Release build in build/bin. The flags stamp the commit and build time shown in Settings > About.
wails build -clean -ldflags "-X main.buildCommit=$(git rev-parse --short HEAD) -X main.buildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Add `-tags webkit2_41` on Linux and `-nsis` on Windows for the installer. [`.github/workflows/build.yml`](.github/workflows/build.yml) has the exact steps for each system.

Tests:

```sh
go test ./...
for check in frontend/checks/*.check.ts; do node "$check"; done
```

## Releasing

The version is `info.productVersion` in `wails.json`. Change it and commit, then either push a matching tag (`git tag v1.0.1 && git push origin v1.0.1`) or publish a release with that tag on GitHub. The Build workflow builds all three systems and attaches the files and `SHA256SUMS.txt` to the release, creating the release for a pushed tag. It fails if the tag and the version differ. Running the workflow by hand from the Actions tab builds without publishing and keeps the files as run artifacts.

## Limits

- Scripts run in goja, not V8. `for await` and async generators are not supported, and `require` only provides `chai`.
- Auth types other than basic, bearer, and API key are kept in the file but not applied. OAuth 2 token flows are not implemented.
- Client certificates must be PEM files without a passphrase.
- There is no cloud sync, mock server, or monitor.

## License

[MIT](LICENSE)
