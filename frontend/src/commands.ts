// Command registry: every keyboard shortcut and command-palette row is one of these. UI
// pieces that don't exist yet (URL input, sidebar, overlays) are reached through window
// CustomEvents instead of direct imports, so this module doesn't need to know about them.
import { state, openDraftTab, openAppSettingsTab, openCookiesTab, openSaveDraftModal, saveCollectionFile, saveEnvironmentFile, selectedEnv, toast } from "./store";
import { newWebSocketItem } from "./websocket";
import { requestClose, reopenClosed, nextTab, goToTab, closeAll, closeOthers, duplicateTab, tabItem } from "./tabActions";
import * as api from "./api";
import defaultKeybindings from "./keybindings.default.json";

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
// RequestTab/WebSocketTab: SEND.
export const FOCUS_URL = "restly:focus-url";
export const TOGGLE_SIDEBAR = "restly:toggle-sidebar";
export const FOCUS_SIDEBAR_SEARCH = "restly:focus-sidebar-search";
export const SEND = "restly:send";
export const OPEN_PALETTE = "restly:open-palette"; // detail: { mode: PaletteMode }
export const OPEN_SHORTCUTS = "restly:open-shortcuts";
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

registerCommand({ id: "send", title: "Send Request", group: "Request", when: isActiveRequestTab, run: () => fire(SEND) });
registerCommand({ id: "save", title: "Save", group: "Request", when: hasActiveTab, run: runSave });
registerCommand({ id: "copy-curl", title: "Copy as cURL", group: "Request", when: isActiveRequestTab, run: () => void copyAsCurl() });
registerCommand({ id: "format-body", title: "Format Body", group: "Request", when: isActiveRequestTab, run: () => fire(FORMAT_BODY) });

registerCommand({ id: "new-http-request", title: "New HTTP Request", group: "Tabs", run: () => openDraftTab() });
registerCommand({ id: "import-curl", title: "Import cURL", group: "Tabs", run: () => fire(IMPORT_CURL) });
registerCommand({ id: "new-websocket-request", title: "New WebSocket Request", group: "Tabs", run: () => openDraftTab(newWebSocketItem()) });
registerCommand({ id: "close-tab", title: "Close Tab", group: "Tabs", when: hasActiveTab, run: () => requestClose(state.activeTab!) });
registerCommand({ id: "reopen-closed-tab", title: "Reopen Closed Tab", group: "Tabs", run: reopenClosed });
registerCommand({ id: "next-tab", title: "Next Tab", group: "Tabs", run: () => nextTab(1) });
registerCommand({ id: "prev-tab", title: "Previous Tab", group: "Tabs", run: () => nextTab(-1) });
registerCommand({ id: "duplicate-tab", title: "Duplicate Tab", group: "Tabs", when: isActiveRequestTab, run: () => duplicateTab(state.activeTab!) });
registerCommand({ id: "close-all-tabs", title: "Close All Tabs", group: "Tabs", run: closeAll });
registerCommand({ id: "close-other-tabs", title: "Close Other Tabs", group: "Tabs", when: hasActiveTab, run: () => closeOthers(state.activeTab!) });

for (let i = 1; i <= 8; i++) {
  registerCommand({
    id: `go-to-tab-${i}`,
    title: `Go to Tab ${i}`,
    group: "Tabs",
    when: () => state.tabs.length >= i,
    run: () => goToTab(i - 1),
  });
}
registerCommand({ id: "go-to-last-tab", title: "Go to Last Tab", group: "Tabs", when: () => state.tabs.length > 0, run: () => goToTab(state.tabs.length - 1) });

registerCommand({ id: "focus-url", title: "Focus URL", group: "Navigation", when: isActiveRequestTab, run: () => fire(FOCUS_URL) });
registerCommand({ id: "command-palette", title: "Command Palette", group: "Navigation", run: () => fire(OPEN_PALETTE, { mode: "all" as PaletteMode }) });
registerCommand({ id: "quick-open-request", title: "Quick Open Request", group: "Navigation", run: () => fire(OPEN_PALETTE, { mode: "requests" as PaletteMode }) });
registerCommand({ id: "switch-environment", title: "Switch Environment", group: "Navigation", run: () => fire(OPEN_PALETTE, { mode: "environments" as PaletteMode }) });

registerCommand({ id: "toggle-sidebar", title: "Toggle Sidebar", group: "View", run: () => fire(TOGGLE_SIDEBAR) });
registerCommand({ id: "focus-sidebar-search", title: "Focus Sidebar Search", group: "View", run: () => fire(FOCUS_SIDEBAR_SEARCH) });
registerCommand({ id: "focus-sidebar", title: "Focus Sidebar", group: "View", run: () => fire(FOCUS_SIDEBAR) });
registerCommand({ id: "toggle-code-panel", title: "Toggle Code Panel", group: "View", when: isActiveRequestTab, run: () => fire(TOGGLE_CODE) });

registerCommand({ id: "keyboard-shortcuts", title: "Keyboard Shortcuts", group: "Help", run: () => fire(OPEN_SHORTCUTS) });

registerCommand({ id: "open-settings", title: "Open Settings", group: "Settings", run: () => openAppSettingsTab() });
registerCommand({ id: "open-cookies", title: "Open Cookies", group: "Settings", run: () => openCookiesTab() });
registerCommand({ id: "open-keybindings", title: "Open Keybindings File", group: "Settings", run: () => api.openKeybindings().catch((err) => toast(String(err), "error")) });
registerCommand({ id: "reload-keybindings", title: "Reload Keybindings", group: "Settings", run: () => fire(RELOAD_KEYBINDINGS) });
