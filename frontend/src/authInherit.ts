import { getCollection } from "./store";
import { itemAt } from "./tree";
import type { AuthValue } from "./types";

const TYPE_LABEL: Record<string, string> = {
  noauth: "No auth",
  basic: "Basic auth",
  bearer: "Bearer token",
  apikey: "API key",
};

function describe(auth: AuthValue | undefined, source: string): { source: string; type: string } | null {
  if (!auth || auth.type === "inherit") return null;
  return { source, type: TYPE_LABEL[auth.type] ?? auth.type };
}

// The auth a request or folder at `path` falls back to when it inherits: the nearest folder above it,
// then the collection, that sets one. Null for drafts and when nothing above sets auth (none is sent).
export function inheritedAuth(file: string, path: number[]): { source: string; type: string } | null {
  const coll = file ? getCollection(file) : undefined;
  if (!coll) return null;
  for (let len = path.length - 1; len >= 1; len--) {
    const folder = itemAt(coll, path.slice(0, len));
    const found = describe(folder?.auth, `${folder?.name ?? "Folder"} folder`);
    if (found) return found;
  }
  return describe(coll.auth, `${coll.info.name} collection`);
}
