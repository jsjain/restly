# HTTP, network, and cookies

Sending requests, auth, proxy, TLS, User-Agent, and the cookie jar. Part of the [Restly spec](README.md).

## D3 HTTP

`net/http` with one shared client, a cookie jar, and `httptrace` timings. Body modes raw, urlencoded, formdata with files, binary file, GraphQL. Basic, bearer, and API key auth applied, with inheritance from folder and collection. The Auth tab of a request set to Inherit names the source and type, for example "Uses the auth from Users folder: Bearer token" (`frontend/src/authInherit.ts`, 2026-10-04). Other auth types are stored but not applied. Response viewer shows the first 10 MB.

## D13 Network settings

Proxy mode is none, environment variables, or a custom URL with a bypass list. Environment mode reads `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`, which apps opened from the Finder do not have, and the macOS system proxy is not read. TLS verification can be turned off, an extra CA bundle can be trusted, and PEM client certificates are chosen per host. Saving settings swaps the transports and closes idle connections. WebSocket dials use the same settings. A User-Agent setting (presets or custom) is sent when a request has no User-Agent header of its own, by sends, runs, WebSockets, and code snippets, and an empty value sends `Restly/0.1` (2026-10-04). Ceiling: no PKCS#12 files and no passphrase-protected keys.

## D14 Cookies

Restly's own cookie jar replaces `net/http/cookiejar`, which cannot list its cookies. The Cookies tab lists, adds, edits, and deletes them. The jar is saved after each edit and at quit, so a crash loses cookies set by responses since the last save.
