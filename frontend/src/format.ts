// Pure formatting helpers for the request Body editor. No imports (see
// frontend/checks/format.check.ts, which runs this file directly through Node's TS
// stripping and needs it dependency-free).

export interface FormatResult {
  ok: boolean;
  text: string; // formatted text when ok, otherwise the original text unchanged
  error?: string;
}

// Postman-style {{variable}} placeholders are common in bodies but aren't valid JSON
// outside of a string. Swap each one (only where it sits outside a string literal) for a
// unique placeholder string that *is* valid JSON, so JSON.parse/stringify can run, then
// restore the originals verbatim afterward.  is a Private Use Area code point: it
// won't collide with real content and JSON.stringify never escapes it.
const MARK = "";

function stringEnd(text: string, start: number): number {
  // start points at the opening quote; returns the index just past the closing quote.
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === '"') return i + 1;
    i++;
  }
  return i; // unterminated string; let JSON.parse report the error
}

function maskVariables(text: string): { masked: string; restore: Map<string, string> } {
  const restore = new Map<string, string>();
  let out = "";
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "{" && text[i + 1] === "{") {
      const close = text.indexOf("}}", i + 2);
      if (close !== -1) {
        const original = text.slice(i, close + 2);
        const placeholder = `${MARK}VAR${n++}${MARK}`;
        restore.set(placeholder, original);
        out += `"${placeholder}"`;
        i = close + 2;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return { masked: out, restore };
}

function unmaskVariables(text: string, restore: Map<string, string>): string {
  let out = text;
  for (const [placeholder, original] of restore) {
    out = out.split(`"${placeholder}"`).join(original);
  }
  return out;
}

function positionToLineCol(text: string, pos: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

// V8's JSON.parse error messages carry either "(line N column M)" (Node 20+) or
// "at position N" (older). Extract whichever is present so the toast can show a location.
function describeJsonError(err: unknown, text: string): string {
  const message = err instanceof Error ? err.message : String(err);
  const lineCol = /line (\d+) column (\d+)/.exec(message);
  if (lineCol) return `${message} (line ${lineCol[1]}, column ${lineCol[2]})`;
  const posMatch = /position (\d+)/.exec(message);
  if (posMatch) {
    const { line, column } = positionToLineCol(text, Number(posMatch[1]));
    return `${message} (line ${line}, column ${column})`;
  }
  return message;
}

export function formatJson(input: string, indent = 2): FormatResult {
  const { masked, restore } = maskVariables(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(masked);
  } catch (err) {
    return { ok: false, text: input, error: describeJsonError(err, masked) };
  }
  let out = JSON.stringify(parsed, null, indent);
  out = unmaskVariables(out, restore);
  if (input.endsWith("\n") && !out.endsWith("\n")) out += "\n";
  return { ok: true, text: out };
}

// Small indenter for XML/HTML-ish markup: re-indents tags one level per depth while leaving
// comments, CDATA sections, and text content untouched. Not a full parser (no DTD/PI
// handling beyond passing them through as opaque tokens) but safe because it never rewrites
// content, only the whitespace between tokens.
function tokenizeXml(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "<") {
      const next = text.indexOf("<", i);
      const end = next === -1 ? text.length : next;
      const chunk = text.slice(i, end);
      if (chunk.trim() !== "") tokens.push(chunk.trim());
      i = end;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i);
      const stop = end === -1 ? text.length : end + 3;
      tokens.push(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i);
      const stop = end === -1 ? text.length : end + 3;
      tokens.push(text.slice(i, stop));
      i = stop;
      continue;
    }
    // Ordinary tag: <tag ...>, </tag>, <tag ... />, <?xml ... ?>, <!DOCTYPE ...>
    const end = text.indexOf(">", i);
    const stop = end === -1 ? text.length : end + 1;
    tokens.push(text.slice(i, stop));
    i = stop;
  }
  return tokens;
}

function xmlIndentDelta(token: string): { before: number; after: number } {
  if (token.startsWith("<!--") || token.startsWith("<![CDATA[") || token.startsWith("<?") || token.startsWith("<!DOCTYPE")) {
    return { before: 0, after: 0 };
  }
  if (token.startsWith("</")) return { before: -1, after: 0 };
  if (token.endsWith("/>")) return { before: 0, after: 0 };
  if (token.startsWith("<")) return { before: 0, after: 1 };
  return { before: 0, after: 0 }; // plain text content
}

export function formatXml(input: string, indentSize = 2): FormatResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, text: input };
  const tokens = tokenizeXml(trimmed);
  const pad = " ".repeat(indentSize);
  let depth = 0;
  const lines: string[] = [];
  for (const token of tokens) {
    const { before, after } = xmlIndentDelta(token);
    depth = Math.max(0, depth + before);
    lines.push(pad.repeat(depth) + token);
    depth += after;
  }
  let out = lines.join("\n");
  if (input.endsWith("\n")) out += "\n";
  return { ok: true, text: out };
}

export type BodyFormatKind = "json" | "xml" | "graphql-variables";

// Which format action (if any) applies to the current body mode/language, mirroring
// BodyEditor's own mode switch.
export function detectFormatKind(mode: string, language: string | undefined): BodyFormatKind | null {
  if (mode === "graphql") return "graphql-variables";
  if (mode === "raw") {
    if (language === "json") return "json";
    if (language === "xml") return "xml";
  }
  return null;
}

export function formatBody(kind: BodyFormatKind, text: string): FormatResult {
  if (kind === "xml") return formatXml(text);
  return formatJson(text); // "json" and "graphql-variables" are both plain JSON
}
