import type { Item, KV, UrlValue } from "./types";

export function urlRaw(url: string | UrlValue | undefined): string {
  if (url == null) return "";
  return typeof url === "string" ? url : url.raw ?? "";
}

// Splits raw into everything before "?" and the query string (without "?").
function splitQuery(raw: string): [string, string] {
  const i = raw.indexOf("?");
  return i === -1 ? [raw, ""] : [raw.slice(0, i), raw.slice(i + 1)];
}

// No decoding/encoding: the raw query string's key/value substrings are used as-is, and
// syncRawFromParams joins them back the same way, so raw round-trips unless actually edited.
function parseQueryString(qs: string): KV[] {
  if (!qs) return [];
  return qs
    .split("&")
    .filter((p) => p !== "")
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1 ? { key: pair, value: "" } : { key: pair.slice(0, eq), value: pair.slice(eq + 1) };
    });
}

// Ensures item.request.url is an object, converting a string (or absent) url in place.
// A string url's existing query string becomes the initial url.query.
export function asUrlValue(item: Item): UrlValue {
  if (item.request == null) throw new Error("item has no request");
  if (typeof item.request.url === "string" || item.request.url == null) {
    const raw = urlRaw(item.request.url);
    const [, qs] = splitQuery(raw);
    const url: UrlValue = { raw, query: parseQueryString(qs) };
    item.request.url = url;
    return url;
  }
  return item.request.url;
}

// Called when the user edits the URL text box: sets raw, rebuilds query from the raw query
// string (existing disabled entries are kept, appended after the enabled ones), and drops
// host/path/protocol/port/hash so Go regenerates them on save. Everything else on the url
// object (such as variable) is left untouched.
export function setUrlRaw(item: Item, raw: string): void {
  const url = asUrlValue(item);
  const prevDisabled = (url.query ?? []).filter((q) => q.disabled);
  const [, qs] = splitQuery(raw);
  url.raw = raw;
  url.query = [...parseQueryString(qs), ...prevDisabled];
  delete url.host;
  delete url.path;
  delete url.protocol;
  delete url.port;
  delete url.hash;
}

// Rebuilds raw from base + enabled params, called when the Params table changes.
export function syncRawFromParams(url: UrlValue): void {
  const [base] = splitQuery(url.raw);
  const enabled = (url.query ?? []).filter((q) => !q.disabled && q.key !== "");
  const qs = enabled.map((q) => `${q.key}=${q.value ?? ""}`).join("&");
  url.raw = qs ? `${base}?${qs}` : base;
}

const PATH_VAR_RE = /:([A-Za-z_][\w-]*)/g;

// Path variable names found in the raw path (before "?").
export function pathVarNames(raw: string): string[] {
  const [base] = splitQuery(raw);
  const names: string[] = [];
  for (const m of base.matchAll(PATH_VAR_RE)) names.push(m[1]);
  return names;
}

// Keeps url.variable in sync with the :name segments found in the raw path: adds missing
// ones, and drops entries whose name is no longer present.
export function syncPathVariables(url: UrlValue): KV[] {
  const names = pathVarNames(url.raw);
  const existing = url.variable ?? [];
  const kept = existing.filter((v) => names.includes(v.key));
  for (const name of names) {
    if (!kept.some((v) => v.key === name)) kept.push({ key: name, value: "" });
  }
  url.variable = kept;
  return kept;
}
