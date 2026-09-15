import type { EditorState } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";

// Counting stops here, so a one-letter query on a multi-megabyte response stays cheap to type.
export const MATCH_LIMIT = 1000;

// matchLabel is the "3 of 12" text beside the find field. "?" means the selection is not on a match.
export function matchLabel(state: EditorState, query: SearchQuery): string {
  if (!query.search) return "";
  if (!query.valid) return "No results";
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++;
    if (next.value.from === from && next.value.to === to) current = total;
    if (total === MATCH_LIMIT) return `${current || "?"} of ${MATCH_LIMIT}+`;
  }
  return total === 0 ? "No results" : `${current || "?"} of ${total}`;
}

// matchFrom is the first match at or after pos, wrapping to the top, so typing in the find field
// moves to the nearest match the way VS Code does.
export function matchFrom(state: EditorState, query: SearchQuery, pos: number): { from: number; to: number } | null {
  if (!query.search || !query.valid) return null;
  const ahead = query.getCursor(state, pos).next();
  if (!ahead.done) return ahead.value;
  const wrapped = query.getCursor(state).next();
  return wrapped.done ? null : wrapped.value;
}
