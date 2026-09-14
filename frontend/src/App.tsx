import { useEffect, useState, useSyncExternalStore } from "react";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import Toasts from "./components/Toasts";
import SaveRequestModal from "./components/SaveRequestModal";
import ConfirmCloseModal from "./components/ConfirmCloseModal";
import Overlays from "./components/Overlays";
import { TOGGLE_SIDEBAR } from "./commands";
import { initKeybindings } from "./keybindings";
import "./panels.css";
import { loadWorkspace, state, subscribe, getVersion, toast, startEvents, loadHistory } from "./store";

// macOS draws the traffic lights over the webview (hidden title bar), so the first row leaves room for them.
const isMac = navigator.userAgent.includes("Mac");

export default function App() {
  // ponytail: one root subscription, whole tree re-renders per store bump; move to
  // per-component subscriptions if typing lags with a large expanded sidebar tree.
  useSyncExternalStore(subscribe, getVersion);
  const [sidebarHidden, setSidebarHidden] = useState(false);

  useEffect(() => {
    startEvents();
    loadWorkspace().catch((err) => toast(String(err), "error"));
    loadHistory().catch((err) => toast(String(err), "error"));
  }, []);

  // keybindings.json overrides the registerCommand defaults; load at startup and again
  // whenever the window regains focus (e.g. after editing it in the system text editor).
  useEffect(() => initKeybindings(), []);

  // Keyboard shortcuts, including Cmd/Ctrl+S, live in commands.ts and are installed by Overlays.
  useEffect(() => {
    const toggle = () => setSidebarHidden((hidden) => !hidden);
    window.addEventListener(TOGGLE_SIDEBAR, toggle);
    return () => window.removeEventListener(TOGGLE_SIDEBAR, toggle);
  }, []);

  const classes = [isMac ? "platform-mac" : "", sidebarHidden ? "sidebar-hidden" : ""].filter(Boolean).join(" ");

  return (
    <div id="app" className={classes}>
      <div className="app-body">
        <Sidebar />
        <Tabs />
      </div>
      <Toasts />
      <Overlays />
      {state.savingDraft ? <SaveRequestModal tab={state.savingDraft} /> : null}
      {state.confirmClose ? <ConfirmCloseModal tab={state.confirmClose} /> : null}
    </div>
  );
}
