// Run with: node frontend/checks/headers.check.ts
import assert from "node:assert/strict";
import { HEADER_NAMES, headerValueOptions, rankSuggestions } from "../src/headers.ts";

// Prefix matches come before substring matches, each in list order.
assert.deepEqual(rankSuggestions(["X-Content-Type", "Content-Type", "Content-Length", "Accept"], "cont"), [
  "Content-Type",
  "Content-Length",
  "X-Content-Type",
]);

// Case-insensitive, and canonical casing is returned.
assert.deepEqual(rankSuggestions(HEADER_NAMES, "CONTENT-T"), ["Content-Type"]);

// An exact match offers nothing, so "origin" never becomes a longer name.
assert.deepEqual(rankSuggestions(["Origin", "Access-Control-Allow-Origin"], "origin"), []);

// Empty or blank query offers nothing.
assert.deepEqual(rankSuggestions(HEADER_NAMES, ""), []);
assert.deepEqual(rankSuggestions(HEADER_NAMES, "  "), []);

// Limit caps the result.
assert.equal(rankSuggestions(HEADER_NAMES, "a", 3).length, 3);
assert.equal(rankSuggestions(HEADER_NAMES, "x-").length, 8);

// Value lookup ignores case, unknown keys have none.
assert.deepEqual(headerValueOptions("CONTENT-type")[0], "application/json");
assert.deepEqual(headerValueOptions("X-Unknown"), []);

console.log("headers.check ok");
