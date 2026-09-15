// Single mutable store. Collections/environments/tabs are mutated in place (they can be
// large) and every mutation bumps `version`; components subscribe via useSyncExternalStore
// and read state directly off the module-level `state` object, not from hook return values.
import * as api from "./api";
import type {
  Collection,
  Environment,
  FileRef,
  HistoryEntry,
  Item,
  RunResult,
  RunSummary,
  SendResult,
  Workspace,
  WsEvent,
} from "./types";
import { itemAt } from "./tree";
import { confirmDialog } from "./dialog";

export type TabKind = "request" | "collection" | "folder" | "environment" | "runner" | "cookies" | "appsettings";

interface TabBase {
  kind: TabKind;
  file: string; // collection file for request/collection/folder/runner tabs; environment file for "environment"
  path: number[]; // item path from the collection root; [] for collection/environment/whole-collection-runner tabs
}

export interface RequestTab extends TabBase {
  kind: "request";
  // Present only on draft (standalone, unsaved) request tabs, where file === "" and
  // path === [] for every draft, so tabKey needs this to tell them apart.
  id?: number;
  // A draft is a standalone request not yet saved into any collection. `item` in
  // RequestTab.tsx is this object for draft tabs; it has no parent, so no `coll` lookup.
  draft?: Item;
  draftDirty?: boolean;
  // Set on WebSocket request tabs once a connection was attempted.
  ws?: WsTabState;
  sendResult: SendResult | null;
  sending: boolean;
  showSnippet: boolean;
  snippetLang: string;
  snippetCode: string;
  bodyView: "pretty" | "raw";
}

export interface CollectionTab extends TabBase {
  kind: "collection";
  initialSub?: string; // sub-tab to show next render, e.g. "environments"; SettingsTab clears it
}

export interface FolderTab extends TabBase {
  kind: "folder";
}

export interface EnvironmentTab extends TabBase {
  kind: "environment";
}

export interface RunnerTab extends TabBase {
  kind: "runner";
  iterations: number;
  delayMs: number;
  running: boolean;
  results: RunResult[];
  summary: RunSummary | null;
}

export interface WsTabState {
  id: string; // chosen before connecting, so events that arrive during the handshake find the tab
  status: "connecting" | "open" | "closed";
  events: WsEvent[];
  message: string; // composer text
}

// Cookies and app settings are single app-wide tabs with file "" and path [].
export interface CookiesTab extends TabBase {
  kind: "cookies";
}

export interface AppSettingsTab extends TabBase {
  kind: "appsettings";
}

export type Tab = RequestTab | CollectionTab | FolderTab | EnvironmentTab | RunnerTab | CookiesTab | AppSettingsTab;

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

interface State {
  workspace: Workspace | null;
  collections: Map<string, Collection>;
  environments: Map<string, Environment>;
  dirtyCollections: Set<string>;
  dirtyEnvironments: Set<string>;
  expandedCollections: Set<string>;
  expandedItems: Set<Item>;
  // Environment file chosen per owner: a collection file, or "" for drafts and pages outside a collection.
  selectedEnvs: Record<string, string>;
  tabs: Tab[];
  activeTab: Tab | null;
  toasts: Toast[];
  // Feature 2 "Save request" modal: set to the draft tab being saved, null when closed.
  savingDraft: RequestTab | null;
  // Draft tab whose close is waiting for Save / Don't Save / Cancel.
  confirmClose: RequestTab | null;
  history: HistoryEntry[]; // newest first
}

export const state: State = {
  workspace: null,
  collections: new Map(),
  environments: new Map(),
  dirtyCollections: new Set(),
  dirtyEnvironments: new Set(),
  expandedCollections: new Set(),
  expandedItems: new Set(),
  selectedEnvs: loadSelectedEnvs(),
  tabs: [],
  activeTab: null,
  toasts: [],
  savingDraft: null,
  confirmClose: null,
  history: [],
};

let version = 0;
const listeners = new Set<() => void>();

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getVersion(): number {
  return version;
}

function bump(): void {
  version++;
  syncUnsaved();
  for (const cb of listeners) cb();
}

let lastUnsaved = false;

// Go asks before quitting, so it has to know whether anything would be lost.
function syncUnsaved(): void {
  const unsaved =
    state.dirtyCollections.size > 0 ||
    state.dirtyEnvironments.size > 0 ||
    state.tabs.some((t) => t.kind === "request" && t.draft !== undefined && t.draftDirty === true);
  if (unsaved === lastUnsaved) return;
  lastUnsaved = unsaved;
  api.setUnsaved(unsaved).catch((err) => console.error("failed to report unsaved state", err));
}

// --- workspace ---

export async function loadWorkspace(): Promise<void> {
  state.workspace = await api.getWorkspace();
  bump();
}

export async function refreshWorkspace(): Promise<void> {
  return loadWorkspace();
}

// --- toasts ---

let toastId = 0;

export function toast(text: string, kind: Toast["kind"] = "info"): void {
  const id = ++toastId;
  state.toasts.push({ id, text, kind });
  bump();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    bump();
  }, 4000);
}

export function dismissToast(id: number): void {
  state.toasts = state.toasts.filter((t) => t.id !== id);
  bump();
}

// --- collections ---

const collLoading = new Map<string, Promise<Collection>>();

export function getCollection(file: string): Collection | undefined {
  return state.collections.get(file);
}

export function ensureCollection(file: string): Promise<Collection> {
  const loaded = state.collections.get(file);
  if (loaded) return Promise.resolve(loaded);
  const pending = collLoading.get(file);
  if (pending) return pending;
  const promise = api
    .openCollection(file)
    .then((coll) => {
      state.collections.set(file, coll);
      collLoading.delete(file);
      bump();
      return coll;
    })
    .catch((err) => {
      collLoading.delete(file);
      throw err;
    });
  collLoading.set(file, promise);
  return promise;
}

// Edit counts per file. The save call serializes its arguments when it starts, so an edit made
// while the save is in flight is not in the file and must keep the file dirty. Auto-save runs
// every few seconds while the user types, which makes that overlap common.
const edits = new Map<string, number>();

function countEdit(file: string): void {
  edits.set(file, (edits.get(file) ?? 0) + 1);
}

export function markCollectionDirty(file: string): void {
  countEdit(file);
  state.dirtyCollections.add(file);
  bump();
}

export function isCollectionDirty(file: string): boolean {
  return state.dirtyCollections.has(file);
}

export async function saveCollectionFile(file: string): Promise<void> {
  const coll = state.collections.get(file);
  if (!coll) return;
  const before = edits.get(file);
  await api.saveCollection(file, coll);
  if (edits.get(file) === before) state.dirtyCollections.delete(file);
  bump();
}

export function toggleCollectionExpanded(file: string): void {
  if (state.expandedCollections.has(file)) state.expandedCollections.delete(file);
  else state.expandedCollections.add(file);
  bump();
}

export function toggleItemExpanded(item: Item): void {
  if (state.expandedItems.has(item)) state.expandedItems.delete(item);
  else state.expandedItems.add(item);
  bump();
}

// --- environments ---

const envLoading = new Map<string, Promise<Environment>>();

export function getEnvironment(file: string): Environment | undefined {
  return state.environments.get(file);
}

export function ensureEnvironment(file: string): Promise<Environment> {
  const loaded = state.environments.get(file);
  if (loaded) return Promise.resolve(loaded);
  const pending = envLoading.get(file);
  if (pending) return pending;
  const promise = api
    .openEnvironment(file)
    .then((env) => {
      state.environments.set(file, env);
      envLoading.delete(file);
      bump();
      return env;
    })
    .catch((err) => {
      envLoading.delete(file);
      throw err;
    });
  envLoading.set(file, promise);
  return promise;
}

export function markEnvironmentDirty(file: string): void {
  countEdit(file);
  state.dirtyEnvironments.add(file);
  bump();
}

export function isEnvironmentDirty(file: string): boolean {
  return state.dirtyEnvironments.has(file);
}

export async function saveEnvironmentFile(file: string): Promise<void> {
  const env = state.environments.get(file);
  if (!env) return;
  const before = edits.get(file);
  await api.saveEnvironment(file, env);
  if (edits.get(file) === before) state.dirtyEnvironments.delete(file);
  bump();
}

function loadSelectedEnvs(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem("restly.envs") ?? "null");
    if (saved && typeof saved === "object") return saved;
  } catch {
    // A corrupt value falls through to the older single-selection key.
  }
  const legacy = localStorage.getItem("restly.env");
  return legacy ? { "": legacy } : {};
}

// envOwner is the collection whose environments a tab can use, "" for drafts and pages outside a collection.
export function envOwner(tab: Tab | null = state.activeTab): string {
  if (!tab) return "";
  return tab.kind === "request" || tab.kind === "collection" || tab.kind === "folder" || tab.kind === "runner" ? tab.file : "";
}

// usableEnvs lists the owner's own environments first, then shared ones. An environment whose
// collection was deleted counts as shared, so it stays reachable.
export function usableEnvs(owner = envOwner()): FileRef[] {
  const collections = new Set((state.workspace?.collections ?? []).map((c) => c.file));
  const envs = state.workspace?.environments ?? [];
  const isShared = (e: FileRef) => !e.collection || !collections.has(e.collection);
  return [...envs.filter((e) => owner !== "" && e.collection === owner), ...envs.filter(isShared)];
}

export function collectionEnvs(collFile: string): FileRef[] {
  return (state.workspace?.environments ?? []).filter((e) => e.collection === collFile);
}

// A collection that never picked an environment uses the shared choice.
export function selectedEnv(owner = envOwner()): string {
  const file = owner in state.selectedEnvs ? state.selectedEnvs[owner] : (state.selectedEnvs[""] ?? "");
  return usableEnvs(owner).some((e) => e.file === file) ? file : "";
}

export function setSelectedEnv(owner: string, file: string): void {
  state.selectedEnvs[owner] = file;
  localStorage.setItem("restly.envs", JSON.stringify(state.selectedEnvs));
  bump();
}

export function confirmDelete(name: string): Promise<boolean> {
  return confirmDialog({ title: `Delete ${name}?`, message: "This cannot be undone.", confirmLabel: "Delete", danger: true });
}

export async function deleteEnvironmentFile(file: string): Promise<void> {
  await api.deleteFile(file);
  state.environments.delete(file);
  state.dirtyEnvironments.delete(file);
  closeTabsForFile(file, "environment");
  await refreshWorkspace();
}

// --- tabs ---

export function pathEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function pathPrefixEqual(a: number[], b: number[]): boolean {
  return b.length <= a.length && b.every((v, i) => a[i] === v);
}

function findTab(kind: TabKind, file: string, path: number[]): Tab | undefined {
  return state.tabs.find((t) => t.kind === kind && t.file === file && pathEqual(t.path, path));
}

export function openRequestTab(file: string, path: number[]): RequestTab {
  const existing = findTab("request", file, path) as RequestTab | undefined;
  if (existing) {
    state.activeTab = existing;
    bump();
    return existing;
  }
  const tab: RequestTab = {
    kind: "request",
    file,
    path,
    sendResult: null,
    sending: false,
    showSnippet: false,
    snippetLang: "curl",
    snippetCode: "",
    bodyView: "pretty",
  };
  state.tabs.push(tab);
  state.activeTab = tab;
  bump();
  return tab;
}

let nextDraftId = 1;

function newDraftItem(): Item {
  // No name: tabs and the save dialog call it after its URL until the user names it.
  return { name: "", request: { method: "GET", header: [], url: { raw: "" } } };
}

// Opens a new draft (standalone, unsaved) request tab. Never reuses an existing draft:
// several can be open at once. Pass a parsed item (e.g. from cURL import) to seed it.
export function openDraftTab(draft?: Item): RequestTab {
  const tab: RequestTab = {
    kind: "request",
    id: nextDraftId++,
    file: "",
    path: [],
    draft: draft ?? newDraftItem(),
    draftDirty: false,
    sendResult: null,
    sending: false,
    showSnippet: false,
    snippetLang: "curl",
    snippetCode: "",
    bodyView: "pretty",
  };
  state.tabs.push(tab);
  state.activeTab = tab;
  bump();
  return tab;
}

export function openSaveDraftModal(tab: RequestTab): void {
  state.savingDraft = tab;
  bump();
}

export function closeSaveDraftModal(): void {
  state.savingDraft = null;
  bump();
}

export function openCollectionTab(file: string, sub?: string): CollectionTab {
  const existing = findTab("collection", file, []) as CollectionTab | undefined;
  if (existing) {
    if (sub) existing.initialSub = sub;
    state.activeTab = existing;
    bump();
    return existing;
  }
  const tab: CollectionTab = { kind: "collection", file, path: [], initialSub: sub };
  state.tabs.push(tab);
  state.activeTab = tab;
  bump();
  return tab;
}

export function openFolderTab(file: string, path: number[]): FolderTab {
  const existing = findTab("folder", file, path) as FolderTab | undefined;
  if (existing) {
    state.activeTab = existing;
    bump();
    return existing;
  }
  const tab: FolderTab = { kind: "folder", file, path };
  state.tabs.push(tab);
  state.activeTab = tab;
  bump();
  return tab;
}

export function openEnvironmentTab(file: string): EnvironmentTab {
  const existing = findTab("environment", file, []) as EnvironmentTab | undefined;
  if (existing) {
    state.activeTab = existing;
    bump();
    return existing;
  }
  const tab: EnvironmentTab = { kind: "environment", file, path: [] };
  state.tabs.push(tab);
  state.activeTab = tab;
  bump();
  return tab;
}

export function openRunnerTab(file: string, path: number[]): RunnerTab {
  const existing = findTab("runner", file, path) as RunnerTab | undefined;
  if (existing) {
    state.activeTab = existing;
    bump();
    return existing;
  }
  const tab: RunnerTab = {
    kind: "runner",
    file,
    path,
    iterations: 1,
    delayMs: 0,
    running: false,
    results: [],
    summary: null,
  };
  // Subscribed for the tab's whole lifetime (not just while a run is active), since only
  // the active tab is rendered and a RunnerTab component effect would miss events fired
  // while the tab is in the background. The `running` guard discards stray events.
  const offResult = api.onRunResult((r) => {
    if (tab.running) {
      tab.results.push(r);
      bump();
    }
  });
  const offDone = api.onRunDone((s) => {
    if (tab.running) {
      tab.running = false;
      tab.summary = s;
      bump();
    }
  });
  runnerUnsub.set(tab, () => {
    offResult();
    offDone();
  });
  state.tabs.push(tab);
  state.activeTab = tab;
  bump();
  return tab;
}

const runnerUnsub = new Map<RunnerTab, () => void>();

function disposeTab(tab: Tab): void {
  if (tab.kind === "runner") {
    runnerUnsub.get(tab)?.();
    runnerUnsub.delete(tab);
  }
  if (tab.kind === "request" && tab.ws && tab.ws.status !== "closed") {
    api.wsClose(tab.ws.id).catch((err) => toast(String(err), "error"));
  }
}

export function closeTab(tab: Tab): void {
  const index = state.tabs.indexOf(tab);
  if (index === -1) return;
  state.tabs.splice(index, 1);
  disposeTab(tab);
  if (state.activeTab === tab) {
    state.activeTab = state.tabs[index] ?? state.tabs[index - 1] ?? null;
  }
  bump();
}

export function setActiveTab(tab: Tab): void {
  state.activeTab = tab;
  bump();
}

// Called after an item at `path` in `file` is deleted: closes tabs at or below it and
// shifts the index of later siblings at the same depth down by one.
export function onItemDeleted(file: string, path: number[]): void {
  const depth = path.length - 1;
  state.tabs.filter((t) => t.file === file && pathPrefixEqual(t.path, path)).forEach(disposeTab);
  state.tabs = state.tabs.filter((t) => !(t.file === file && pathPrefixEqual(t.path, path)));
  for (const t of state.tabs) {
    if (
      t.file === file &&
      t.path.length > depth &&
      pathPrefixEqual(t.path, path.slice(0, depth)) &&
      t.path[depth] > path[depth]
    ) {
      t.path[depth]--;
    }
  }
  if (state.activeTab && !state.tabs.includes(state.activeTab)) {
    state.activeTab = state.tabs[0] ?? null;
  }
  bump();
}

export function closeTabsForFile(file: string, kind: TabKind): void {
  state.tabs.filter((t) => t.file === file && t.kind === kind).forEach(disposeTab);
  state.tabs = state.tabs.filter((t) => !(t.file === file && t.kind === kind));
  if (state.activeTab && !state.tabs.includes(state.activeTab)) {
    state.activeTab = state.tabs[0] ?? null;
  }
  bump();
}

export function findFileRef(kind: "collection" | "environment", file: string): FileRef | undefined {
  const list = kind === "collection" ? state.workspace?.collections : state.workspace?.environments;
  return list?.find((r) => r.file === file);
}

// Generic bump for components that mutate a collection/environment's JSON in place
// (e.g. KvTable) and need to notify subscribers without a dedicated setter.
export function notifyChange(): void {
  bump();
}

// --- app-wide tabs ---

export function openCookiesTab(): CookiesTab {
  const existing = findTab("cookies", "", []) as CookiesTab | undefined;
  const tab: CookiesTab = existing ?? { kind: "cookies", file: "", path: [] };
  if (!existing) state.tabs.push(tab);
  state.activeTab = tab;
  bump();
  return tab;
}

export function openAppSettingsTab(): AppSettingsTab {
  const existing = findTab("appsettings", "", []) as AppSettingsTab | undefined;
  const tab: AppSettingsTab = existing ?? { kind: "appsettings", file: "", path: [] };
  if (!existing) state.tabs.push(tab);
  state.activeTab = tab;
  bump();
  return tab;
}

// --- events from Go ---

const HISTORY_LIMIT = 500; // historyLimit in Go
let eventsStarted = false;

// startEvents subscribes once to Go events that outlive any one tab.
export function startEvents(): void {
  if (eventsStarted) return;
  eventsStarted = true;
  api.onWsEvent(routeWsEvent);
  api.onHistoryAdded((entry) => {
    state.history.unshift(entry);
    state.history.length = Math.min(state.history.length, HISTORY_LIMIT);
    bump();
  });
}

function routeWsEvent(event: WsEvent): void {
  const tab = state.tabs.find((t): t is RequestTab => t.kind === "request" && t.ws?.id === event.id);
  if (!tab?.ws) return;
  tab.ws.events.push(event);
  if (event.type === "open") tab.ws.status = "open";
  else if (event.type === "closed") tab.ws.status = "closed";
  bump();
}

export async function loadHistory(): Promise<void> {
  state.history = await api.getHistory();
  bump();
}

// --- tree edits ---

// Tabs address items by index path, which shifts when items move or are inserted. mutate runs
// the tree edit, then each open tab is re-pointed at its item by identity, and tabs whose item
// is gone are closed. Use it for every reorder, move, duplicate, and insert.
export function remapTabsAfter(mutate: () => void): void {
  const targets = new Map<Tab, Item>();
  for (const tab of state.tabs) {
    if (tab.kind === "environment" || tab.file === "" || tab.path.length === 0) continue;
    const coll = state.collections.get(tab.file);
    const item = coll ? itemAt(coll, tab.path) : undefined;
    if (item) targets.set(tab, item);
  }
  mutate();
  for (const [tab, item] of targets) {
    const found = locateItem(item);
    if (found) {
      tab.file = found.file;
      tab.path = found.path;
    } else {
      disposeTab(tab);
      state.tabs = state.tabs.filter((t) => t !== tab);
    }
  }
  if (state.activeTab && !state.tabs.includes(state.activeTab)) {
    state.activeTab = state.tabs[0] ?? null;
  }
  bump();
}

// locateItem finds item by identity in the loaded collections.
export function locateItem(item: Item): { file: string; path: number[] } | undefined {
  for (const [file, coll] of state.collections) {
    const path = pathOf(coll.item, item);
    if (path) return { file, path };
  }
  return undefined;
}

function pathOf(items: Item[] | undefined, target: Item): number[] | undefined {
  for (const [index, item] of (items ?? []).entries()) {
    if (item === target) return [index];
    const inner = pathOf(item.item, target);
    if (inner) return [index, ...inner];
  }
  return undefined;
}
