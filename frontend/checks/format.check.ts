// Run with: node frontend/checks/format.check.ts
import assert from "node:assert/strict";
import { formatJson, formatXml, detectFormatKind } from "../src/format.ts";

// Plain JSON, reindented.
{
  const r = formatJson('{"a":1,"b":[1,2,3]}');
  assert.equal(r.ok, true);
  assert.equal(r.text, '{\n  "a": 1,\n  "b": [\n    1,\n    2,\n    3\n  ]\n}');
}

// Unquoted variables in object values and arrays, restored exactly.
{
  const r = formatJson('{"id": {{userId}}, "name": "{{name}}", "list": [{{a}}, 2]}');
  assert.equal(r.ok, true);
  assert.equal(
    r.text,
    '{\n  "id": {{userId}},\n  "name": "{{name}}",\n  "list": [\n    {{a}},\n    2\n  ]\n}'
  );
}

// Variables inside strings are left untouched (not treated as bare tokens).
{
  const r = formatJson('{"greeting": "hi {{name}}, id={{userId}}"}');
  assert.equal(r.ok, true);
  assert.equal(r.text, '{\n  "greeting": "hi {{name}}, id={{userId}}"\n}');
}

// Nested objects with mixed variable and literal values.
{
  const r = formatJson('{"user":{"id":{{userId}},"meta":{"active":true,"tag":"{{tag}}"}}}');
  assert.equal(r.ok, true);
  assert.equal(
    r.text,
    '{\n  "user": {\n    "id": {{userId}},\n    "meta": {\n      "active": true,\n      "tag": "{{tag}}"\n    }\n  }\n}'
  );
}

// Invalid JSON is reported, not rewritten.
{
  const r = formatJson('{"a": 1,}');
  assert.equal(r.ok, false);
  assert.equal(r.text, '{"a": 1,}');
  assert.ok(r.error && r.error.length > 0, "expected an error message");
}

// Trailing newline is preserved when present, not invented when absent.
{
  const withNl = formatJson('{"a":1}\n');
  assert.ok(withNl.text.endsWith("\n"));
  const withoutNl = formatJson('{"a":1}');
  assert.ok(!withoutNl.text.endsWith("\n"));
}

// XML: reindents while preserving comments, CDATA, and text content verbatim.
{
  const r = formatXml("<root><!-- c --><a>text</a><b><![CDATA[<raw> & stuff]]></b></root>");
  assert.equal(r.ok, true);
  assert.equal(
    r.text,
    [
      "<root>",
      "  <!-- c -->",
      "  <a>",
      "    text",
      "  </a>",
      "  <b>",
      "    <![CDATA[<raw> & stuff]]>",
      "  </b>",
      "</root>",
    ].join("\n")
  );
}

// Self-closing tags don't open a nesting level.
{
  const r = formatXml("<root><a/><b>x</b></root>");
  assert.equal(r.text, ["<root>", "  <a/>", "  <b>", "    x", "  </b>", "</root>"].join("\n"));
}

// detectFormatKind mirrors BodyEditor's mode switch.
{
  assert.equal(detectFormatKind("raw", "json"), "json");
  assert.equal(detectFormatKind("raw", "xml"), "xml");
  assert.equal(detectFormatKind("raw", "text"), null);
  assert.equal(detectFormatKind("graphql", undefined), "graphql-variables");
  assert.equal(detectFormatKind("urlencoded", undefined), null);
}

console.log("format ok");
