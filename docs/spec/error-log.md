# Error log

restly.log and error reports from the webview. Part of the [Restly spec](README.md).

## D35 Error log (2026-10-04)

Go writes startup, failures, and error reports from the webview to `restly.log` in the per-machine data folder (D12), so a user can attach it to a bug report. The webview reports uncaught errors, unhandled rejections, and React render errors with the version, the active tab's kind, and the stacks, but never URLs, headers, bodies, or variables, which can hold secrets. Reports are de-duplicated and capped at 20 per session and 64 KB each. A file over 1 MB is moved to `restly.log.1` at the next start. A render error replaces the window with an error screen that offers Try again, Copy details, Show log file, and Reload window. Settings > About also has Show log file.
