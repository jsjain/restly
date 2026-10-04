import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cookie, Download, Folder, Globe, Info, Layers, Play, Plug, Plus, SlidersHorizontal, Terminal, X } from "lucide-react";
import * as api from "../api";
import {
  state,
  setActiveTab,
  tabDirty,
  ago,
  refreshWorkspace,
  openDraftTab,
  toast,
  findFileRef,
  getCollection,
  getEnvironment,
  setSelectedEnv,
  selectedEnv,
  envOwner,
  usableEnvs,
  openCollectionTab,
  openCookiesTab,
  openAppSettingsTab,
} from "../store";
import type { Tab } from "../store";
import type { FileRef } from "../types";
import { itemAt } from "../tree";
import { isWebSocket } from "../websocket";
import { methodClass } from "../method";
import RequestTab from "./RequestTab";
import WebSocketTab from "./WebSocketTab";
import SettingsTab from "./SettingsTab";
import EnvironmentTab from "./EnvironmentTab";
import RunnerTab from "./RunnerTab";
import CookiesTab from "./CookiesTab";
import AppSettingsTab from "./AppSettingsTab";
import ErrorBoundary from "./ErrorBoundary";
import TabContextMenu from "./TabContextMenu";
import { requestClose } from "../tabActions";
import { IMPORT_CURL, OPEN_PALETTE, OPEN_SHORTCUTS, listCommands } from "../commands";
import { Kbd } from "./Kbd";
import type { HistoryEntry } from "../types";
import { requestTitle } from "../requestName";

// tabKey identifies a tab's on-screen identity: distinct kind/file/path combos must get a
// fresh component instance (and a fresh CodeEditor view), or switching tabs can dispatch
// one request's text into another's editor. Drafts all share file "" and path [], so they
// key off their own id instead.
function tabKey(tab: Tab): string {
  if (tab.kind === "request" && tab.file === "") return `draft:${tab.id}`;
  return `${tab.kind}:${tab.file}:${tab.path.join(",")}`;
}

function tabLabel(tab: Tab): string {
  if (tab.kind === "cookies") return "Cookies";
  if (tab.kind === "appsettings") return "Settings";
  if (tab.kind === "request" && tab.file === "") return requestTitle(tab.draft);
  if (tab.kind === "environment") {
    return getEnvironment(tab.file)?.name ?? findFileRef("environment", tab.file)?.name ?? "Environment";
  }
  const collName = getCollection(tab.file)?.info.name ?? findFileRef("collection", tab.file)?.name ?? "Collection";
  if (tab.kind === "collection") return collName;
  if (tab.kind === "runner") return `Run: ${collName}`;
  const coll = getCollection(tab.file);
  const item = coll ? itemAt(coll, tab.path) : undefined;
  return item?.name ?? "Request";
}

function requestTabItem(tab: Tab) {
  if (tab.kind !== "request") return undefined;
  if (tab.file === "") return tab.draft;
  const coll = getCollection(tab.file);
  return coll ? itemAt(coll, tab.path) : undefined;
}

const SHORT_METHOD: Record<string, string> = { DELETE: "DEL", OPTIONS: "OPT" };

const KIND_ICONS = {
  collection: Layers,
  folder: Folder,
  environment: Globe,
  runner: Play,
  appsettings: SlidersHorizontal,
  cookies: Cookie,
};

// tabBadge is the method tag before a request tab's name: the HTTP method or WS. Other tabs show a kind icon.
function tabBadge(tab: Tab): { label: string; className: string } | undefined {
  if (tab.kind !== "request") return undefined;
  const item = requestTabItem(tab);
  if (isWebSocket(item)) return { label: "WS", className: "method-ws" };
  const method = item?.request?.method;
  return method ? { label: SHORT_METHOD[method] ?? method, className: `method-${methodClass(method)}` } : undefined;
}

function EnvPicker() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  // Closes on Escape, an outside press, window blur, or any modal-opening command.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) close();
    };
    const events = [OPEN_PALETTE, OPEN_SHORTCUTS, IMPORT_CURL];
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("click", close);
    window.addEventListener("blur", close);
    events.forEach((n) => window.addEventListener(n, close));
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      events.forEach((n) => window.removeEventListener(n, close));
    };
  }, [open]);

  // Requests pick from their collection's environments plus the shared ones; drafts only see shared ones.
  const owner = envOwner();
  const envs = usableEnvs(owner);
  const current = selectedEnv(owner);
  const own = envs.filter((e) => owner !== "" && e.collection === owner);
  const shared = envs.filter((e) => !own.includes(e));
  const currentRef = envs.find((e) => e.file === current);
  const label = currentRef ? getEnvironment(currentRef.file)?.name ?? currentRef.name : "No environment";
  const collName = owner ? getCollection(owner)?.info.name ?? findFileRef("collection", owner)?.name : undefined;

  function choose(file: string) {
    setSelectedEnv(owner, file);
    setOpen(false);
  }

  function option(ref: FileRef) {
    return (
      <button key={ref.file} type="button" role="option" aria-selected={current === ref.file} onClick={() => choose(ref.file)}>
        <span className="menu-item-main">
          <span className="menu-check">{current === ref.file ? <Check size={14} strokeWidth={2} /> : null}</span>
          {getEnvironment(ref.file)?.name ?? ref.name}
        </span>
      </button>
    );
  }

  return (
    <div className="menu-anchor" ref={anchor}>
      <button
        type="button"
        className="ghost env-picker-trigger"
        title={collName ? `Environment for ${collName}` : "Environment"}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className={`env-dot${current ? " env-dot-active" : ""}`} />
        <span className="env-picker-label">{label}</span>
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="menu env-picker-menu" role="listbox" onClick={(e) => e.stopPropagation()}>
          <div className="env-picker-head">
            Switch environment
            <Kbd command="switch-environment" />
          </div>
          {own.length > 0 ? <div className="menu-label">{collName}</div> : null}
          {own.map(option)}
          {owner && shared.length > 0 ? <div className="menu-label">Shared</div> : null}
          {shared.map(option)}
          <div className="menu-separator" />
          <button type="button" role="option" aria-selected={!current} onClick={() => choose("")}>
            <span className="menu-item-main">
              <span className="menu-check">{!current ? <Check size={14} strokeWidth={2} /> : null}</span>
              No environment
            </span>
          </button>
          {owner ? (
            <>
              <div className="menu-separator" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openCollectionTab(owner, "environments");
                }}
              >
                <span className="menu-item-main">
                  <SlidersHorizontal size={14} strokeWidth={1.75} />
                  Manage environments
                </span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function runCommand(id: string) {
  listCommands().find((c) => c.id === id)?.run();
}

async function importPostman() {
  try {
    await api.importFiles();
  } catch (err) {
    toast(String(err), "error");
  } finally {
    await refreshWorkspace();
  }
}

const WELCOME_ACTIONS = [
  { icon: Plus, label: "New HTTP request", desc: "Compose a REST or GraphQL request and send it.", command: "new-http-request" },
  { icon: Plug, label: "New WebSocket request", desc: "Open a socket and exchange messages live.", command: "new-websocket-request" },
  { icon: Terminal, label: "Import cURL", desc: "Paste a command to turn it into a request.", command: "import-curl" },
  { icon: Download, label: "Import Postman collection", desc: "Bring in a v2.1 or v2.0 collection file.", run: importPostman },
];

const WELCOME_TIPS = [
  { label: "Command palette", command: "command-palette" },
  { label: "Quick open", command: "quick-open-request" },
  { label: "Switch environment", command: "switch-environment" },
  { label: "All shortcuts", command: "keyboard-shortcuts" },
];

function entryName(entry: HistoryEntry): { text: string; path: boolean } {
  if (entry.item.name) return { text: entry.item.name, path: false };
  try {
    const u = new URL(entry.url);
    return { text: u.pathname + u.search, path: true };
  } catch {
    return { text: entry.url || "Request", path: true };
  }
}

function statusTag(entry: HistoryEntry): { text: string; kind: string } | undefined {
  if (entry.code === 0) return entry.error ? { text: "ERR", kind: "err" } : undefined;
  const kind = entry.code >= 500 ? "err" : entry.code >= 400 ? "warn" : entry.code >= 300 ? "info" : "ok";
  return { text: String(entry.code), kind };
}

function Welcome() {
  const recent = state.history.slice(0, 5);
  return (
    <div className="welcome">
      <div className="welcome-box">
        <header className="welcome-head">
          <h1>Start a request</h1>
          <p>
            {recent.length > 0
              ? "Pick up where you left off, or start something new."
              : "Send an HTTP or WebSocket request, or bring in requests you already have."}
          </p>
        </header>

        <div className="welcome-tiles">
          {WELCOME_ACTIONS.map(({ icon: Icon, label, desc, command, run }) => (
            <button key={label} type="button" className="welcome-tile" onClick={() => (run ? void run() : runCommand(command!))}>
              <span className="welcome-tile-icon">
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="welcome-tile-text">
                <span className="welcome-tile-title">{label}</span>
                <span className="welcome-tile-desc">{desc}</span>
              </span>
              {command ? <Kbd command={command} /> : null}
            </button>
          ))}
        </div>

        {recent.length > 0 ? (
          <section className="welcome-section">
            <h2>Recent</h2>
            <div className="welcome-recent">
              {recent.map((entry) => {
                const name = entryName(entry);
                const tag = statusTag(entry);
                const ws = entry.method === "WS" || isWebSocket(entry.item);
                const method = ws ? "WS" : SHORT_METHOD[entry.method] ?? entry.method;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="recent-row"
                    title={entry.error || entry.url}
                    onClick={() => openDraftTab(structuredClone(entry.item))}
                  >
                    <span className={`tab-badge method-${ws ? "ws" : methodClass(entry.method)}`}>{method}</span>
                    <span className={`welcome-label${name.path ? " mono" : ""}`}>{name.text}</span>
                    {tag ? <span className={`tag ${tag.kind}`}>{tag.text}</span> : null}
                    <span className="recent-time tnum">{ago(Date.now() - entry.time)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <footer className="welcome-foot">
          <div className="welcome-tips">
            {WELCOME_TIPS.map(({ label, command }) => (
              <button key={command} type="button" className="welcome-tip" onClick={() => runCommand(command)}>
                <Kbd command={command} />
                {label}
              </button>
            ))}
          </div>
          <div className="welcome-hint">
            <Info size={13} strokeWidth={1.75} aria-hidden="true" />
            Paste a cURL command into any URL field to convert it.
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function Tabs() {
  const [menu, setMenu] = useState<{ tab: Tab; x: number; y: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // The strip has no scrollbar, so a tab opened or switched to off screen must be scrolled to.
  useEffect(() => {
    stripRef.current?.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.activeTab, state.tabs.length]);

  return (
    <div className="main">
      <div className="tabbar">
        <div
          className="tabbar-tabs"
          ref={stripRef}
          onWheel={(e) => {
            // A mouse wheel only scrolls vertically, which this strip cannot do.
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {state.tabs.map((tab) => {
            const badge = tabBadge(tab);
            const KindIcon = tab.kind === "request" ? null : KIND_ICONS[tab.kind];
            return (
              <div
                key={tabKey(tab)}
                className={`tab ${tab === state.activeTab ? "active" : ""}${tabDirty(tab) ? " dirty" : ""}`}
                title={tabLabel(tab)}
                onClick={() => setActiveTab(tab)}
                onAuxClick={(e) => {
                  if (e.button === 1) requestClose(tab);
                }}
                onMouseDown={(e) => {
                  // Middle-button down would otherwise start autoscroll.
                  if (e.button === 1) e.preventDefault();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ tab, x: e.clientX, y: e.clientY });
                }}
              >
                {badge ? <span className={`tab-badge ${badge.className}`}>{badge.label}</span> : null}
                {KindIcon ? <KindIcon className="tab-kind" size={13} strokeWidth={1.75} aria-hidden="true" /> : null}
                <span className="tab-label">{tabLabel(tab)}</span>
                <span className="tab-end">
                  {tabDirty(tab) ? <span className="dot" title="Unsaved changes" /> : null}
                  <span
                    className="close"
                    role="button"
                    aria-label="Close tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      requestClose(tab);
                    }}
                  >
                    <X size={14} strokeWidth={2} />
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <button className="icon tab-new" title="New HTTP request" aria-label="New HTTP request" onClick={() => runCommand("new-http-request")}>
          <Plus size={15} strokeWidth={1.75} />
        </button>
        <div className="tabbar-actions">
          <EnvPicker />
          <span className="tabbar-actions-sep" />
          <button className="icon" title="Cookies" aria-label="Cookies" onClick={() => openCookiesTab()}>
            <Cookie size={15} strokeWidth={1.75} />
          </button>
          <button className="icon" title="Settings" aria-label="Settings" onClick={() => openAppSettingsTab()}>
            <SlidersHorizontal size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {menu ? <TabContextMenu tab={menu.tab} x={menu.x} y={menu.y} onClose={() => setMenu(null)} /> : null}
      <div className="tab-content">
        <ErrorBoundary resetKey={state.activeTab}>
          {state.activeTab?.kind === "request" ? (
            isWebSocket(requestTabItem(state.activeTab)) ? (
              <WebSocketTab key={tabKey(state.activeTab)} tab={state.activeTab} />
            ) : (
              <RequestTab key={tabKey(state.activeTab)} tab={state.activeTab} />
            )
          ) : null}
          {state.activeTab?.kind === "collection" || state.activeTab?.kind === "folder" ? (
            <SettingsTab key={tabKey(state.activeTab)} tab={state.activeTab} />
          ) : null}
          {state.activeTab?.kind === "environment" ? (
            <EnvironmentTab key={tabKey(state.activeTab)} tab={state.activeTab} />
          ) : null}
          {state.activeTab?.kind === "runner" ? <RunnerTab key={tabKey(state.activeTab)} tab={state.activeTab} /> : null}
          {state.activeTab?.kind === "cookies" ? <CookiesTab key={tabKey(state.activeTab)} /> : null}
          {state.activeTab?.kind === "appsettings" ? <AppSettingsTab key={tabKey(state.activeTab)} /> : null}
          {!state.activeTab ? <Welcome /> : null}
        </ErrorBoundary>
      </div>
    </div>
  );
}
