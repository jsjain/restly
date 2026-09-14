// Run with: node frontend/checks/jsonc.check.ts
import assert from "node:assert/strict";
import { parseJsonc } from "../src/jsonc.ts";

assert.deepEqual(
  parseJsonc(`// theme\n{"a": "x // not a comment", /* note */ "b": [1, 2,], "c": "y,}",}`),
  { a: "x // not a comment", b: [1, 2], c: "y,}" }
);
assert.deepEqual(parseJsonc(`{"q": "say \\"hi\\" // still text"}`), { q: 'say "hi" // still text' });
assert.deepEqual(parseJsonc(`[\n  // { "key": "cmd+j" }\n]`), []);
assert.throws(() => parseJsonc("{"));
console.log("jsonc ok");
