# Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restly checks GitHub for a newer release and, per a Settings choice, notifies, downloads and asks to restart, or installs on quit.

**Architecture:** A dependency-free Go package `internal/update` does the release lookup, version compare, install-kind detection, verified download and per-platform install. `updates.go` in package main owns the schedule, state and Wails bindings. The frontend adds a banner, a Settings > General choice and a Settings > About check button.

**Tech Stack:** Go stdlib (net/http, archive/tar, compress/gzip, crypto/sha256, os/exec), `hdiutil` and `ditto` on macOS, React + TypeScript.

**Spec:** [docs/spec/updates.md](../spec/updates.md) (D36)

## Global Constraints

- Default mode `notify`. Modes: `off`, `notify`, `download`, `auto`. Settings key `update.mode`, skipped version in `update.skipped`.
- Feed: `https://api.github.com/repos/jsjain/restly/releases/latest`, replaced by env `RESTLY_UPDATE_FEED` (tests only).
- First check 10 s after launch, then every 24 h, skipped when mode is `off`.
- Asset names: `Restly-<v>-macos-apple-silicon.dmg`, `Restly-<v>-macos-intel.dmg`, `Restly-<v>-windows-amd64-setup.exe`, `Restly-<v>-windows-amd64-portable.exe`, `Restly-<v>-linux-amd64.tar.gz` (binary `restly` at the archive root), checksums `SHA256SUMS.txt` (`<hex>  <name>` lines).
- Asset URLs must share the scheme and host of the trusted origin: `https://github.com` by default, the feed's scheme and host when `RESTLY_UPDATE_FEED` is set.
- No new Go or npm dependencies. Go code follows the `go-code-style` skill. UI follows `docs/ui-guidelines.md`.
- Gates: `go vet ./... && go test ./...`, `cd frontend && npx tsc --noEmit -p . && npm run build`, `for c in frontend/checks/*.check.ts; do node "$c"; done`.

## Review Focus

1. Settings files written before this change have no `update` key: they must load as mode `notify` (Task 2 test).
2. A tag that is not `vMAJOR.MINOR.PATCH` (for example `v0.4.0-beta`, `nightly`) is never offered (Task 1 `Newer` cases).
3. A release missing the asset for this platform, or missing `SHA256SUMS.txt`, gives a notice without an Update button, never a broken download (Task 1 `Download` error, Task 2 `CanInstall`).
4. A failed macOS swap halfway (rename of the new bundle fails) leaves the old app in place (Task 1 swap test with a read-only parent).
5. Offline or rate-limited GitHub (HTTP 403) during the background check logs once and stays silent, with no banner (Task 2 test).

---

### Task 1: `internal/update` package

**Files:**
- Create: `internal/update/update.go`, `internal/update/install.go`, `internal/update/types.go`, `internal/update/constants.go`
- Test: `internal/update/update_test.go`, `internal/update/install_test.go`

**Interfaces (Produces):**
- `type Kind string` with `KindMacApp`, `KindWindowsSetup`, `KindWindowsPortable`, `KindLinuxTar`, `KindNoticeOnly`
- `type Release struct { Version string; PageURL string; Assets map[string]string }`, Version without the leading `v`, Assets maps file name to download URL
- `type Target struct { Kind Kind; Path string }`, Path is the `.app` bundle for KindMacApp, otherwise the executable
- `func Latest(ctx context.Context, client *http.Client, feedURL string) (Release, error)`
- `func Newer(candidate, current string) bool`
- `func Detect(exe, goos string) Target` (checks for `uninstall.exe` beside the exe on windows, and downgrades to KindNoticeOnly when the target's parent folder is not writable)
- `func AssetName(kind Kind, goarch, version string) string`, `""` for KindNoticeOnly
- `func Download(ctx context.Context, client *http.Client, rel Release, name, dir string, origin *url.URL) (string, error)`
- `func Install(ctx context.Context, target Target, file string, relaunch bool) error`
- `func Cleanup(target Target)` removes `<Path>.old`

- [ ] **Step 1: Write failing tests**
  - `TestNewer`: ("0.3.4","0.3.3") true, ("0.10.0","0.9.9") true, ("v1.0.0","0.3.3") true, ("0.3.3","0.3.3") false, ("0.3.2","0.3.3") false, ("0.4.0-beta","0.3.3") false, ("nightly","0.3.3") false.
  - `TestLatest`: an httptest server returning `{"tag_name":"v0.3.4","html_url":"https://github.com/jsjain/restly/releases/tag/v0.3.4","assets":[{"name":"SHA256SUMS.txt","browser_download_url":"..."}]}` gives Version "0.3.4" and the asset map. A 403 returns an error naming the status.
  - `TestDetect`: darwin `/Applications/Restly.app/Contents/MacOS/restly` gives KindMacApp with Path `/Applications/Restly.app` (use a temp dir in place of /Applications so it is writable). darwin outside a bundle gives KindNoticeOnly. linux `/usr/bin/restly` gives KindNoticeOnly. linux in a temp dir gives KindLinuxTar. windows temp dir with `uninstall.exe` gives KindWindowsSetup, without it KindWindowsPortable.
  - `TestAssetName`: each kind and arch pair maps to the names in Global Constraints. darwin arm64 is apple-silicon, amd64 is intel.
  - `TestDownload`: an httptest server serves the asset and `SHA256SUMS.txt`. A match returns a path whose bytes equal the asset. A wrong checksum, an asset missing from the sums, an asset missing from the release, and an asset URL on another host each return an error and leave no file.
  - `TestInstallSwap`: KindLinuxTar with a tar.gz holding `restly` replaces the target file's bytes, sets mode 0755, and leaves `<exe>.old`. Cleanup removes it. KindWindowsPortable swap logic is covered by the same internal swap function.
  - `TestInstallMacApp` (darwin only, skipped with `-short`): build a DMG with `hdiutil create -srcfolder` from a folder holding `Restly.app/Contents/Info.plist` with marker text, install it over a temp `Restly.app`, and assert the marker and that no mount is left.
- [ ] **Step 2: Run `go test ./internal/update/`**, expect compile failures.
- [ ] **Step 3: Implement.** macOS: `hdiutil attach -nobrowse -readonly -noautoopen -mountpoint <tmp>`, `ditto <mount>/Restly.app <bundle>.new`, rename bundle to `.old`, rename `.new` to bundle, restore `.old` if that fails, remove `.old`, always `hdiutil detach`. Relaunch with `open -n <bundle>`. Windows setup: start a detached `cmd /c` that waits 2 s (`timeout /t 2 /nobreak`), runs `<setup> /S`, then `start "" <exe>` only when relaunch is set. Portable and tar: write the new binary to `<exe>.new`, rename exe to `.old`, rename `.new` to exe, relaunch by starting the exe detached.
- [ ] **Step 4: Run `go vet ./... && go test ./internal/update/`**, expect PASS.

### Task 2: App wiring (`updates.go`)

**Files:**
- Create: `updates.go`, `updates_test.go`
- Modify: `types.go` (Settings, UpdateSettings, UpdateStatus), `helpers.go:105` (defaultSettings), `constants.go` (event name, intervals), `app.go` (startup starts the checker and runs Cleanup, shutdown installs), settings load path (normalize mode)

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces (Wails bindings): `GetUpdateStatus() UpdateStatus`, `CheckForUpdates() UpdateStatus`, `DownloadUpdate() error`, `RestartToUpdate()`, `SkipUpdate(version string) error`. Event `update:status` carries `UpdateStatus`.
- `type UpdateSettings struct { Mode string \`json:"mode"\`; Skipped string \`json:"skipped,omitempty"\` }`, `Settings.Update UpdateSettings \`json:"update"\``
- `type UpdateStatus struct { State, Version, PageURL, Error, CheckedAt string; CanInstall bool }` with json names `state, version, pageUrl, error, checkedAt, canInstall`. State is one of `idle`, `checking`, `current`, `available`, `downloading`, `ready`, `error`.

- [ ] **Step 1: Write failing tests** against an httptest feed (set through a field on App, not the env var): a newer release in notify mode gives `available`. In download mode it ends `ready` with the file on disk. A skipped version gives `idle` from the background check, but `available` from `CheckForUpdates`. A 403 gives `error` from `CheckForUpdates` and no event with state `available`. A settings file without `update` loads as mode `notify`. Mode `off` makes the background check do nothing.
- [ ] **Step 2: Implement.** One mutex guards status, release, downloaded file and the restart flag. Shutdown installs when the state is `ready` and either the restart flag is set or the mode is `auto`, relaunching only for the restart flag. `RestartToUpdate` sets the flag and calls `runtime.Quit`, so the unsaved-changes prompt still runs.
- [ ] **Step 3: Run `wails generate module`, then `go vet ./... && go test ./...`**, expect PASS.

### Task 3: Frontend

**Files:**
- Create: `frontend/src/components/UpdateBanner.tsx`, `frontend/src/updateBanner.css`
- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/components/AppSettingsTab.tsx`

**Interfaces:**
- Consumes: Task 2 bindings and the `update:status` event.
- Produces: `api.getUpdateStatus`, `api.checkForUpdates`, `api.downloadUpdate`, `api.restartToUpdate`, `api.skipUpdate`, `api.onUpdateStatus(cb): () => void`.

- [ ] **Step 1: Banner.** A single row under the tab bar, rendered from `Tabs.tsx`.
  - `available`: "Restly <v> is available." with "What's new" (opens PageURL), "Update" when CanInstall, and an icon dismiss button (`aria-label="Dismiss"`) that calls SkipUpdate.
  - `downloading`: "Downloading Restly <v>…"
  - `ready`: "Restly <v> is ready." with a `.primary` "Restart to update". In auto mode it also says "It installs when you quit."
  - Other states render nothing.
- [ ] **Step 2: Settings.**
  - General gets an "Updates" section. Its Row is titled "Updates", help "Restly checks GitHub for a new version at launch and once a day.", with a Select of: Off, "Notify me" (default), "Download and ask to restart", "Install automatically".
  - About gets a Row titled "Updates" whose help is the status line, with a "Check for updates" button.
  - Status lines:
    - "Restly is up to date."
    - "Restly <v> is available."
    - "Checking…"
    - "Couldn't check for updates. <error>"
    - "Restly <v> is ready to install."
- [ ] **Step 3: Run the frontend gates**, expect PASS. Then the screenshot loop in docs/ui-guidelines.md section 8, done by the orchestrator.

### Task 4: End-to-end check on macOS (orchestrator)

- [ ] Copy the 0.3.3 build to `/tmp/restly-e2e/Restly.app`. Build a 0.3.4 DMG named `Restly-0.3.4-macos-apple-silicon.dmg` with its `SHA256SUMS.txt`. Serve both with a `releases/latest` JSON from a local server.
- [ ] Run the copy with `HOME=/tmp/restly-home RESTLY_UPDATE_FEED=http://127.0.0.1:<port>/latest`. Set the mode to download, wait for the banner, press "Restart to update", and confirm that `/tmp/restly-e2e/Restly.app` reports 0.3.4 and is running.
