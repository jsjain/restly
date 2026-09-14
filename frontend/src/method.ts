const KNOWN = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// CSS class suffix for method colors; anything outside the five known methods is grey.
export function methodClass(method: string): string {
  return KNOWN.has(method) ? method : "OTHER";
}
