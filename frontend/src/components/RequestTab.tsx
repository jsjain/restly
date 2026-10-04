import { useEffect, useRef, useState } from "react";
import { ChevronRight, Code, Save, Square } from "lucide-react";
import type { RequestSubTab as SubTab, RequestTab as RequestTabState } from "../store";
import {
  state,
  markCollectionDirty,
  notifyChange,
  saveCollectionFile,
  openSaveDraftModal,
  openAppSettingsTab,
  toast,
  getCollection,
  selectedEnv,
} from "../store";
import { itemAt } from "../tree";
import { inheritedAuth } from "../authInherit";
import * as api from "../api";
import AuthEditor from "./AuthEditor";
import ScriptEditor from "./ScriptEditor";
import BodyEditor from "./BodyEditor";
import { Kbd } from "./Kbd";
import KvTable, { KvBulkEdit } from "./KvTable";
import ResponsePane, { sendDuration, sendStarted } from "./ResponsePane";
import SnippetPanel from "./SnippetPanel";
import MethodSelect from "./MethodSelect";
import VarInput from "./VarInput";
import { CANCEL_SEND, FOCUS_URL, SEND, TOGGLE_CODE } from "../commands";
import { asUrlValue, pathVarNames, setUrlRaw, syncPathVariables, syncRawFromParams, urlRaw } from "../urlutil";
import type { Item, RequestValue, SendInput } from "../types";
import { requestTitle } from "../requestName";
import "../codePanel.css";
import { readDescription, setRowDescription } from "../description";

interface Props {
  tab: RequestTabState;
}

const SUBTAB_LABEL: Record<SubTab, string> = {
  params: "Params",
  headers: "Headers",
  body: "Body",
  auth: "Auth",
  prerequest: "Pre-request",
  tests: "Post-response",
};

function enabledCount(rows: { disabled?: boolean }[] | undefined): number {
  return (rows ?? []).filter((r) => !r.disabled).length;
}

function hasBody(req: RequestValue): boolean {
  const body = req.body;
  if (!body) return false;
  if (body.mode === "raw") return !!body.raw;
  if (body.mode === "urlencoded") return (body.urlencoded ?? []).length > 0;
  if (body.mode === "formdata") return (body.formdata ?? []).length > 0;
  if (body.mode === "file") return !!body.file?.src;
  if (body.mode === "graphql") return !!body.graphql?.query;
  return false;
}

function scriptNonEmpty(item: Item, listen: "prerequest" | "test"): boolean {
  const entry = (item.event ?? []).find((e) => e.listen === listen);
  const exec = entry?.script?.exec;
  if (!exec) return false;
  return Array.isArray(exec) ? exec.some((line) => line.trim() !== "") : exec.trim() !== "";
}

const AUTH_LABEL: Record<string, string> = {
  inherit: "Inherit",
  noauth: "None",
  basic: "Basic",
  bearer: "Bearer",
  apikey: "API key",
};

// The request pane's share of the split, kept across tabs and requests.
let splitPct = 50;

export default function RequestTab({ tab }: Props) {
  const sub = tab.requestSub ?? "params";
  const isDraft = tab.file === "";
  const coll = isDraft ? undefined : getCollection(tab.file);
  const item = isDraft ? tab.draft : coll ? itemAt(coll, tab.path) : undefined;

  function edit() {
    if (isDraft) {
      tab.draftDirty = true;
      notifyChange();
    } else {
      markCollectionDirty(tab.file);
    }
  }

  function buildInput(): SendInput {
    return { file: tab.file, path: tab.path, item, env: selectedEnv(tab.file) };
  }

  async function handleSend() {
    if (!item || !item.request || tab.sending) return;
    tab.sending = true;
    tab.sendId = crypto.randomUUID();
    const started = Date.now();
    sendStarted.set(tab, started);
    notifyChange();
    try {
      // The selection can change while the request is in flight, so keep the one it ran with.
      const input = { ...buildInput(), id: tab.sendId };
      const result = await api.send(input);
      sendDuration.set(result, Date.now() - started);
      tab.sendResult = result;
      if (coll) coll.variable = result.variables;
      if (input.env && result.environment) {
        state.environments.set(input.env, result.environment);
      }
    } catch (err) {
      toast(String(err), "error");
    } finally {
      tab.sending = false;
      tab.sendId = undefined;
      notifyChange();
    }
  }

  async function handleSave() {
    if (isDraft) {
      openSaveDraftModal(tab);
      return;
    }
    try {
      await saveCollectionFile(tab.file);
      toast("Saved");
    } catch (err) {
      toast(String(err), "error");
    }
  }

  function cancelSend() {
    if (tab.sending && tab.sendId) api.cancelSend(tab.sendId);
  }

  const urlInputRef = useRef<HTMLInputElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [topPct, setTopPct] = useState(splitPct);
  // Bulk edit is a view of the Params or Headers table, so each keeps its own mode.
  const [bulk, setBulk] = useState({ params: false, headers: false });

  function resizeTo(pct: number) {
    splitPct = Math.min(Math.max(pct, 15), 85);
    setTopPct(splitPct);
  }

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    const box = splitRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => resizeTo(((ev.clientY - box.top) / box.height) * 100);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Send, Cancel Request and Focus URL are registered in commands.ts. Only the active tab is mounted, so it alone listens.
  useEffect(() => {
    const send = () => handleSend();
    const focusUrl = () => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    };
    const toggleCode = () => {
      tab.showSnippet = !tab.showSnippet;
      notifyChange();
    };
    window.addEventListener(SEND, send);
    window.addEventListener(CANCEL_SEND, cancelSend);
    window.addEventListener(FOCUS_URL, focusUrl);
    window.addEventListener(TOGGLE_CODE, toggleCode);
    return () => {
      window.removeEventListener(SEND, send);
      window.removeEventListener(CANCEL_SEND, cancelSend);
      window.removeEventListener(FOCUS_URL, focusUrl);
      window.removeEventListener(TOGGLE_CODE, toggleCode);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, item]);

  // Escape cancels an in-flight send. This is a bubble-phase listener that skips Escapes something already
  // used (autocomplete, menus, the find widget) and ones aimed at another surface, so those keep closing first.
  useEffect(() => {
    if (!tab.sending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as Element;
      const here =
        rootRef.current?.contains(target) ||
        (target === document.body && !document.querySelector('[role="dialog"], [role="menu"], .modal-overlay'));
      if (!here) return;
      e.preventDefault();
      cancelSend();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tab.sending]);

  if (!isDraft && !coll) return <div className="empty-state">Loading…</div>;
  if (!item || !item.request) return <div className="empty-state">This request was deleted.</div>;
  const req = item.request;

  // A pasted cURL command replaces this request's method/url/header/body/auth in place,
  // keeping the item's name and scripts. Any other paste behaves normally.
  function handleUrlPaste(text: string) {
    if (!/^curl\s/i.test(text.trim())) return false;
    api
      .parseCurl(text)
      .then((parsed) => {
        const p = parsed.request;
        if (!p) return;
        req.method = p.method;
        req.url = p.url;
        req.header = p.header ?? [];
        if (p.body) req.body = p.body;
        else delete req.body;
        if (p.auth) req.auth = p.auth;
        else delete req.auth;
        edit();
      })
      .catch((err) => toast(String(err), "error"));
    return true;
  }

  const crumbs = [
    ...(coll ? [coll.info.name] : ["Draft"]),
    ...tab.path.slice(0, -1).map((_, i) => (coll ? itemAt(coll, tab.path.slice(0, i + 1))?.name ?? "" : "")),
  ].filter(Boolean);
  const authType = req.auth?.type ?? (isDraft ? "noauth" : "inherit");
  const tabs: SubTab[] = ["params", "headers", "body", "auth", "prerequest", "tests"];

  return (
    <div className="code-panel-row" ref={rootRef}>
      <div className="split" ref={splitRef}>
        <div className="split-top" style={{ flexBasis: `${topPct}%` }}>
          <div className="reqname">
            <span className="crumbs">
              {crumbs.map((c, i) => (
                <span key={i} className="crumb">
                  {c}
                  <ChevronRight size={12} aria-hidden="true" />
                </span>
              ))}
              <b>{requestTitle(item)}</b>
            </span>
            <button
              className={`ghost${tab.showSnippet ? " active" : ""}`}
              aria-pressed={tab.showSnippet}
              onClick={() => {
                tab.showSnippet = !tab.showSnippet;
                notifyChange();
              }}
            >
              <Code size={14} aria-hidden="true" />
              Code
              <Kbd command="toggle-code-panel" />
            </button>
            <button className="ghost" onClick={handleSave}>
              <Save size={14} aria-hidden="true" />
              Save
              <Kbd command="save" />
            </button>
          </div>

          <div className="request-toolbar">
            <div className="method-url-group">
              <MethodSelect
                value={req.method}
                onChange={(method) => {
                  req.method = method;
                  edit();
                }}
              />
              <div className="url-field">
                <VarInput
                  value={urlRaw(req.url)}
                  placeholder="https://example.com/path?query=value"
                  className="url-input"
                  inputRef={urlInputRef}
                  onChange={(value) => {
                    setUrlRaw(item, value);
                    edit();
                  }}
                  onPaste={(e) => {
                    if (handleUrlPaste(e.clipboardData.getData("text"))) e.preventDefault();
                  }}
                />
              </div>
            </div>
            {/* One button for both states, so keyboard focus stays on it when a send starts. */}
            <button className={`send-button${tab.sending ? "" : " primary"}`} onClick={tab.sending ? cancelSend : handleSend}>
              {tab.sending ? <Square size={12} fill="currentColor" aria-hidden="true" /> : null}
              {tab.sending ? "Cancel" : "Send"}
              {tab.sending ? <Kbd keys="escape" /> : <Kbd command="send" />}
            </button>
          </div>
          <div className="req-progress" role={tab.sending ? "progressbar" : undefined} aria-label={tab.sending ? "Sending request" : undefined}>
            {tab.sending ? <i /> : null}
          </div>

          <div className="subtabs">
            {tabs.map((s) => {
              const count =
                s === "headers"
                  ? enabledCount(req.header)
                  : s === "params"
                    ? enabledCount(asUrlValue(item).query)
                    : undefined;
              const dot = (s === "body" && hasBody(req)) || (s === "prerequest" && scriptNonEmpty(item, "prerequest")) || (s === "tests" && scriptNonEmpty(item, "test"));
              return (
                <button key={s} className={sub === s ? "active" : ""} onClick={() => { tab.requestSub = s; notifyChange(); }}>
                  {SUBTAB_LABEL[s]}
                  {count ? <span className="subtab-count">{count}</span> : null}
                  {s === "auth" ? <span className="subtab-count">{AUTH_LABEL[authType] ?? authType}</span> : null}
                  {dot ? <span className="subtab-dot" /> : null}
                </button>
              );
            })}
            {sub === "params" || sub === "headers" ? (
              <div className="segmented" role="group" aria-label="Edit mode">
                {([false, true] as const).map((on) => (
                  <button
                    key={String(on)}
                    className={bulk[sub] === on ? "active" : ""}
                    aria-pressed={bulk[sub] === on}
                    onClick={() => setBulk({ ...bulk, [sub]: on })}
                  >
                    {on ? "Bulk edit" : "Table"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="subtab-body req-pane">
            {sub === "params" ? <ParamsPanel item={item} onChange={edit} bulk={bulk.params} /> : null}
            {sub === "headers" ? (
              bulk.headers ? (
                <KvBulkEdit rows={(req.header ??= [])} onChange={edit} label="header" />
              ) : (
                <KvTable rows={(req.header ??= [])} onChange={edit} label="header" description />
              )
            ) : null}
            {sub === "body" ? <BodyEditor item={item} onChange={edit} /> : null}
            {sub === "auth" ? <AuthEditor target={req} onChange={edit} hideInherit={isDraft} inherited={inheritedAuth(tab.file, tab.path)} /> : null}
            {sub === "prerequest" ? (
              <ScriptEditor target={item} listen="prerequest" onChange={edit} />
            ) : null}
            {sub === "tests" ? (
              <ScriptEditor target={item} listen="test" onChange={edit} />
            ) : null}
          </div>
        </div>

        <div
          className="hsplit"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize request and response"
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            resizeTo(topPct + (e.key === "ArrowUp" ? -5 : 5));
          }}
        />

        <ResponsePane tab={tab} onChange={notifyChange} onRetry={handleSend} onOpenSettings={() => openAppSettingsTab()} style={{ flexBasis: `${100 - topPct}%` }} />
      </div>

      {tab.showSnippet ? (
        <SnippetPanel
          tab={tab}
          buildInput={buildInput}
          onChange={notifyChange}
          onClose={() => {
            tab.showSnippet = false;
            notifyChange();
          }}
        />
      ) : null}
    </div>
  );
}

export function ParamsPanel({ item, onChange, bulk }: { item: Item; onChange: () => void; bulk?: boolean }) {
  const url = asUrlValue(item);
  const names = pathVarNames(url.raw);

  function onParamsChange() {
    syncRawFromParams(url);
    onChange();
  }

  if (names.length > 0) syncPathVariables(url);

  if (bulk) return <KvBulkEdit rows={(url.query ??= [])} onChange={onParamsChange} label="param" />;

  return (
    <div>
      <KvTable rows={(url.query ??= [])} onChange={onParamsChange} label="param" description />
      {names.length > 0 ? (
        <>
          <div className="kv-section">Path variables</div>
          <div className="kv-frame">
            <table className="kv-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {(url.variable ?? []).map((v, i) => (
                  <tr key={i}>
                    <td className="mono kv-name">{v.key}</td>
                    <td>
                      <input
                        type="text"
                        className="mono"
                        value={v.value ?? ""}
                        aria-label={`Value of ${v.key}`}
                        onChange={(e) => {
                          v.value = e.target.value;
                          onChange();
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="kv-desc"
                        value={readDescription(v.description)}
                        aria-label={`Description of ${v.key}`}
                        onChange={(e) => {
                          setRowDescription(v, e.target.value);
                          onChange();
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
