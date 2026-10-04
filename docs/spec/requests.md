# Request editing

Standalone requests, cURL import, request names, key-value editors, and body formatting. Part of the [Restly spec](README.md).

## D10 Standalone requests

A request tab can exist without a collection. It sends with `file` empty and sees only the selected environment and globals, and its own scripts run. Save opens a dialog that puts it into a chosen collection and folder, after which the tab becomes a normal collection request. Ceiling: drafts live in memory only, so they are lost on close or restart without a prompt.

## D11 cURL import

`internal/curl` parses a pasted command in Go into a Postman item, round-trip tested against the cURL snippet generator. Reached from a sidebar "Import cURL" dialog, which opens a standalone request, or by pasting a cURL command into any URL field, which replaces that request's method, URL, headers, body, and auth.

## D27 Request names

A new standalone request has no name. Its tab, the close prompt, and the save dialog call it after its URL (host and path, without scheme, query, or trailing slash) until the user names it, falling back to "Untitled Request" when the URL is empty.

## D29 Key-value editors

Params, headers, form fields, and environment and collection variables add rows through a trailing ghost row (typing into its Key or Value adds a row), and each row shows its delete button on hover or keyboard focus (the 2026-10-04 redesign, replacing the Add button and the always-visible red delete button). Params, headers, and variables have a Description column and a Bulk edit mode with one "key: value" line per row and "//" for disabled rows; bulk edit is unavailable while an environment has secret variables, so secrets are never shown unmasked. Rows stay until deleted, so the sender skips query, URL-encoded, and form-data rows without a key, matching the URL bar, which leaves them out too. Cookie expiry uses an in-app date and time picker. Key-value tables draw a grid like Postman's: an outer frame, a rule under each row, and rules between columns, with none between the checkbox and the key or before the delete button (2026-09-15).

## D30 Body formatting

`format.ts` formats raw JSON with 2-space indentation, XML by re-indenting between tags, and GraphQL variables as JSON. `{{variables}}` outside JSON strings are swapped for placeholders before parsing and restored after, so `{"id": {{userId}}}` formats. Invalid input is left as typed and the error is shown. The raw language picker and Format sit in the body mode row, so the editor starts one row higher. Icons come from `lucide-react`.
