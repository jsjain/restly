import { useEffect, useRef, useState } from "react";
import type { RequestTab as RequestTabState } from "../store";
import {
  state,
  markCollectionDirty,
  notifyChange,
  saveCollectionFile,
  openSaveDraftModal,
  toast,
  getCollection,
  selectedEnv,
} from "../store";
import { itemAt } from "../tree";
import * as api from "../api";
import AuthEditor from "./AuthEditor";
import ScriptEditor from "./ScriptEditor";
import BodyEditor from "./BodyEditor";
import KvTable from "./KvTable";
import ResponsePane from "./ResponsePane";
import SnippetPanel from "./SnippetPanel";
import MethodSelect from "./MethodSelect";
import VarInput from "./VarInput";
import { FOCUS_URL, SEND, TOGGLE_CODE } from "../commands";
import { asUrlValue, pathVarNames, setUrlRaw, syncPathVariables, syncRawFromParams, urlRaw } from "../urlutil";
import type { Item, RequestValue, SendInput } from "../types";
import { formatKeys } from "../shortcuts";
import { listCommands } from "../commands";
import "../codePanel.css";

interface Props {
  tab: RequestTabState;
}

type SubTab = "params" | "headers" | "body" | "auth" | "prerequest" | "tests";

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

const sendKeys = (listCommands().find((c) => c.id === "send")?.keys?.[0] ?? "mod+enter").split("+");

export default function RequestTab({ tab }: Props) {
  const [sub, setSub] = useState<SubTab>("params");
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
    notifyChange();
    try {
      // The selection can change while the request is in flight, so keep the one it ran with.
      const input = { ...buildInput(), id: tab.sendId };
      const result = await api.send(input);
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

  const urlInputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+Enter and Cmd/Ctrl+L are registered in commands.ts. Only the active tab is mounted, so it alone listens.
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
    window.addEventListener(FOCUS_URL, focusUrl);
    window.addEventListener(TOGGLE_CODE, toggleCode);
    return () => {
      window.removeEventListener(SEND, send);
      window.removeEventListener(FOCUS_URL, focusUrl);
      window.removeEventListener(TOGGLE_CODE, toggleCode);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, item]);

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

  return (
    <div className="code-panel-row">
      <div className="split">
        <div className="split-top">
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
            {tab.sending ? (
              <button className="send-button" onClick={() => tab.sendId && api.cancelSend(tab.sendId)}>
                Cancel
              </button>
            ) : (
              <button className="primary send-button" onClick={handleSend}>
                Send
              </button>
            )}
            <button onClick={handleSave}>Save</button>
            <button
              className={`ghost${tab.showSnippet ? " active" : ""}`}
              aria-pressed={tab.showSnippet}
              onClick={() => {
                tab.showSnippet = !tab.showSnippet;
                notifyChange();
              }}
            >
              Code
            </button>
          </div>

          <div className="subtabs">
            {(["params", "headers", "body", "auth", "prerequest", "tests"] as SubTab[]).map((s) => {
              const count =
                s === "headers"
                  ? enabledCount(req.header)
                  : s === "params"
                    ? enabledCount(asUrlValue(item).query)
                    : undefined;
              const dot = (s === "body" && hasBody(req)) || (s === "prerequest" && scriptNonEmpty(item, "prerequest")) || (s === "tests" && scriptNonEmpty(item, "test"));
              return (
                <button key={s} className={sub === s ? "active" : ""} onClick={() => setSub(s)}>
                  {SUBTAB_LABEL[s]}
                  {count ? <span className="subtab-count">{count}</span> : null}
                  {dot ? <span className="subtab-dot" /> : null}
                </button>
              );
            })}
          </div>

          <div className="subtab-body">
            {sub === "params" ? <ParamsPanel item={item} onChange={edit} /> : null}
            {sub === "headers" ? <KvTable rows={(req.header ??= [])} onChange={edit} label="header" /> : null}
            {sub === "body" ? <BodyEditor item={item} onChange={edit} /> : null}
            {sub === "auth" ? <AuthEditor target={req} onChange={edit} hideInherit={isDraft} /> : null}
            {sub === "prerequest" ? (
              <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                <ScriptEditor target={item} listen="prerequest" onChange={edit} />
              </div>
            ) : null}
            {sub === "tests" ? (
              <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                <ScriptEditor target={item} listen="test" onChange={edit} />
              </div>
            ) : null}
          </div>
        </div>

        {tab.sendResult ? (
          <ResponsePane tab={tab} result={tab.sendResult} onChange={notifyChange} />
        ) : (
          <div className="split-bottom empty-state">
            <span>Send a request to see the response.</span>
            <span className="hint-keys">{formatKeys(sendKeys)} to send</span>
          </div>
        )}
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

export function ParamsPanel({ item, onChange }: { item: Item; onChange: () => void }) {
  const url = asUrlValue(item);
  const names = pathVarNames(url.raw);

  function onParamsChange() {
    syncRawFromParams(url);
    onChange();
  }

  if (names.length > 0) syncPathVariables(url);

  return (
    <div>
      <KvTable rows={(url.query ??= [])} onChange={onParamsChange} label="param" />
      {names.length > 0 ? (
        <>
          <div className="hint" style={{ marginTop: 12 }}>
            Path Variables
          </div>
          <table className="kv-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {(url.variable ?? []).map((v, i) => (
                <tr key={i}>
                  <td className="mono">{v.key}</td>
                  <td>
                    <input
                      type="text"
                      className="mono"
                      value={v.value ?? ""}
                      onChange={(e) => {
                        v.value = e.target.value;
                        onChange();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
