# Code snippets

Code generation and the code panel. Part of the [Restly spec](README.md).

## D6 Code snippets

cURL, JS fetch, Python requests, Go net/http, generated with string builders from the resolved request. Tests run the cURL, Go, and fetch output against a local server.

## D28 Code panel

Generated code opens in a resizable panel to the right of the request and response, so both stay visible. It regenerates in Go about 200 ms after the request or the selected environment changes, drops out-of-order results, and highlights cURL as shell, fetch as JavaScript, and Python and Go through `@codemirror/legacy-modes`. A generation error, such as an unresolved variable, shows inside the panel instead of a toast (2026-10-04).
