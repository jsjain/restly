export const HEADER_NAMES: string[] = [
  "Accept", "Accept-Charset", "Accept-Encoding", "Accept-Language",
  "Access-Control-Request-Headers", "Access-Control-Request-Method", "Authorization", "Cache-Control",
  "Connection", "Content-Type", "Content-Disposition", "Content-Encoding", "Content-Language", "Content-Length",
  "Content-MD5", "Cookie", "Date", "DNT", "Expect", "Forwarded", "From", "Host",
  "If-Match", "If-Modified-Since", "If-None-Match", "If-Range", "If-Unmodified-Since", "Max-Forwards",
  "Origin", "Pragma", "Prefer", "Proxy-Authorization", "Range", "Referer", "TE", "Upgrade", "User-Agent",
  "Via", "X-API-Key", "X-Correlation-ID", "X-CSRF-Token", "X-Forwarded-For", "X-Forwarded-Host",
  "X-Forwarded-Proto", "X-Request-ID", "X-Requested-With",
];

const VALUES: Record<string, string[]> = {
  "content-type": [
    "application/json", "application/xml", "application/x-www-form-urlencoded", "multipart/form-data",
    "text/plain", "text/html", "application/octet-stream",
  ],
  accept: ["*/*", "application/json", "application/xml", "text/html", "text/plain"],
  "accept-encoding": ["gzip, deflate, br", "gzip", "identity"],
  "cache-control": ["no-cache", "no-store", "max-age=0"],
  connection: ["keep-alive", "close"],
  "x-requested-with": ["XMLHttpRequest"],
};

export function headerValueOptions(key: string): string[] {
  return VALUES[key.trim().toLowerCase()] ?? [];
}

// Prefix matches first, then substring matches, each in the options' order. An exact match
// returns nothing so that accepting the list never rewrites a finished name into a longer one.
export function rankSuggestions(options: string[], query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const lower = options.map((o) => o.toLowerCase());
  if (lower.includes(q)) return [];
  const prefix = options.filter((_, i) => lower[i].startsWith(q));
  const rest = options.filter((_, i) => !lower[i].startsWith(q) && lower[i].includes(q));
  return [...prefix, ...rest].slice(0, limit);
}
