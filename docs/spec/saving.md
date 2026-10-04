# Unsaved changes and auto-save

Dirty tracking, the quit prompt, and auto-save. Part of the [Restly spec](README.md).

## D17 Unsaved changes

The webview reports dirty collections, environments, and edited drafts to Go. Quitting through the window close button or Cmd+Q is cancelled in Go, which emits `app:quit-requested`; the webview asks in its own dialog and calls `QuitApp` to quit for real. Closing an edited draft tab asks Save, Don't Save, or Cancel. Auto-save (Settings, General: on by default, every 5 s, 1 to 600 s) saves every dirty collection and environment file, globals included, without a toast, and toasts a failure once per file until that file saves again. Drafts that were never saved have no file and stay manual. An edit made while a save is in flight keeps its file dirty, because the save call serializes its arguments when it starts. The setting lives in localStorage with the theme and fonts, not in Go settings, because saving Go settings rebuilds the HTTP transports (2026-09-15).
