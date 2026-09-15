// Run with: node frontend/checks/script-completions.check.ts
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { scriptCompletionSource } from "../src/editor/scriptCompletions.ts";

function labelsFor(doc: string): string[] {
  const state = EditorState.create({ doc });
  const context = new CompletionContext(state, doc.length, false);
  const result = scriptCompletionSource(context);
  return result ? result.options.map((o) => o.label) : [];
}

assert.ok(labelsFor("restly.resp").includes("response"));
assert.ok(labelsFor("pm.environment.").includes("set"));
assert.ok(labelsFor("pm.environment.").includes("get"));
assert.ok(labelsFor("restly.response.to.have.").includes("status"));
assert.deepEqual(labelsFor("restly.nothing."), []);
assert.ok(labelsFor("re").includes("restly"));

console.log("script completions ok");
