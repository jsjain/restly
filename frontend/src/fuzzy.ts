// Fuzzy subsequence matching for the command palette and quick-open lists. Case-insensitive,
// scores consecutive runs, word starts and prefixes higher, and penalizes gaps between matched
// characters, in the spirit of VS Code's / fzf's matchers.
import { createElement, Fragment } from "react";
import type { ReactNode } from "react";

export interface FuzzyScore {
  score: number;
  indices: number[]; // matched character positions in `text`, ascending
}

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  const cur = text[i];
  if (/[\s/\-_.]/.test(prev)) return true;
  return /[a-z0-9]/.test(prev) && /[A-Z]/.test(cur); // camelCase boundary
}

// ponytail: greedy earliest-character match, not the globally optimal subsequence (that needs
// O(n*m) DP). Good enough for palette-sized strings; revisit only if bad rankings are reported.
export function fuzzyScore(query: string, text: string): FuzzyScore | null {
  if (query === "") return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  let consecutiveRun = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    let bonus = 1;
    if (indices.length > 0 && indices[indices.length - 1] === ti - 1) {
      consecutiveRun++;
      bonus += consecutiveRun * 5;
    } else {
      consecutiveRun = 0;
    }
    if (isWordStart(text, ti)) bonus += 8;
    if (indices.length === 0 && ti === 0) bonus += 10; // whole-string prefix
    score += bonus;
    indices.push(ti);
    qi++;
  }
  if (qi < q.length) return null; // query has characters text doesn't contain in order
  const span = indices[indices.length - 1] - indices[0] + 1;
  score -= span - q.length; // gap penalty: 0 when every matched char is consecutive
  return { score, indices };
}

export interface FuzzyMatch<T> {
  item: T;
  score: number;
  indices: number[]; // positions in the best-scoring field
  field: number; // index into the getTexts array (0 for a single getText)
}

// Scores every item against one or more text fields (e.g. name + url + collection) and keeps
// only the best-scoring field per item, so the caller can highlight just that field.
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: ((item: T) => string) | Array<(item: T) => string>
): FuzzyMatch<T>[] {
  const accessors = Array.isArray(getText) ? getText : [getText];
  const results: FuzzyMatch<T>[] = [];
  for (const item of items) {
    let best: { score: number; indices: number[]; field: number } | null = null;
    for (let field = 0; field < accessors.length; field++) {
      const m = fuzzyScore(query, accessors[field](item));
      if (m && (!best || m.score > best.score)) best = { score: m.score, indices: m.indices, field };
    }
    if (best) results.push({ item, ...best });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

// Renders `text` with matched positions wrapped in <mark>. Plain .ts file, so createElement
// instead of JSX.
export function highlight(text: string, indices: number[]): ReactNode[] {
  if (indices.length === 0) return [text];
  const marked = new Set(indices);
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const inMark = marked.has(i);
    let j = i + 1;
    while (j < text.length && marked.has(j) === inMark) j++;
    const chunk = text.slice(i, j);
    nodes.push(inMark ? createElement("mark", { key: key++ }, chunk) : createElement(Fragment, { key: key++ }, chunk));
    i = j;
  }
  return nodes;
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`fuzzy selfCheck failed: ${message}`);
}

// Minimal runnable check for the scoring heuristics; not a test framework, just assertions.
export function selfCheck(): void {
  assert(fuzzyScore("", "anything")?.score === 0, "empty query matches with score 0");
  assert(fuzzyScore("", "anything")?.indices.length === 0, "empty query has no indices");
  assert(fuzzyScore("xyz", "abc") === null, "non-subsequence returns null");

  // From the spec: "gdd" only matches when every letter is present in order.
  const good = fuzzyScore("gdd", "Get developer Details");
  const bad = fuzzyScore("gdd", "Update developer Details");
  assert(good !== null, "gdd matches Get developer Details");
  assert(bad === null, "gdd does not match Update developer Details (no g)");

  // Prefix + word-start bonus: same query, same character count skipped, different position.
  const prefix = fuzzyScore("get", "Get Users")!;
  const midword = fuzzyScore("get", "Widget Users")!;
  assert(prefix.score > midword.score, `prefix match (${prefix.score}) should beat mid-word match (${midword.score})`);

  // Consecutive run beats an equally-long gapped match.
  const consecutive = fuzzyScore("abc", "abc device")!;
  const gapped = fuzzyScore("abc", "a big cat")!;
  assert(consecutive.score > gapped.score, `consecutive (${consecutive.score}) should beat gapped (${gapped.score})`);

  // fuzzyFilter sorts best-first and reports which field matched.
  const items = [{ name: "Widget Users", url: "" }, { name: "Users", url: "" }, { name: "z", url: "" }];
  const filtered = fuzzyFilter(items, "user", [(i) => i.name, (i) => i.url]);
  assert(filtered.length === 2, "fuzzyFilter drops non-matches");
  assert(filtered[0].item.name === "Users", "prefix-ish match ranked first");

  console.log("fuzzy.selfCheck: all assertions passed");
}
