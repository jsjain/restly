# Updates

Checking for, downloading, and installing new versions. Part of the [Restly spec](README.md).

## D36 Updates (2026-11-23)

The user asked for Restly to find, download, and install new releases itself, chosen by the user in Settings, notifying by default.

**Setting.** Settings > General > Updates has four modes, stored in `settings.json` as `update.mode`: `off`, `notify` (the default), `download` (download, then ask to restart), and `auto` (download, then install when Restly quits). Off exists for people who work offline or do not want the app to contact GitHub.

**Checking.** Unless the mode is off, Restly checks 10 seconds after launch and then every 24 hours. Settings > About has a "Check for updates" button that checks in any mode and shows the result. The source is the GitHub Releases API (`/repos/jsjain/restly/releases/latest`), unauthenticated, so drafts and pre-releases are never offered. A release is newer when its `vMAJOR.MINOR.PATCH` tag is higher than `info.productVersion` (D31). The `RESTLY_UPDATE_FEED` environment variable replaces the API URL, for testing against a local server only.

**Notice.** A slim banner under the tab bar (above it would push the macOS tab bar off the window buttons) says which version is available, with "What's new" (opens the release page), "Update" (downloads it), and a dismiss button. Dismissing stores that version in `update.skipped`, so it is not offered again, while a later version is. Once a download is ready, the banner offers "Restart to update", which quits through the usual unsaved-changes prompt (D17), installs, and relaunches. In auto mode the download happens without the banner's first step, and the install runs on the next quit without relaunching. Ceiling: when the user cancels the unsaved-changes prompt after "Restart to update", the next quit still installs and relaunches.

**Install kind.** Found from the running executable:

| Platform | How it was installed | Asset | Install |
|---|---|---|---|
| macOS | `.app` bundle | `Restly-<v>-macos-apple-silicon.dmg` or `-intel.dmg`, by CPU | Mount the DMG, copy its `Restly.app` next to the running bundle, swap the two by renaming, unmount, relaunch with `open -n` |
| Windows | `uninstall.exe` beside the exe (NSIS installer) | `-windows-amd64-setup.exe` | Run the installer with `/S /D=<folder Restly runs from>` after Restly exits, so it updates in place, then start Restly |
| Windows | Anything else (portable) | `-windows-amd64-portable.exe` | Rename the running exe to `.old`, put the new one in its place, relaunch |
| Linux | Under `/usr` (the .deb) | none | Notice only, "Update" opens the release page, because installing needs root |
| Linux | Anything else (tar.gz) | `-linux-amd64.tar.gz` | Same swap as the portable exe |

When Restly cannot write to its own folder, it treats the install as notice only. A leftover `.old` file is deleted at the next start. Downloads go to `updates/` in the data folder (D1) and are removed after installing or when no longer newer.

**Safety.** Asset URLs must be HTTPS on `github.com` (redirects to GitHub's download hosts are followed). Each download must match its line in the release's `SHA256SUMS.txt`. The builds are not signed (D32), so the checksum only catches a broken download: anyone who controls the GitHub account or its CI can ship an update that installs itself.

**Errors.** A failed check, download, or install is written to `restly.log` (D35) and shown in Settings > About. It never blocks the app, and a failed install leaves the running version in place.
