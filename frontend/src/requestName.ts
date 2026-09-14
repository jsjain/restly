import type { Item } from "./types";
import { urlRaw } from "./urlutil";

// inferRequestName names a request after where it goes: host and path, without scheme, query, or trailing slash.
export function inferRequestName(url: string): string {
  return url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "");
}

// requestTitle is what a standalone request is called until the user names it.
export function requestTitle(item: Item | undefined): string {
  const url = item?.request ? urlRaw(item.request.url) : "";
  return item?.name?.trim() || inferRequestName(url) || "Untitled Request";
}
