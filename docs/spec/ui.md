# App shell and UI system

The main layout, window chrome, in-app controls, and the UI system. Part of the [Restly spec](README.md).

## D7 UI

Sidebar tree, tabs, request editor (params, headers, body, auth, scripts), response pane (body, headers, cookies, tests, console), environment picker. Cmd/Ctrl+Enter sends, Cmd/Ctrl+S saves. While a request is in flight the Send button becomes Cancel, which cancels that send's context: running scripts stop and the HTTP exchange closes, the response pane shows "Request cancelled", and the send is not added to history (2026-09-15). A status bar along the bottom shows the active collection, its save state, the proxy mode, and the cookie count (2026-10-04). Single window.

## D21 Window chrome

On macOS the native title bar is hidden with inset traffic lights, so the sidebar header and the tab bar form the only top row and act as the window drag region. Tabs show the request method, and the tab bar holds the environment picker, Cookies, and Settings. The tab strip has no scrollbar, which took height under the tabs when they overflowed. It scrolls with the wheel or trackpad and keeps the active tab in view. Since 2026-10-04 `titlebar_darwin.go` switches the window to the compact toolbar style, which centers the traffic lights 20pt from the top, so the top row is 40px on macOS (it was 48px, which the user found too tall). Tabs lead with the method tag for requests and a 13px icon for other kinds, and a status bar under the window shows the active collection, the save state, the proxy mode, and the cookie count.

## D26 No native controls

Dropdowns, confirmations, the quit prompt, checkboxes, and the cookie expiry picker are drawn by the webview so they follow the theme. File open and save pickers stay native, because the webview cannot browse the file system.

## D34 UI system (2026-10-04)

The user rejected the earlier look as childish and approved a redesign from HTML mockups in `docs/design/mockups/`, then asked that it be followed from now on. `docs/ui-guidelines.md` holds the rules: one accent color, muted method colors with DELETE and OPTIONS shown as DEL and OPT, a type scale derived from the UI font size (`--fs-tag` to `--fs-display`), control heights as variables so the Density setting (Settings > Appearance: Compact, Default, Comfortable, in localStorage) can change them, three radii, keycaps rendered by `components/Kbd.tsx` as one cap per key in the system font (the user found joined keycaps unreadable), designed empty, error, and in-flight states, and layouts that survive a custom monospace UI font (the user runs JetBrains Mono). `frontend/checks/ui-guidelines.check.ts` enforces radius and font-size tokens and `<Kbd>` use. Theme token values changed with it: new tint tokens (`primaryTint`, `successTint`, `warningTint`, `dangerTint`), new radius tokens, and the built-in method colors; editor colors (syntax, selection, line highlight) were kept.
