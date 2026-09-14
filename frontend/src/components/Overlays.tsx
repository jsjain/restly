// Single component App renders once, at the end of its JSX. Installs the global keyboard
// shortcut listener for the app's lifetime and renders whichever overlay is currently open.
//
// ============================== Integration steps ==============================
//
// 1. App.tsx
//    - Import and render <Overlays /> once, anywhere in the tree (e.g. right after <Toasts />).
//    - Delete the whole `useEffect` that adds the Cmd/Ctrl+S `keydown` listener (lines ~31-47):
//      commands.ts's "save" command (mod+s) replaces it, and having both fire would double-save.
//    - Render the unsaved-draft close prompt, which currently has no renderer anywhere:
//        {state.confirmClose ? <ConfirmCloseModal tab={state.confirmClose} /> : null}
//      (tabActions.requestClose sets state.confirmClose; nothing shows it today.)
//
// 2. Tabs.tsx — middle-click close and right-click menu on each tab `div`:
//      const [menu, setMenu] = useState<{ tab: Tab; x: number; y: number } | null>(null);
//      <div
//        onAuxClick={(e) => { if (e.button === 1) requestClose(tab); }}
//        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }} // stop autoscroll
//        onContextMenu={(e) => { e.preventDefault(); setMenu({ tab, x: e.clientX, y: e.clientY }); }}
//        ...
//      {menu ? <TabContextMenu tab={menu.tab} x={menu.x} y={menu.y} onClose={() => setMenu(null)} /> : null}
//    Import `requestClose` from "../tabActions" and `TabContextMenu` from "./TabContextMenu".
//
// 3. RequestTab.tsx (and wherever the WebSocket connect button/handler lives) — replace the
//    Cmd/Ctrl+Enter `keydown` listener (RequestTab.tsx lines ~82-92) with a listener for the
//    SEND event, since commands.ts's "send" command (mod+enter) now owns that shortcut:
//      useEffect(() => {
//        function onSend() { handleSend(); }         // or wsConnect(...) on the WebSocket side
//        window.addEventListener("restly:send", onSend);
//        return () => window.removeEventListener("restly:send", onSend);
//      }, [tab, item]);
//    (Or `import { SEND } from "../commands"` and use that constant instead of the string.)
//    Only the active tab's component should be mounted/listening, which Tabs.tsx already
//    guarantees (it renders just `state.activeTab`), so no extra "am I active" check is needed.
//
// 4. Sidebar.tsx:
//      useEffect(() => {
//        function onToggle() { /* hide/show the sidebar */ }
//        function onFocusSearch() { searchInputRef.current?.focus(); }
//        function onReveal(e: Event) {
//          const { file, path } = (e as CustomEvent<{ file: string; path: number[] }>).detail;
//          // expand state.expandedCollections/expandedItems down to `path` and scroll the row in
//        }
//        window.addEventListener("restly:toggle-sidebar", onToggle);
//        window.addEventListener("restly:focus-sidebar-search", onFocusSearch);
//        window.addEventListener("restly:reveal-in-sidebar", onReveal);
//        return () => { /* remove all three */ };
//      }, []);
//    Sidebar has no search input yet, so "focus sidebar search" has nothing to focus until one
//    is added.
//
// 5. The URL input (in RequestTab.tsx) — listen for FOCUS_URL and call `.focus()` (and
//    probably `.select()`) on the input's ref, only while that tab is active/mounted.
//
// All five event names are exported as constants from "../commands" (FOCUS_URL,
// TOGGLE_SIDEBAR, FOCUS_SIDEBAR_SEARCH, SEND, OPEN_PALETTE, OPEN_SHORTCUTS,
// REVEAL_IN_SIDEBAR) — prefer importing those over retyping the string literals.
// ==================================================================================
import { useEffect, useState } from "react";
import "../overlays.css"; // only import site needed; Vite applies it globally once bundled
import * as api from "../api";
import CommandPalette from "./CommandPalette";
import ConfirmDialog from "./ConfirmDialog";
import ShortcutsHelp from "./ShortcutsHelp";
import { confirmDialog } from "../dialog";
import { installShortcuts } from "../shortcuts";
import { OPEN_PALETTE, OPEN_SHORTCUTS } from "../commands";
import type { PaletteMode } from "../commands";

export default function Overlays() {
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // One capture-phase listener for the app's whole lifetime; installShortcuts() returns its
  // own teardown, so this is StrictMode-safe (mount, unmount, remount just reinstalls it).
  useEffect(() => installShortcuts(), []);

  useEffect(() => {
    function onOpenPalette(e: Event): void {
      const mode = (e as CustomEvent<{ mode: PaletteMode }>).detail?.mode ?? "all";
      setShowHelp(false);
      setPalette(mode);
    }
    function onOpenShortcuts(): void {
      setPalette(null);
      setShowHelp(true);
    }
    window.addEventListener(OPEN_PALETTE, onOpenPalette);
    window.addEventListener(OPEN_SHORTCUTS, onOpenShortcuts);
    return () => {
      window.removeEventListener(OPEN_PALETTE, onOpenPalette);
      window.removeEventListener(OPEN_SHORTCUTS, onOpenShortcuts);
    };
  }, []);

  // Go emits this when the user tries to quit with unsaved changes; it can't just quit,
  // since native OS confirm dialogs are off the table, so it waits for us to ask instead.
  useEffect(() => {
    return api.onQuitRequested(() => {
      confirmDialog({
        title: "Quit Restly?",
        message: "Some collections, environments, or requests have unsaved changes. Quit without saving?",
        confirmLabel: "Quit",
        cancelLabel: "Cancel",
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        api.quitApp().catch((err) => console.error("failed to quit", err));
      });
    });
  }, []);

  return (
    <>
      {palette ? <CommandPalette mode={palette} onClose={() => setPalette(null)} /> : null}
      {showHelp ? <ShortcutsHelp onClose={() => setShowHelp(false)} /> : null}
      <ConfirmDialog />
    </>
  );
}
