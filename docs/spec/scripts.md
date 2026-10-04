# Scripts

The script runtime and the pm and restly API. Part of the [Restly spec](README.md).

## D4 Scripts

Order is collection, folder, request for both pre-request and test. Fresh goja runtime per script, Chai compiled once, 30 s timeout. The script object is `restly`, and `pm` is the same object so Postman scripts run unchanged (2026-09-15). The script editor completes its members from a static tree in frontend/src/editor/scriptCompletions.ts that mirrors pm.js. It covers environment, collectionVariables, globals, variables, iterationData, request, response (json, text, to.have.status), test, expect, sendRequest (callback and Promise), info, execution.setNextRequest, execution.skipRequest, and console.log. No file or network access except pm.sendRequest. CryptoJS 4.2.0 is bundled as a lazy global and via `require("crypto-js")` (2026-09-15, for imported Postman login scripts that hash with `CryptoJS.SHA256`); `pm.request.addHeader`, `removeHeader`, and `upsertHeader` are supported as aliases of `headers.add`/`remove`/`upsert`. Ceiling: no `for await`, no `require` of lodash or moment.
