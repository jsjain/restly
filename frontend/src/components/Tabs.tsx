import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cookie, Settings, X } from "lucide-react";
import {
  state,
  setActiveTab,
  isCollectionDirty,
  isEnvironmentDirty,
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
import TabContextMenu from "./TabContextMenu";
import { requestClose } from "../tabActions";
import { requestTitle } from "../requestName";

function tabDirty(tab: Tab): boolean {
  if (tab.kind === "cookies" || tab.kind === "appsettings") return false;
  if (tab.kind === "request" && tab.file === "") return !!tab.draftDirty;
  return tab.kind === "environment" ? isEnvironmentDirty(tab.file) : isCollectionDirty(tab.file);
}

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

// tabBadge is the short label before a tab's name: the HTTP method, WS, or the kind of page.
function tabBadge(tab: Tab): { label: string; className: string } | undefined {
  if (tab.kind === "request") {
    const item = requestTabItem(tab);
    if (isWebSocket(item)) return { label: "WS", className: "method-ws" };
    const method = item?.request?.method;
    return method ? { label: method, className: `method-${methodClass(method)}` } : undefined;
  }
  if (tab.kind === "environment") return { label: "ENV", className: "tab-badge-muted" };
  if (tab.kind === "runner") return { label: "RUN", className: "tab-badge-muted" };
  return undefined;
}

function EnvPicker() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
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
          <span className="env-dot env-dot-active" />
          {getEnvironment(ref.file)?.name ?? ref.name}
        </span>
        {current === ref.file ? <Check size={14} strokeWidth={2} /> : null}
      </button>
    );
  }

  return (
    <div className="menu-anchor">
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
          <button type="button" role="option" aria-selected={!current} onClick={() => choose("")}>
            <span className="menu-item-main">
              <span className="env-dot" />
              No environment
            </span>
            {!current ? <Check size={14} strokeWidth={2} /> : null}
          </button>
          {own.length > 0 ? <div className="menu-label">{collName}</div> : null}
          {own.map(option)}
          {owner && shared.length > 0 ? <div className="menu-label">Shared</div> : null}
          {shared.map(option)}
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
                Manage environments
              </button>
            </>
          ) : null}
        </div>
      ) : null}
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
            return (
              <div
                key={tabKey(tab)}
                className={`tab ${tab === state.activeTab ? "active" : ""}`}
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
                <span className="tab-label">{tabLabel(tab)}</span>
                {tabDirty(tab) ? <span className="dot" /> : null}
                <span
                  className="close"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestClose(tab);
                  }}
                >
                  <X size={14} strokeWidth={2} />
                </span>
              </div>
            );
          })}
        </div>
        <div className="tabbar-actions">
          <EnvPicker />
          <span className="tabbar-actions-sep" />
          <button className="icon" title="Cookies" aria-label="Cookies" onClick={() => openCookiesTab()}>
            <Cookie size={15} strokeWidth={1.75} />
          </button>
          <button className="icon" title="Settings" aria-label="Settings" onClick={() => openAppSettingsTab()}>
            <Settings size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {menu ? <TabContextMenu tab={menu.tab} x={menu.x} y={menu.y} onClose={() => setMenu(null)} /> : null}
      <div className="tab-content">
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
        {!state.activeTab ? <div className="empty-state">Open a request from the sidebar to get started.</div> : null}
      </div>
    </div>
  );
}
