// Hand-written types for the subset of the Postman v2.1 JSON shape Restly edits.
// Every object keeps `[key: string]: unknown` so members we don't model survive a save.
// Do not use the generated wailsjs model classes (their createFrom drops unknown members).

export interface FileRef {
  file: string; // absolute path
  name: string;
  collection?: string; // environments only: the owning collection file, absent for shared environments
}

// A file in the per-machine data folder, returned with its text: an imported theme or keybindings.json.
export interface TextFile {
  file: string; // absolute path
  data: string;
}

export interface Workspace {
  dir: string;
  collections: FileRef[];
  environments: FileRef[];
  globals: string; // globals file, opened and saved like an environment
}

export interface KV {
  key: string;
  value?: string;
  disabled?: boolean;
  type?: string; // formdata: "text" | "file"; auth params: "string"
  src?: string;
  [key: string]: unknown;
}

export interface UrlValue {
  raw: string;
  query?: KV[];
  variable?: KV[];
  host?: unknown;
  path?: unknown;
  protocol?: unknown;
  port?: unknown;
  hash?: unknown;
  [key: string]: unknown;
}

export interface BodyFile {
  src?: string;
  [key: string]: unknown;
}

export interface GraphQLBody {
  query?: string;
  variables?: string;
  [key: string]: unknown;
}

export interface RequestBody {
  mode: "raw" | "urlencoded" | "formdata" | "file" | "graphql";
  raw?: string;
  options?: { raw?: { language?: "json" | "text" | "xml" | "html" | "javascript" } };
  urlencoded?: KV[];
  formdata?: KV[];
  file?: BodyFile;
  graphql?: GraphQLBody;
  [key: string]: unknown;
}

export interface AuthValue {
  type: string;
  basic?: KV[];
  bearer?: KV[];
  apikey?: KV[];
  [key: string]: unknown;
}

export interface Script {
  type: "text/javascript";
  // Postman/Restly usually write this as an array of lines, but a file written with exec
  // as one string round-trips as a string until the UI edits it (internal/collection's
  // Script.MarshalJSON keeps the original shape).
  exec: string[] | string;
  [key: string]: unknown;
}

export interface EventEntry {
  listen: "prerequest" | "test";
  script?: Script;
  disabled?: boolean;
  [key: string]: unknown;
}

export interface Variable {
  key: string;
  value?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

export interface RequestValue {
  method: string;
  url?: string | UrlValue;
  header?: KV[];
  body?: RequestBody;
  auth?: AuthValue;
  [key: string]: unknown;
}

export interface Item {
  name: string;
  request?: RequestValue;
  item?: Item[];
  event?: EventEntry[];
  variable?: Variable[];
  auth?: AuthValue;
  [key: string]: unknown;
}

export function isFolder(item: Item): boolean {
  return item.request == null;
}

export interface Info {
  _postman_id?: string;
  name: string;
  schema?: string;
  [key: string]: unknown;
}

export interface Collection {
  info: Info;
  item: Item[];
  event?: EventEntry[];
  variable?: Variable[];
  auth?: AuthValue;
  [key: string]: unknown;
}

export interface EnvValue {
  key: string;
  value?: string;
  type?: "default" | "secret";
  enabled?: boolean;
  [key: string]: unknown;
}

export interface Environment {
  id: string;
  name: string;
  values: EnvValue[];
  _postman_variable_scope?: string;
  [key: string]: unknown;
}

// --- backend response shapes (read-only, values Go produces) ---

export interface Header {
  key: string;
  value: string;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: string;
  httpOnly: boolean;
  secure: boolean;
  hostOnly: boolean; // set without a Domain attribute, so it matches only `domain` itself
}

export interface Timings {
  dns: number;
  connect: number;
  tls: number;
  firstByte: number;
  total: number;
}

export interface HttpResponse {
  code: number;
  status: string;
  header: Header[];
  cookies: Cookie[];
  size: number;
  timings: Timings;
}

export interface TestResult {
  name: string;
  passed: boolean;
  error: string;
}

export interface SendInput {
  file: string;
  path: number[];
  item?: Item;
  env: string;
}

export interface SendResult {
  response: HttpResponse | null;
  body: string;
  binary: boolean;
  truncated: boolean;
  tests: TestResult[];
  console: string[];
  error: string;
  variables: Variable[];
  environment: Environment | null;
}

export interface RunInput {
  file: string;
  path: number[];
  env: string;
  iterations: number;
  delayMs: number;
}

export interface RunResult {
  iteration: number;
  path: number[];
  name: string;
  method: string;
  url: string;
  code: number;
  status: string;
  timeMs: number;
  tests: TestResult[];
  console: string[];
  error: string;
  skipped: boolean;
}

export interface RunSummary {
  requests: number;
  passed: number;
  failed: number;
  errors: number;
  stopped: boolean;
}

export interface ClientCert {
  host: string; // host, or host:port
  certFile: string; // PEM
  keyFile: string; // PEM
}

export interface Network {
  proxyMode: "none" | "environment" | "custom"; // "environment" reads HTTP_PROXY/HTTPS_PROXY/NO_PROXY
  proxyUrl: string;
  proxyBypass: string; // comma-separated hosts
  verifyTls: boolean;
  caFile: string; // extra PEM CA bundle, "" for none
  clientCerts: ClientCert[];
}

export interface Settings {
  network: Network;
}

// Shown in Settings > About. Commit, buildTime, and goVersion are "" when built without vcs info.
export interface AppInfo {
  version: string;
  commit: string;
  buildTime: string;
  goVersion: string;
}

export interface HistoryEntry {
  id: string;
  time: number; // Unix milliseconds
  method: string; // "WS" for a WebSocket connection
  url: string; // resolved, "" when the request was never built
  code: number; // 0 when no response arrived
  durationMs: number;
  size: number;
  error: string;
  item: Item; // reopen as a standalone request
}

export interface WsEvent {
  id: string;
  type: "open" | "received" | "sent" | "closed" | "error";
  data: string; // text, base64 when binary, close reason, or error text
  binary: boolean;
  code: number; // close code for "closed"
  header: Header[]; // handshake response headers for "open"
  time: number; // Unix milliseconds
}
