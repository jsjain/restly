// Run with: node frontend/checks/find.check.ts
// The find widget's match count and the match typing moves to.
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { MATCH_LIMIT, matchFrom, matchLabel } from "../src/editor/findMatches.ts";

const doc = '{\n  "host": "localhost",\n  "url": "http://localhost:18080"\n}';
const at = (anchor: number, head = anchor) => EditorState.create({ doc, selection: { anchor, head } });
const query = (search: string, options: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {}) => new SearchQuery({ search, ...options });

const first = doc.indexOf("localhost");
const second = doc.indexOf("localhost", first + 1);
const range = (match: { from: number; to: number } | null) => match && { from: match.from, to: match.to };

assert.equal(matchLabel(at(0), query("")), "");
assert.equal(matchLabel(at(0), query("nothing")), "No results");
assert.equal(matchLabel(at(0), query("localhost")), "? of 2");
assert.equal(matchLabel(at(second, second + 9), query("localhost")), "2 of 2");
assert.equal(matchLabel(at(0), query("LOCALHOST", { caseSensitive: true })), "No results");
assert.equal(matchLabel(at(0), query("local\\w+", { regexp: true })), "? of 2");
assert.equal(matchLabel(at(0), query("(", { regexp: true })), "No results");
assert.equal(matchLabel(at(0), query("host", { wholeWord: true })), "? of 1");
assert.equal(matchLabel(EditorState.create({ doc: "a".repeat(MATCH_LIMIT + 5) }), query("a")), `? of ${MATCH_LIMIT}+`);

assert.deepEqual(range(matchFrom(at(0), query("localhost"), 0)), { from: first, to: first + 9 });
assert.deepEqual(range(matchFrom(at(0), query("localhost"), first + 1)), { from: second, to: second + 9 });
// Past the last match, typing wraps to the first.
assert.deepEqual(range(matchFrom(at(0), query("localhost"), second + 1)), { from: first, to: first + 9 });
assert.equal(matchFrom(at(0), query("nothing"), 0), null);

console.log("find ok");
