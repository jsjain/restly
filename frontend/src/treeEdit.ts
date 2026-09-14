// Tree edit helpers for the sidebar: duplicate, drag-and-drop geometry, and search matching.
// Pure functions only; callers do the store mutation and notifyChange.
import { isFolder, type Collection, type Item } from "./types";
import { urlRaw } from "./urlutil";
import { fuzzyScore } from "./fuzzy";
import { parentList } from "./tree";

// The array that directly contains the item at a path. tree.ts's parentList now handles top-level paths.
export const siblingList = parentList;

// Deep-clones an item, strips every `id` member anywhere in it (Postman item/response/
// event/variable ids, recursively), and names the clone "<name> Copy".
export function duplicateItem(item: Item): Item {
  const clone = structuredClone(item);
  stripIds(clone);
  clone.name = `${item.name} Copy`;
  return clone;
}

// Walks every object/array reachable from `value` and deletes any "id" key. KV-shaped
// objects key their data as `key`/`value`, never `id`, so user data is untouched.
function stripIds(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) stripIds(v);
    return;
  }
  if (value !== null && typeof value === "object") {
    delete (value as Record<string, unknown>).id;
    for (const v of Object.values(value as Record<string, unknown>)) stripIds(v);
  }
}

// True when `descendant` is `ancestor` itself or lives anywhere in its subtree. Used to
// forbid dropping a folder into itself/its own descendants, and to no-op a self-drop.
export function isDescendant(ancestor: Item, descendant: Item): boolean {
  if (ancestor === descendant) return true;
  return (ancestor.item ?? []).some((child) => isDescendant(child, descendant));
}

export type DropPos = "before" | "after" | "into";

// Vertical position of a drag-over point within a row's rect. Requests only get a
// before/after split; folders (and anything else `canInto`) get a 25/50/25 split, since
// dropping in the middle means "append inside".
export function dropPosition(clientY: number, rect: { top: number; height: number }, canInto: boolean): DropPos {
  const ratio = (clientY - rect.top) / rect.height;
  if (!canInto) return ratio < 0.5 ? "before" : "after";
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "into";
}

// matchesQuery is a fuzzy (subsequence) match that only counts when the matched characters sit
// close together. A plain subsequence of a short query would match almost any long URL.
export function matchesQuery(query: string, text: string): boolean {
  const match = fuzzyScore(query, text);
  if (!match) return false;
  if (match.indices.length === 0) return true;
  const span = match.indices[match.indices.length - 1] - match.indices[0] + 1;
  return span <= Math.max(query.length * 3, query.length + 6);
}

function itemMatches(item: Item, query: string): boolean {
  if (isFolder(item)) return false;
  return matchesQuery(query, item.name) || matchesQuery(query, urlRaw(item.request?.url));
}

// True if `item` itself matches the search query, or any item in its subtree does.
export function subtreeMatches(item: Item, query: string): boolean {
  if (itemMatches(item, query)) return true;
  return (item.item ?? []).some((child) => subtreeMatches(child, query));
}

// True if any item in `list` matches (used to decide whether to show a collection at all).
export function listMatches(list: Item[] | undefined, query: string): boolean {
  return (list ?? []).some((item) => subtreeMatches(item, query));
}

// No test runner in this project (see package.json); this dev-time assert block is the
// runnable check for the branchy bits above. Stripped from production builds.
if (import.meta.env.DEV) {
  const leaf: Item = { name: "Login", request: { method: "GET", url: { raw: "https://api/x/login" } } };
  const folder: Item = { name: "Auth", item: [leaf] };
  const root: Item = { name: "root", item: [folder] };
  console.assert(isDescendant(root, folder) && isDescendant(root, leaf) && isDescendant(leaf, leaf), "isDescendant true cases");
  console.assert(!isDescendant(folder, root) && !isDescendant(leaf, root), "isDescendant false cases");
  console.assert(dropPosition(4, { top: 0, height: 20 }, false) === "before", "dropPosition before (request)");
  console.assert(dropPosition(16, { top: 0, height: 20 }, false) === "after", "dropPosition after (request)");
  console.assert(dropPosition(4, { top: 0, height: 20 }, true) === "before", "dropPosition before (folder)");
  console.assert(dropPosition(10, { top: 0, height: 20 }, true) === "into", "dropPosition into (folder)");
  console.assert(dropPosition(16, { top: 0, height: 20 }, true) === "after", "dropPosition after (folder)");
  console.assert(subtreeMatches(folder, "login") === true, "subtreeMatches finds nested request by name");
  console.assert(subtreeMatches(folder, "nope") === false, "subtreeMatches rejects non-match");
  console.assert(listMatches([folder], "api/x") === true, "listMatches finds URL match");
  const dup = duplicateItem({ ...leaf, id: "abc", event: [{ listen: "test", id: "e1" } as never] });
  console.assert(dup.name === "Login Copy" && dup.id === undefined, "duplicateItem strips top-level id, renames");
  console.assert((dup.event as { id?: unknown }[] | undefined)?.[0]?.id === undefined, "duplicateItem strips nested id");
  const collX: Collection = { info: { name: "x" }, item: [{ name: "top" }] };
  console.assert(siblingList(collX, [0]) === collX.item, "siblingList: top-level path returns collection root");
}
