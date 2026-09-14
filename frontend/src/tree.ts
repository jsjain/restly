import type { Collection, Item } from "./types";

// Item lookup by index path from the collection root, e.g. [2,0] = first child of the
// third top-level item.
export function itemAt(coll: Collection, path: number[]): Item | undefined {
  let item: Item | undefined;
  let list: Item[] | undefined = coll.item;
  for (const idx of path) {
    item = list?.[idx];
    if (!item) return undefined;
    list = item.item;
  }
  return item;
}

export function parentList(coll: Collection, path: number[]): Item[] | undefined {
  // A top-level item's parent is the collection itself, which itemAt cannot return.
  if (path.length <= 1) return coll.item;
  const parent = itemAt(coll, path.slice(0, -1));
  if (!parent) return undefined;
  parent.item ??= [];
  return parent.item;
}

export function removeAt(coll: Collection, path: number[]): void {
  const list = parentList(coll, path);
  if (list) list.splice(path[path.length - 1], 1);
}
