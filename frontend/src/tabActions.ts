// Tab lifecycle actions shared by keyboard shortcuts, the command palette and the tab
// context menu. Kept separate from store.ts because these are policy (what "close" or
// "duplicate" means for each tab kind), not state mutation primitives.
import type { Tab } from "./store";
import {
  state,
  closeTab,
  isCollectionDirty,
  isEnvironmentDirty,
  getCollection,
  openDraftTab,
  openRequestTab,
  openCollectionTab,
  openFolderTab,
  openEnvironmentTab,
  openRunnerTab,
  openCookiesTab,
  openAppSettingsTab,
  notifyChange,
  toast,
} from "./store";
import { ClipboardSetText } from "./api";
import { itemAt } from "./tree";
import { urlRaw } from "./urlutil";
import type { Item } from "./types";

// Resolves the request Item behind a tab: the draft object itself, or a lookup into its
// collection by path. Shared by duplicate/copy-URL/copy-cURL, which all need the same item.
export function tabItem(tab: Tab): Item | undefined {
  if (tab.kind !== "request") return undefined;
  if (tab.file === "") return tab.draft;
  const coll = getCollection(tab.file);
  return coll ? itemAt(coll, tab.path) : undefined;
}

function isTabDirty(tab: Tab): boolean {
  if (tab.kind === "request" && tab.file === "") return !!tab.draftDirty;
  if (tab.file === "") return false; // cookies/appsettings have no backing file
  return tab.kind === "environment" ? isEnvironmentDirty(tab.file) : isCollectionDirty(tab.file);
}

// A tab is "saved" if it has somewhere on disk to go back to; only standalone drafts don't.
function isSaved(tab: Tab): boolean {
  return !(tab.kind === "request" && tab.file === "");
}

// --- reopen-closed stack ---

interface ClosedEntry {
  kind: Tab["kind"];
  file: string;
  path: number[];
  draft?: Item; // set only for a closed draft request tab
}

const CLOSED_LIMIT = 20; // ponytail: small bounded undo stack, not unlimited history
const closedStack: ClosedEntry[] = [];

function snapshotTab(tab: Tab): ClosedEntry {
  if (tab.kind === "request" && tab.file === "") {
    return { kind: "request", file: "", path: [], draft: structuredClone(tab.draft) };
  }
  return { kind: tab.kind, file: tab.file, path: [...tab.path] };
}

function closeAndRecord(tab: Tab): void {
  closedStack.push(snapshotTab(tab));
  if (closedStack.length > CLOSED_LIMIT) closedStack.shift();
  closeTab(tab);
}

// requestClose is the single entry point for "close this tab": a dirty draft would lose
// unsaved work, so it hands off to the confirm-close prompt instead of closing outright.
export function requestClose(tab: Tab): void {
  if (tab.kind === "request" && tab.file === "" && tab.draftDirty) {
    state.confirmClose = tab;
    notifyChange();
    return;
  }
  closeAndRecord(tab);
}

// Reopens the most recently closed tab. A saved request/folder is reopened by file+path,
// which can point at the wrong item if the tree was edited while the tab was closed —
// accepted, since re-deriving identity across edits needs more bookkeeping than an undo
// stack like this warrants.
export function reopenClosed(): void {
  const entry = closedStack.pop();
  if (!entry) return;
  switch (entry.kind) {
    case "request":
      if (entry.draft) openDraftTab(entry.draft);
      else openRequestTab(entry.file, entry.path);
      return;
    case "collection":
      openCollectionTab(entry.file);
      return;
    case "folder":
      openFolderTab(entry.file, entry.path);
      return;
    case "environment":
      openEnvironmentTab(entry.file);
      return;
    case "runner":
      openRunnerTab(entry.file, entry.path);
      return;
    case "cookies":
      openCookiesTab();
      return;
    case "appsettings":
      openAppSettingsTab();
      return;
  }
}

// --- bulk close ---

// Shared by closeAll/closeOthers/closeToRight/closeSaved: closes every tab matching
// `predicate`, except a dirty draft (which would silently discard unsaved work) — those are
// counted and reported in one toast instead of popping a confirm dialog per tab.
function closeMany(predicate: (tab: Tab) => boolean): void {
  let dirtyDraftsKept = 0;
  const toClose = state.tabs.filter((tab) => {
    if (!predicate(tab)) return false;
    if (tab.kind === "request" && tab.file === "" && tab.draftDirty) {
      dirtyDraftsKept++;
      return false;
    }
    return true;
  });
  toClose.forEach(closeAndRecord);
  if (dirtyDraftsKept > 0) {
    toast(`${dirtyDraftsKept} unsaved draft${dirtyDraftsKept === 1 ? "" : "s"} kept open`);
  }
}

export function closeAll(): void {
  closeMany(() => true);
}

export function closeOthers(tab: Tab): void {
  closeMany((t) => t !== tab);
}

export function closeToRight(tab: Tab): void {
  const index = state.tabs.indexOf(tab);
  closeMany((t) => state.tabs.indexOf(t) > index);
}

// Closes tabs backed by a file (or the app-wide cookies/appsettings tabs); drafts are never
// "saved" so they're left alone regardless of their dirty flag — no confirm needed either way.
export function closeSaved(): void {
  closeMany((t) => isSaved(t));
}

// --- single-tab actions ---

export function duplicateTab(tab: Tab): void {
  const item = tabItem(tab);
  if (!item) return;
  const clone = structuredClone(item);
  clone.name = `${item.name} Copy`;
  openDraftTab(clone);
}

export function nextTab(delta: 1 | -1): void {
  if (state.tabs.length === 0) return;
  const index = state.activeTab ? state.tabs.indexOf(state.activeTab) : -1;
  const next = (index + delta + state.tabs.length) % state.tabs.length;
  state.activeTab = state.tabs[next];
  notifyChange();
}

export function goToTab(index: number): void {
  const tab = state.tabs[index];
  if (!tab) return;
  state.activeTab = tab;
  notifyChange();
}

export async function copyUrl(tab: Tab): Promise<void> {
  const item = tabItem(tab);
  const raw = item?.request ? urlRaw(item.request.url) : "";
  if (!raw) {
    toast("No URL to copy", "error");
    return;
  }
  await ClipboardSetText(raw);
  toast("URL copied");
}

// Fires an event Sidebar listens for (not wired here — see the CustomEvent name's doc
// comment in commands.ts) to expand the tree down to this request and scroll it into view.
export function revealInSidebar(tab: Tab): void {
  if (tab.kind !== "request" || tab.file === "") return; // drafts aren't in the sidebar tree
  window.dispatchEvent(new CustomEvent("restly:reveal-in-sidebar", { detail: { file: tab.file, path: tab.path } }));
}
