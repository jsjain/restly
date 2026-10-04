# History

The send history. Part of the [Restly spec](README.md).

## D15 History

Each manual send and WebSocket connect appends the resolved URL, status, time, size, error, and the request as edited to `history.jsonl`. Settings > General sets how many entries are kept: 50 by default (it was a fixed 500), 1 to 10000, and lowering it deletes the oldest entries from memory and disk right away. Changing it does not rebuild the HTTP transports, unlike saving network settings (2026-10-04). Opening an entry creates a standalone request. Response bodies are not kept. Resolved URLs can contain tokens in plain text.
