// Command registry: every keyboard shortcut and command-palette row is one of these. UI
// pieces that don't exist yet (URL input, sidebar, overlays) are reached through window
// CustomEvents instead of direct imports, so this module doesn't need to know about them.
import { state, openDraftTab, openAppSettingsTab, openCookiesTab, openSaveDraftModal, saveCollectionFile, saveEnvironmentFile, selectedEnv, toast } from "./store";
import { newWebSocketItem } from "./websocket";
import { requestClose, reopenClosed, nextTab, goToTab, closeAll, closeOthers, duplicateTab, tabItem } from "./tabActions";
import * as api from "./api";
import defaultKeybindings from "./keybindings.default.json";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";

export interface Command {
  id: string;
  title: string;
  group: string;
  keys?: string[]; // e.g. ["mod+enter"]; multiple entries are alternate chords for the same command
  run(): void;
  when?(): boolean; // hides the command from the palette and lets the key fall through when false
}

const registry = new Map<string, Command>();

// Default keys come from keybindings.default.json, the file users read to see them.
export function registerCommand(cmd: Command): void {
  const keys = defaultKeybindings.filter((binding) => binding.command === cmd.id).map((binding) => binding.key);
  registry.set(cmd.id, { ...cmd, keys });
}

export function listCommands(): Command[] {
  return [...registry.values()];
}

// --- UI events for components owned by other modules ---
// Overlays.tsx: OPEN_PALETTE / OPEN_SHORTCUTS. Sidebar: TOGGLE_SIDEBAR / FOCUS_SIDEBAR_SEARCH /
// REVEAL_IN_SIDEBAR (dispatched from tabActions.revealInSidebar). The URL input: FOCUS_URL.
// RequestTab/WebSocketTab: SEND. RequestTab: CANCEL_SEND.
export const FOCUS_URL = "restly:focus-url";
export const TOGGLE_SIDEBAR = "restly:toggle-sidebar";
export const FOCUS_SIDEBAR_SEARCH = "restly:focus-sidebar-search";
export const SEND = "restly:send";
export const CANCEL_SEND = "restly:cancel-send";
export const OPEN_PALETTE = "restly:open-palette"; // detail: { mode: PaletteMode }
export const OPEN_SHORTCUTS = "restly:open-shortcuts";
export const SETTINGS_SAVED = "restly:settings-saved"; // AppSettingsTab -> StatusBar
export const REVEAL_IN_SIDEBAR = "restly:reveal-in-sidebar"; // detail: { file: string; path: number[] }
export const IMPORT_CURL = "restly:import-curl"; // Sidebar owns the Import cURL modal
export const FOCUS_SIDEBAR = "restly:focus-sidebar"; // Sidebar moves keyboard focus into the collection tree
export const TOGGLE_CODE = "restly:toggle-code"; // RequestTab shows/hides its generated-code panel
export const RELOAD_KEYBINDINGS = "restly:reload-keybindings"; // keybindings.ts re-reads keybindings.json
export const FORMAT_BODY = "restly:format-body"; // BodyEditor formats the raw body it's showing

export type PaletteMode = "all" | "requests" | "environments";

function fire(name: string, detail?: unknown): void {
  window.dispatchEvent(detail === undefined ? new CustomEvent(name) : new CustomEvent(name, { detail }));
}

function hasActiveTab(): boolean {
  return state.activeTab !== null;
}

function isActiveRequestTab(): boolean {
  return state.activeTab?.kind === "request";
}

// Mirrors RequestTab.handleSave / App's old Cmd+S handler: a draft opens the save modal, an
// environment saves itself, a saved request/collection/folder saves its collection file,
// and anything else (cookies, appsettings, runner) has nothing to save.
function runSave(): void {
  const tab = state.activeTab;
  if (!tab) return;
  if (tab.kind === "request" && tab.file === "") {
    openSaveDraftModal(tab);
    return;
  }
  if (tab.kind === "environment") {
    saveEnvironmentFile(tab.file).then(() => toast("Saved")).catch((err) => toast(String(err), "error"));
    return;
  }
  if ((tab.kind === "request" || tab.kind === "collection" || tab.kind === "folder") && tab.file !== "") {
    saveCollectionFile(tab.file).then(() => toast("Saved")).catch((err) => toast(String(err), "error"));
  }
}

// Find searches the editor the user is in: the focused one, else the one in the pane they last
// clicked (request above, response below), else the response body. Inactive tabs stay mounted
// but hidden, so only editors with a layout box count.
let lastPane: Element | null = null;
document.addEventListener("pointerdown", (e) => {
  lastPane = e.target instanceof Element ? e.target.closest(".split-top, .split-bottom") : null;
}, true);

function visibleEditor(root: ParentNode, selector = ".cm-editor"): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.getClientRects().length > 0) ?? null;
}

function findTarget(): HTMLElement | null {
  const focused = document.activeElement?.closest<HTMLElement>(".cm-editor");
  if (focused) return focused;
  const pane = lastPane?.isConnected ? visibleEditor(lastPane) : null;
  return pane ?? visibleEditor(document, ".split-bottom .cm-editor") ?? visibleEditor(document);
}

function runFind(): void {
  const target = findTarget();
  const view = target && EditorView.findFromDOM(target);
  if (view) openSearchPanel(view);
}

async function copyAsCurl(): Promise<void> {
  const tab = state.activeTab;
  if (!tab || tab.kind !== "request") return;
  const item = tabItem(tab);
  if (!item?.request) return;
  try {
    const code = await api.snippet({ file: tab.file, path: tab.path, item, env: selectedEnv(tab.file) }, "curl");
    await api.ClipboardSetText(code);
    toast("Copied as cURL");
  } catch (err) {
    toast(String(err), "error");
  }
}

registerCommand({ id: "send", title: "Send request", group: "Request", when: isActiveRequestTab, run: () => fire(SEND) });
// No default key: Escape is plain, so a global binding would also fire while a popover that is not
// a dialog or menu has focus. RequestTab cancels on Escape itself, once nothing else has used it.
registerCommand({
  id: "cancel-request",
  title: "Cancel request",
  group: "Request",
  when: () => state.activeTab?.kind === "request" && state.activeTab.sending,
  run: () => fire(CANCEL_SEND),
});
registerCommand({ id: "save", title: "Save", group: "Request", when: hasActiveTab, run: runSave });
registerCommand({ id: "copy-curl", title: "Copy as cURL", group: "Request", when: isActiveRequestTab, run: () => void copyAsCurl() });
registerCommand({ id: "format-body", title: "Format body", group: "Request", when: isActiveRequestTab, run: () => fire(FORMAT_BODY) });
registerCommand({ id: "find", title: "Find in editor", group: "Request", when: () => findTarget() !== null, run: runFind });

registerCommand({ id: "new-http-request", title: "New HTTP request", group: "Tabs", run: () => openDraftTab() });
registerCommand({ id: "import-curl", title: "Import cURL", group: "Tabs", run: () => fire(IMPORT_CURL) });
registerCommand({ id: "new-websocket-request", title: "New WebSocket request", group: "Tabs", run: () => openDraftTab(newWebSocketItem()) });
registerCommand({ id: "close-tab", title: "Close tab", group: "Tabs", when: hasActiveTab, run: () => requestClose(state.activeTab!) });
registerCommand({ id: "reopen-closed-tab", title: "Reopen closed tab", group: "Tabs", run: reopenClosed });
registerCommand({ id: "next-tab", title: "Next tab", group: "Tabs", run: () => nextTab(1) });
registerCommand({ id: "prev-tab", title: "Previous tab", group: "Tabs", run: () => nextTab(-1) });
registerCommand({ id: "duplicate-tab", title: "Duplicate tab", group: "Tabs", when: isActiveRequestTab, run: () => duplicateTab(state.activeTab!) });
registerCommand({ id: "close-all-tabs", title: "Close all tabs", group: "Tabs", run: closeAll });
registerCommand({ id: "close-other-tabs", title: "Close other tabs", group: "Tabs", when: hasActiveTab, run: () => closeOthers(state.activeTab!) });

for (let i = 1; i <= 8; i++) {
  registerCommand({
    id: `go-to-tab-${i}`,
    title: `Go to tab ${i}`,
    group: "Tabs",
    when: () => state.tabs.length >= i,
    run: () => goToTab(i - 1),
  });
}
registerCommand({ id: "go-to-last-tab", title: "Go to last tab", group: "Tabs", when: () => state.tabs.length > 0, run: () => goToTab(state.tabs.length - 1) });

registerCommand({ id: "focus-url", title: "Focus URL", group: "Navigation", when: isActiveRequestTab, run: () => fire(FOCUS_URL) });
registerCommand({ id: "command-palette", title: "Command palette", group: "Navigation", run: () => fire(OPEN_PALETTE, { mode: "all" as PaletteMode }) });
registerCommand({ id: "quick-open-request", title: "Quick open request", group: "Navigation", run: () => fire(OPEN_PALETTE, { mode: "requests" as PaletteMode }) });
registerCommand({ id: "switch-environment", title: "Switch environment", group: "Navigation", run: () => fire(OPEN_PALETTE, { mode: "environments" as PaletteMode }) });

registerCommand({ id: "toggle-sidebar", title: "Toggle sidebar", group: "View", run: () => fire(TOGGLE_SIDEBAR) });
registerCommand({ id: "focus-sidebar-search", title: "Focus sidebar search", group: "View", run: () => fire(FOCUS_SIDEBAR_SEARCH) });
registerCommand({ id: "focus-sidebar", title: "Focus sidebar", group: "View", run: () => fire(FOCUS_SIDEBAR) });
registerCommand({ id: "toggle-code-panel", title: "Toggle code panel", group: "View", when: isActiveRequestTab, run: () => fire(TOGGLE_CODE) });

registerCommand({ id: "keyboard-shortcuts", title: "Keyboard shortcuts", group: "Help", run: () => fire(OPEN_SHORTCUTS) });

registerCommand({ id: "open-settings", title: "Open settings", group: "Settings", run: () => openAppSettingsTab() });
registerCommand({ id: "open-cookies", title: "Open cookies", group: "Settings", run: () => openCookiesTab() });
registerCommand({ id: "open-keybindings", title: "Open keybindings file", group: "Settings", run: () => api.openKeybindings().catch((err) => toast(String(err), "error")) });
registerCommand({ id: "reload-keybindings", title: "Reload keybindings", group: "Settings", run: () => fire(RELOAD_KEYBINDINGS) });
