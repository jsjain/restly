import { useEffect, useState } from "react";
import { Cookie, Layers, Shield } from "lucide-react";
import * as api from "../api";
import type { Network } from "../types";
import { state, tabDirty, ago, getCollection, findFileRef } from "../store";
import { lastAutosaveAt, onAutosaved } from "../autosave";
import { listCommands, SETTINGS_SAVED } from "../commands";
import { effectiveKeys, formatKeys } from "../shortcuts";

// An auto-save is mentioned for this long, then the file just reads "Saved".
const AUTOSAVE_SHOWN_MS = 5 * 60 * 1000;

// Re-renders every second while active, so relative times advance.
function useTicker(active: boolean): void {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setN((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

function proxyLabel(settings: Network): string {
  if (settings.proxyMode === "none") return "No proxy";
  if (settings.proxyMode === "environment") return "Proxy: environment";
  try {
    return `Proxy: ${new URL(settings.proxyUrl).host}`;
  } catch {
    return `Proxy: ${settings.proxyUrl}`;
  }
}

// Settings and the cookie count are re-read on window focus, after Settings saves, when the active
// tab changes and, for cookies, after each history entry.
function useBackend() {
  const [proxy, setProxy] = useState<string>("No proxy");
  const [cookies, setCookies] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    window.addEventListener(SETTINGS_SAVED, onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(SETTINGS_SAVED, onFocus);
    };
  }, []);
  const refresh = `${tick}:${state.history[0]?.id ?? ""}:${state.tabs.indexOf(state.activeTab!)}`;
  useEffect(() => {
    api.getSettings().then((s) => setProxy(proxyLabel(s.network))).catch(() => {});
    api.listCookies().then((c) => setCookies(c.length)).catch(() => {});
  }, [refresh]);
  return { proxy, cookies };
}

function useSaveState(): string {
  const tab = state.activeTab;
  const [, rerender] = useState(0);
  useEffect(() => onAutosaved(() => rerender((n) => n + 1)), []);
  const file = tab?.file ?? "";
  const saved = file ? lastAutosaveAt(file) : undefined;
  const age = saved === undefined ? Infinity : Date.now() - saved;
  useTicker(age < AUTOSAVE_SHOWN_MS);
  if (!tab) return "Nothing open";
  if (tabDirty(tab)) return "Unsaved changes";
  if (tab.kind === "cookies" || tab.kind === "appsettings") return "";
  if (!file) return "Draft";
  return age < AUTOSAVE_SHOWN_MS ? `Auto-saved ${ago(age)}` : "Saved";
}

function collectionName(): string | undefined {
  const tab = state.activeTab;
  if (!tab?.file) return undefined;
  const collFile = tab.kind === "environment" ? findFileRef("environment", tab.file)?.collection : tab.file;
  if (!collFile) return undefined;
  return getCollection(collFile)?.info.name ?? findFileRef("collection", collFile)?.name;
}

export default function StatusBar() {
  const { proxy, cookies } = useBackend();
  const saveState = useSaveState();
  const palette = listCommands().find((c) => c.id === "command-palette");
  const chord = palette ? effectiveKeys(palette)[0] : undefined;
  return (
    <div className="statusbar">
      <span>
        <Layers size={12} strokeWidth={1.75} aria-hidden="true" />
        {collectionName() ?? "No collection"}
      </span>
      {saveState ? <span className="tnum">{saveState}</span> : null}
      <span className="statusbar-grow" />
      <span>
        <Shield size={12} strokeWidth={1.75} aria-hidden="true" />
        {proxy}
      </span>
      <span className="tnum">
        <Cookie size={12} strokeWidth={1.75} aria-hidden="true" />
        {cookies} {cookies === 1 ? "cookie" : "cookies"}
      </span>
      <button type="button" className="statusbar-btn" onClick={() => palette?.run()}>
        {chord ? `${formatKeys(chord.split("+"))} ` : ""}Commands
      </button>
    </div>
  );
}
