// Postman stores a description as either a plain string or `{content, type}`, on collections,
// items, query params, headers and variables. Read whichever shape is present and write back the
// same shape, defaulting to a string.
export type Description = string | { content?: string; [key: string]: unknown };

export function readDescription(d: unknown): string {
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "content" in d) {
    const c = (d as { content?: unknown }).content;
    return typeof c === "string" ? c : "";
  }
  return "";
}

export function writeDescription(target: Record<string, unknown>, text: string): void {
  const d = target.description;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    target.description = { ...(d as Record<string, unknown>), content: text };
  } else {
    target.description = text;
  }
}

// Key-value rows drop the field when it is cleared, as Postman does.
export function setRowDescription(row: Record<string, unknown>, text: string): void {
  if (text) writeDescription(row, text);
  else delete row.description;
}
