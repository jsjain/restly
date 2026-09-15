# Variables and scripts

This is a reference for `{{name}}` variables and the `restly` script API. It documents only
what Restly's code actually does. Where Restly's behavior differs from Postman's, that is
called out, usually in Limits at the end.

## 1. Variable scopes

Restly resolves 5 scopes when it sends a request (`internal/vars/vars.go`, `Scope.Get`):

| Scope | Where it is edited | Saved to disk | Lifetime |
| --- | --- | --- | --- |
| Local | script-only, not editable in the UI | never | one request |
| Data | script-only (`restly.iterationData`), not editable in the UI | never | never populated, see Limits |
| Environment | Environment tab, for the selected environment | `<name>.postman_environment.json` in `~/Restly` | until changed |
| Collection | Collection Settings > Variables | inside the collection's `.postman_collection.json` in `~/Restly` | until changed |
| Globals | "Globals" entry in the sidebar | `globals.postman_globals.json` in `~/Restly` | until changed |

Precedence, narrowest to widest, is Local, then Data, then Environment, then Collection, then
Globals: the first scope that has the name wins (`Scope.Get` in `internal/vars/vars.go`). This
is also the order `restly.variables.get` and `restly.variables.toObject` use.

The request editor (`frontend/src/variables.ts`) only has three of these to show, because Local
and Data exist only while a script is running: it resolves environment, then collection, then
globals, in that order, and colors a variable by whether it resolves.

Notes on persistence (`app.go`, `target`, `persistScope`):

- Local is reset to empty at the start of every request (`runner.Exec`), so a value set with
  `restly.variables.set` never survives past that one request's pre-request and test scripts.
- Data is never populated by the app itself. Nothing in Restly loads a CSV or JSON iteration
  data file today, and `restly.iterationData` has no `set`, so it is always empty in normal
  use. See Limits.
- A collection variable set by a script only saves back to the collection file if the request
  belongs to a saved collection. A standalone request (a tab with no collection) keeps the
  change in memory only, for that run.
- An environment variable set by a script only saves back if a specific environment was
  selected. Globals always save, because every request has access to them.
- `unset` on environment, collection, or globals removes the key from the saved file the next
  time that scope is persisted.
- A variable disabled in its file (`"disabled": true` for a collection variable, or
  `"enabled": false` for an environment or global value) is kept in the file but never
  resolves and never appears in `toObject()`.

## 2. Using `{{name}}`

`internal/httpx/resolve.go` calls `scope.Replace` on each of these before a request is sent:

- the URL, including `:name` path variables and query parameters
- header keys and values
- the raw body, and URL-encoded and form-data field keys and values (file paths in a file body
  or a file-type form field are also substituted, the file's bytes are not)
- the GraphQL query and variables text
- basic auth's username and password, bearer auth's token, and API key auth's key, value, and
  the query string it appends when placed "in query"
- the HTTP method itself

An unresolved name is left in the text exactly as written, including the braces. This applies
everywhere above.

Nested variables are supported: if `{{a}}` resolves to a string containing `{{b}}`, that is
resolved too, up to 10 passes (`maxDepth` in `internal/vars/vars.go`). A variable that expands
to itself, directly or through a cycle, stops after 10 passes with `{{...}}` still in the
result rather than looping forever.

Secret variables exist only for environment and globals values (`"type": "secret"` in the
file). Collection variables cannot be marked secret. `frontend/src/variables.ts` hardcodes
`secret: false` for them. A secret value is masked only in the environment/globals editor and
in the variable hover popup and autocomplete list. It is stored as plain text in the file and
sent as plain text on the wire, same as Postman.

### Dynamic variables

`internal/vars/helpers.go` defines exactly these:

| Name | Value |
| --- | --- |
| `{{$guid}}` | a random v4 UUID |
| `{{$randomUUID}}` | the same, a second name for `$guid` |
| `{{$timestamp}}` | the current Unix time in seconds |
| `{{$isoTimestamp}}` | current UTC time with milliseconds, for example `2026-09-15T12:34:56.789Z` |
| `{{$randomInt}}` | a random integer from 0 to 1000, inclusive |

No other Postman dynamic variable (`$randomFirstName`, `$randomEmail`, and so on) is
implemented. Using one of those names resolves to nothing and is left as literal `{{...}}`
text, the same as any other unknown name. In the editor, a dynamic variable shows the text
"generated when sent" instead of a value, because the actual value is only produced at send
time.

## 3. Script API

Scripts run in a goja JavaScript runtime with one object, `restly`, built by
`internal/script/pm.js`. `pm` is the exact same object (`var restly = pm;`), so a script
written for Postman that only uses `pm.*` runs unchanged. The two names are interchangeable in
every example below.

### Variable scopes

| Method | Scope | Notes |
| --- | --- | --- |
| `restly.environment.get/set/unset/has/clear/toObject/replaceIn` | Environment | |
| `restly.collectionVariables.get/set/unset/has/clear/toObject/replaceIn` | Collection | |
| `restly.globals.get/set/unset/has/clear/toObject/replaceIn` | Globals | |
| `restly.variables.get/has/toObject/replaceIn` | reads Local, Data, Environment, Collection, Globals, in that order | |
| `restly.variables.set` | writes Local only | |
| `restly.iterationData.get/has/toObject` | Data, read-only | no `set`, `unset`, `clear`, or `replaceIn` |

`replaceIn(text)` on any of these objects does the same thing regardless of which object it is
called on: it substitutes `{{name}}` against the full 5-scope precedence plus dynamic
variables, exactly like `restly.variables.replaceIn`. It is not scoped to just that one map.

Every scope is a `map[string]string` underneath, so `set(key, value)` converts a non-string
value. An object with its own `toString`, such as a CryptoJS hash, is stored as that string
(`"ba7816bf..."`). Arrays and plain objects are stored as `JSON.stringify(value)`. Numbers and
booleans become `String(value)`.

### Request (`restly.request`)

Available in both pre-request and test scripts. Because pre-request scripts run before
variables are substituted, `restly.request.url.raw` and similar fields still contain
`{{name}}` placeholders in both events. The request a test script sees is the same
unsubstituted one used to build the sent request, not what actually went over the wire.

| Member | What it does |
| --- | --- |
| `restly.request.method` | get/set the HTTP method |
| `restly.request.url` | `.raw` (get/set), `.toString()`, `.getHost()`, `.getPath()`, `.query` (a KV list, see below), `.toJSON()` |
| `restly.request.headers` | a KV list, case-insensitive key match |
| `restly.request.addHeader({key, value})` / `upsertHeader({key, value})` / `removeHeader(key)` | Postman's names for `headers.add`, `headers.upsert`, and `headers.remove`. `removeHeader` also takes a `{key}` object |
| `restly.request.body` | get/set the raw body object |
| `restly.request.auth` | get/set the raw auth object |
| `restly.request.toJSON()` | the whole request object |

A KV list (`restly.request.headers`, `restly.request.url.query`, and `restly.response.headers`
/ `.cookies`) has `get(name)`, `has(name)`, `add(item)`, `upsert(item)`, `remove(name)`,
`toObject()`, `each(fn)`, `all()`. Changes made in a pre-request script are written back to the
request before it is sent.

`restly.request.url.getHost()` and `.getPath()` read the URL's saved `host`/`path` arrays.
If a URL was only ever set as a raw string, those arrays are empty and both return `""`.

### Response (`restly.response`, test scripts only)

`restly.response` is `undefined` in pre-request scripts, since there is no response yet.

| Member | What it does |
| --- | --- |
| `.code`, `.status`, `.responseTime`, `.responseSize` | numbers/strings from the response |
| `.headers`, `.cookies` | KV lists |
| `.text()` | the raw body string |
| `.json()` | parses the body as JSON, throws with a message if it is not valid JSON, caches the result |
| `.to.have.status(code)` | asserts the numeric status code |
| `.to.have.status(reasonText)` | asserts `.status` (the reason phrase) equals the string |
| `.to.have.header(name[, value])` | asserts the header exists, and equals `value` if given |
| `.to.have.body(text)` | asserts the exact raw body text |
| `.to.have.jsonBody()` | asserts the body parses as JSON, ignores its arguments, checks no particular content |
| `.to.not.have.status/header/body(...)` | negations of the above |
| `.to.be.ok` | status is exactly 200 (a property, not a call) |
| `.to.be.success` | status is 200–299 |
| `.to.be.error` | status is 400–599 |
| `.to.be.clientError` | status is 400–499 |
| `.to.be.serverError` | status is 500–599 |
| `.to.be.json` | `Content-Type` header contains "json" |

Every `.to.be.*` member is a getter: reading the property runs the assertion, there is no
`()` call.

### Tests and assertions

- `restly.test(name, fn)` records one result named `name`. `fn` can be synchronous, return a
  promise, or take a `done` callback (`fn(done)`). The test is not recorded as finished until
  whichever of those completes.
- `restly.test.skip(...)` is a no-op. It does not run `fn` and does not record a test result at
  all, so Restly has no equivalent of Postman's "pending" test state.
- `restly.expect` is Chai's `expect`, loaded into the runtime the first time a script touches
  it (not loaded at all if a script never calls it). `restly.expect(x).to.equal(y)`,
  `.to.eql(y)`, and the rest of Chai's `expect` API are available.
- The legacy `tests` object (`tests["name"] = true;`) still works: every key becomes a test
  result with that boolean as pass/fail, evaluated after the rest of the script finishes.

### sendRequest

`restly.sendRequest(request, callback)` sends an HTTP request from a script, independent of
the request the script is attached to.

- `request` can be a URL string, or an object with `method`, `url`, `header` (array or plain
  object), and `body`.
- With a callback, it is called as `callback(err, response)`.
- Without a callback, `restly.sendRequest(...)` returns a Promise and can be awaited.
- `restly.sendRequest` does **not** substitute `{{name}}` in the URL, headers, or body, and
  does not apply the request's or collection's auth. Resolve any variables yourself first, for
  example with `restly.variables.replaceIn(...)`, and set any auth header by hand.
- The response object passed to the callback/Promise has the same shape as `restly.response`,
  including `.code`, `.text()`, `.json()`, `.headers`, and the `.to.*` assertions.

### Info and execution control

| Member | Value |
| --- | --- |
| `restly.info.eventName` | `"prerequest"` or `"test"` |
| `restly.info.iteration` | the runner's current iteration index (0 for a single send) |
| `restly.info.iterationCount` | total iterations (1 for a single send) |
| `restly.info.requestName` | the request's name |
| `restly.info.requestId` | always `""`. Restly does not populate a request ID here |
| `restly.execution.setNextRequest(name)` | in a runner, jump to the first request named `name` next. `null` stops the run after this request |
| `restly.execution.skipRequest()` | in a pre-request script, skip sending this request and its test scripts. In a test script, it does nothing |

### Console

`console.log/info/warn/error/debug(...)` collect into the request's console output, one line
per call, prefixed with the level (`"log: "`, `"warn: "`, and so on). Object arguments are
JSON-stringified. `Error` objects print their `.message`.

### Legacy Postman globals

Kept so old Postman scripts still work:

| Call | Equivalent |
| --- | --- |
| `postman.setEnvironmentVariable(k, v)` / `getEnvironmentVariable(k)` / `clearEnvironmentVariable(k)` | `restly.environment.set/get/unset` |
| `postman.setGlobalVariable(k, v)` / `getGlobalVariable(k)` / `clearGlobalVariable(k)` | `restly.globals.set/get/unset` |
| `postman.setNextRequest(name)` | `restly.execution.setNextRequest(name)` |
| `tests["name"] = true` | `restly.test("name", () => true)`, evaluated at the end of the script |
| `responseBody` | `restly.response.text()` (test scripts only) |
| `responseCode` | `{ code: restly.response.code, name: restly.response.status }` (test scripts only) |
| `responseHeaders` | `restly.response.headers.toObject()` (test scripts only) |
| `responseTime` | `restly.response.responseTime` (test scripts only) |

`atob(text)` and `btoa(text)` are also available as plain globals for base64 decode/encode.

### CryptoJS

`CryptoJS` is [crypto-js 4.2.0](https://github.com/brix/crypto-js), the same library Postman
provides, as a global and as `require("crypto-js")`. It loads the first time a script reads it,
so scripts that never use it pay nothing. Hashes (`SHA256`, `SHA1`, `MD5`, `SHA512`), HMACs,
AES with a passphrase, and the `enc.Hex`/`enc.Base64`/`enc.Utf8` encoders all work. Random
bytes come from the operating system's secure generator.

```js
// pre-request script from a Postman login request: hash the password, store the hex digest
var token = CryptoJS.SHA256(postman.getGlobalVariable("PASSWORD"));
postman.setGlobalVariable("PASS", token); // stores the hex string

// an HMAC signature header
const signature = CryptoJS.HmacSHA256(restly.request.body.raw, restly.environment.get("secret"))
  .toString(CryptoJS.enc.Base64);
restly.request.upsertHeader({ key: "X-Signature", value: signature });
```

## 4. When scripts run

Each request runs at most two script events: `prerequest` before the request is sent, and
`test` after the response comes back. Within each event, scripts run in this order
(`runner.Exec` in `internal/runner/runner.go`):

1. the collection's script for that event
2. each ancestor folder's script for that event, outermost first
3. the request's own script

If a script throws in the `prerequest` event, or calls `execution.skipRequest()`, the request
is not sent and no `test` scripts run for it. If a script throws in the `test` event, the
remaining scripts later in the chain (the next folder, or the request) do not run either. The
first throw stops that event's chain (`runScripts` in `internal/runner/runner.go`).

Each individual script gets its own 30-second timeout (`DefaultTimeout` in
`internal/script/constants.go`). A runner with a collection, two folders, and a request script
all defined gets up to 4 separate 30-second budgets for one event, not one shared budget.

Not available inside a script:

- `require()` of anything except `"chai"` and `"crypto-js"`. `require("lodash")` (or any other package) throws
  `require('lodash') is not available in Restly`.
- File access of any kind.
- Network access other than through `restly.sendRequest`.
- `for await` and async generators, the runtime is goja, not V8 (see Limits).

## 5. Examples

**Log in and save a token, use it as a bearer header**

```js
// test script on the login request
restly.collectionVariables.set("TOKEN", restly.response.json().access_token);
```

```http
Authorization: Bearer {{TOKEN}}
```

**Store the token pre-formatted, and use it directly**

```js
// test script, stores "Bearer <token>" as one value
restly.collectionVariables.set("TOKEN", `Bearer ${restly.response.json().access_token}`);
```

```http
Authorization: {{TOKEN}}
```

Only do one of these two for a given variable. Combining them sends `Bearer Bearer ...`.

**A status test and a JSON body test**

```js
pm.test("status is 200", function () {
  pm.response.to.have.status(200);
});

pm.test("body has id", function () {
  pm.expect(pm.response.json().id).to.equal(42);
});
```

**Chain a value from one request into the next**

Collection variables persist between requests in a run, so a later request's URL can read what
an earlier one saved:

```js
// test script on "Create user"
restly.collectionVariables.set("userId", restly.response.json().id);
```

```http
GET https://api.example.com/users/{{userId}}
```

**`sendRequest` from a pre-request script**

```js
// pre-request script, sendRequest does not substitute variables, so resolve first
const url = restly.variables.replaceIn("{{baseUrl}}/token");
const res = await restly.sendRequest(url);
restly.environment.set("token", res.json().access_token);
```

**`setNextRequest` in the runner**

```js
// test script, jump straight to "Step B", skipping whatever is next in the list
restly.execution.setNextRequest("Step B");
```

Call it with `null` to stop the run after this request instead of continuing.

**Reading runner iteration data**

```js
// test script
restly.environment.set("greeting", "hi " + restly.iterationData.get("username"));
```

This API works today, but nothing in Restly currently loads a CSV or JSON data file into it
(see Limits). There is no runner UI to attach one yet, so `iterationData` is empty in normal
use.

**`replaceIn` on a string**

```js
const url = restly.variables.replaceIn("{{baseUrl}}/users/{{userId}}");
```

`replaceIn` resolves `{{name}}` the same way a request URL or header would, against all 5
scopes plus dynamic variables, and leaves unknown names untouched.

## 6. Limits

- No iteration data file. `restly.iterationData` exists and is read-only, but Restly has no
  way to load a CSV or JSON file into the runner's Data scope yet, so it is always empty.
- `restly.info.requestId` is always an empty string.
- `restly.sendRequest` never substitutes `{{name}}` and never applies auth. Resolve variables
  and set auth headers explicitly first.
- `restly.execution.setNextRequest` matches by request name and does not detect loops. A
  script that always jumps back to an earlier request runs forever.
- `restly.response.to.have.jsonBody()` only checks that the body parses as JSON. It does not
  check any particular shape.
- `restly.test.skip(...)` records nothing, not even a skipped test.
- Scripts run in goja, not V8: no `for await`, no async generators, and `require()` only
  provides `chai` and `crypto-js`.
- `restly.request.addHeader` needs Postman's `{key, value}` shape. A plain map such as
  `addHeader({ session: "..." })` adds a header with no name, which is never sent. Postman
  behaves the same way.
- No file access and no network access other than through `restly.sendRequest`.
- Collection variables cannot be marked secret, only environment and globals values can.
- A standalone request (no collection) or a send with no environment selected loses any
  `collectionVariables`/`environment` changes a script made, once the request finishes. Only
  Globals is guaranteed to persist.
