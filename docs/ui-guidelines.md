# Restly UI guidelines

Every UI change follows these rules. The approved mockups in `docs/design/mockups/` show the target look; open `index.html` there for the overview. `frontend/checks/ui-guidelines.check.ts` and `frontend/checks/colors.check.ts` enforce the mechanical rules. The rest is checked by eye with the screenshot loop at the end of this file.

## 1. Principles

- P1 One accent. Blue (`--primary`, `--primary-button`) marks only the single primary action of a view, keyboard focus, and the active tab. Everything else is neutral.
- P2 Quiet by default. Row actions (delete, the "…" menu, close) appear on hover and on keyboard focus. Checkboxes, borders and secondary text are neutral grays, not colors.
- P3 Hierarchy comes from size, weight and spacing, not from color. Use the type scale below and nothing in between.
- P4 Every state is designed. Empty, loading or in flight, error, cancelled and saved each get a composed view: an icon, a one-line title, one sentence, and the next action. A bare sentence or an empty pane is a bug.
- P5 Keyboard first. Every action with a shortcut shows it next to the action with `<Kbd>`. Every control is reachable with Tab and visible on focus.
- P6 Layout survives any user font. Users can set a custom UI font, often a monospace one. Nothing may overflow, collide or truncate a primary label at 13 px JetBrains Mono.

## 2. Color

- Colors come only from theme tokens: `var(--token)` in CSS. No hex, `rgb()`, `hsl()` or named colors outside `theme/themes.ts` and `theme/vscode.ts` (`colors.check.ts`).
- For a translucent variant use `color-mix(in srgb, var(--token) N%, transparent)` or the tint tokens: `--primary-tint`, `--success-tint`, `--warning-tint`, `--danger-tint`.
- Status colors: 2xx `--success`, 3xx `--info`, 4xx `--warning`, 5xx and failures `--danger`. Always pair color with text or an icon. Color is never the only signal.
- Methods use `--method-get` … `--method-ws` through the shared method tag. DELETE displays as DEL and OPTIONS as OPT.
- Adding a color token means updating `theme/tokens.ts` (type and CSS variable), all three built-in themes in `theme/themes.ts`, the converter in `theme/vscode.ts`, and the contrast guard if it carries text. `theme-contrast.check.ts` must pass. Text is held at 4.5:1, focus at 3:1, and borders at 1.4:1.

## 3. Type

| Token | Size at default 13 px | Use |
|---|---|---|
| `--fs-micro` | 11 px | keycaps, tags, status bar, section labels in the sidebar |
| `--fs-small` | 12 px | help text, meta lines, table headers, captions |
| `--font-size-ui` | 13 px | body, controls, rows |
| `--fs-title` | 15 px | section titles, dialog titles |
| `--fs-display` | 20 px | page titles |
| `--font-size-mono` | 12.5 px | URLs, keys, values, code |

- Weights are 400 (body), 500 (labels, tabs, buttons) and 600 (titles, the active status). No 700.
- Numbers that change (status codes, times, sizes, counts) use tabular figures: the `.tnum` class or `font-variant-numeric: tabular-nums`.
- Monospace (`var(--font-mono)`) is for machine text only: URLs, header and param keys and values, variables, code, file names.
- Sentence case everywhere: titles, buttons, menu items, command names. Proper nouns keep their case (cURL, WebSocket, HTTP, URL, JSON, Postman).
- `font-size` in CSS uses only these variables, `inherit` or `em` (`ui-guidelines.check.ts`).

## 4. Space and size

- Spacing follows a 4/8 px rhythm: 4, 8, 12, 16, 24, 32, 48. Section spacing tiers are 16 inside a section, 24 to 32 between sections, and 48 or more above an empty state.
- Pane padding is 16 px (request, response and editor panes). Page padding is 28 px horizontally (collection, environment, runner and cookie pages). Settings rows have 14 px vertical padding with a hairline between rows.
- Heights come from variables, never literals, so the Density setting works: `--h-bar` (tab strip and sidebar header), `--h-control` (buttons, inputs), `--h-url` (URL bar, Send), `--h-row` (tree, menus), `--h-table-row`, and `--h-status`. On macOS the top bar is fixed at 40 px, because `titlebar_darwin.go` centers the traffic lights 20 pt from the top.
- Radii come from `--radius-xs` (3 px: keycaps, tags), `--radius-small` (5 px: controls, rows), `--radius` (7 px: panels, cards, menus) and `--radius-large` (10 px: dialogs, palette). Use inner radii tighter than outer ones. `0`, `50%` and `999px` are the only literals allowed (`ui-guidelines.check.ts`).

## 5. Components

Use the shared pieces. Do not rebuild them.

- Buttons:
  - The unclassed `button` is secondary. `.primary` marks the one main action of the view. `.ghost` is for toolbar and secondary actions. `.icon` is for icon-only buttons, which need an `aria-label` and a `title`.
  - `.danger` is for destructive text actions. `.primary.danger` is for destructive confirms.
  - Never put two `.primary` buttons in one view.
- Shortcut hints: `<Kbd command="id" />` with an id from `keybindings.default.json`, or `<Kbd keys="mod+enter" />` for a literal chord. It renders one cap per key in the system font. Never hand-write `<kbd className="kbd">` (`ui-guidelines.check.ts`).
- Tags: `.tag` with `.ok`, `.err`, `.warn` or `.info`, for status codes, "active", "custom" and type labels. Square with `--radius-xs`, never pill-shaped.
- Sub-tab strips: `.subtabs` with `.subtab-count` for counts and `.subtab-dot` for "has content". Segmented choices use `.segmented`.
- Key-value tables: `KvTable`. Hairline grid, neutral checkbox, delete on hover or focus, a trailing ghost row instead of an "Add" button, and an optional Description column. Page tables (`.pg-table`) follow the same look.
- Settings-style forms: the `.srow` row has the label and help text on the left (`.lbl`) and the controls right-aligned (`.ctl`), with a hairline between rows. A dependent field, such as a custom font family, goes on its own line under its control, never squeezed in beside it.
- Pages: `.page-head` holds the title (`--fs-display` 600, click to rename where it applies), a meta line in `--fs-small` text-subtlest that omits zero counts, and the actions on the right with at most one `.primary`. Sub-tabs go under the header.
- Empty states:
  - A 40 px rounded `--surface-hover` square holding the icon, a `--fs-title` 600 title, one `--fs-small` text-subtle sentence, and the next action.
  - In the sidebar or a small pane, use a compact version: icon, title, sentence and buttons.
- Menus: the shared menu look uses `--surface-overlay`, `--shadow-overlay`, `--radius` and `--h-row` items. Every item has an icon, and `.menu-sep` separates groups. Danger items come last, in `--danger`. Menus close on Escape, on an outside click, on window blur, and when a dialog opens.
- Dialogs and toasts use `--radius-large` for dialogs and `--radius` for toasts. Error toasts carry an alert icon and a dismiss button. Prefer inline errors next to the field or pane that failed over toasts.
- Icons come from `lucide-react` only, at 13 px in rows and tags, 15 px in toolbars and 16 px in tiles, with `strokeWidth` 1.75. Decorative icons get `aria-hidden="true"`.

## 6. Copy

- Use plain, specific sentences. Write errors as "Couldn't save Northwind API.postman_collection.json. Permission denied.", not "Oops" or "Something went wrong".
- No exclamation marks, no marketing words, no em dashes.
- Help text says what happens, for example "Runs before the request is sent."

## 7. Accessibility

- Every control has a visible focus state. Text inputs use the `--border-focus` border plus a 1 px ring. Other controls use an outline on `:focus-visible`.
- Icon-only buttons have an `aria-label`. Toggles expose `aria-pressed` or are real checkboxes. Live status uses `role="status"` and errors use `role="alert"`.
- Keep the existing keyboard models: the roving tab stop in the tree, arrow keys in menus and the palette, and Escape to close.

## 8. Before you finish a UI change

1. Run the gates: `cd frontend && npx tsc --noEmit -p .`, then `for c in frontend/checks/*.check.ts; do node "$c"; done` from the repo root, and `npm run build`.
2. Look at it. Run the app against a throwaway workspace and never against your real `~/Restly`:
   - Start it with `HOME=/tmp/restly-home wails dev -browser=false`. Set `GOPATH`, `GOCACHE` and `GOMODCACHE` explicitly to keep the Go caches.
   - Screenshot `http://localhost:34115` with `docs/design/tools/cdp-shot.mjs`. Its header comment describes the steps format.
   - Check dark and light (localStorage `restly.theme`), a monospace UI font (localStorage `restly.fonts` = `{"ui":"JetBrains Mono","mono":"JetBrains Mono","uiSize":13,"monoSize":14}`), compact density, and every state of the view: empty, filled, error and in flight.
3. Compare with the matching screen in `docs/design/mockups/`. If the change adds a new screen, add it to the mockups first.
