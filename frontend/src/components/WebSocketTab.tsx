import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Save, Search, Trash2, TriangleAlert } from "lucide-react";
import type { RequestTab as RequestTabState, WsSubTab as SubTab } from "../store";
import { markCollectionDirty, notifyChange, saveCollectionFile, openSaveDraftModal, toast, getCollection, selectedEnv } from "../store";
import { itemAt } from "../tree";
import { inheritedAuth } from "../authInherit";
import * as api from "../api";
import AuthEditor from "./AuthEditor";
import KvTable from "./KvTable";
import { ParamsPanel } from "./RequestTab";
import { setUrlRaw, urlRaw } from "../urlutil";
import type { WsEvent } from "../types";
import VarInput from "./VarInput";
import { FOCUS_URL, SEND } from "../commands";
import { Kbd } from "./Kbd";

interface Props {
  tab: RequestTabState;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function binaryByteLength(base64: string): number {
  try {
    return atob(base64).length;
  } catch {
    return 0;
  }
}

function isJson(text: string): boolean {
  const t = text.trim();
  if (t[0] !== "{" && t[0] !== "[") return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

// Strings, keys, numbers, literals and punctuation of pretty-printed JSON, in the --syntax-* colors.
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;

function highlightJson(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(JSON_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(line.slice(last, at));
    if (m[1] !== undefined) {
      out.push(<span key={at} className={m[2] ? "tk-property" : "tk-string"}>{m[1]}</span>);
      if (m[2]) out.push(<span key={at + "c"} className="tk-punct">{m[2]}</span>);
    } else {
      const cls = /^[{}[\],:]$/.test(m[0]) ? "tk-punct" : /^-?\d/.test(m[0]) ? "tk-number" : "tk-boolean";
      out.push(<span key={at} className={cls}>{m[0]}</span>);
    }
    last = at + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

// The expanded part of a row: numbered lines in a bordered block, with a Copy button.
function CodeBlock({ text, json }: { text: string; json?: boolean }) {
  return (
    <div className="ws-expanded">
      <button
        className="icon ws-copy"
        aria-label="Copy"
        title="Copy"
        onClick={() => navigator.clipboard.writeText(text).then(() => toast("Copied"), (err) => toast(String(err), "error"))}
      >
        <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <div className="ws-code">
        {text.split("\n").map((line, i) => (
          <div key={i} className="ws-code-line">
            <span className="ws-code-gutter">{i + 1}</span>
            <span>{json ? highlightJson(line) : line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LogRow({ event, expanded, onToggle }: { event: WsEvent; expanded: boolean; onToggle: () => void }) {
  const time = formatTime(event.time);

  let kind: string;
  let icon: ReactNode;
  let label: ReactNode;
  let expand: ReactNode = null; // the block shown when expanded
  let canExpand = true;

  if (event.type === "open") {
    kind = "sys";
    icon = <span className="ws-dot" />;
    label = "Connected";
    canExpand = event.header.length > 0;
    expand = <CodeBlock text={event.header.map((h) => `${h.key}: ${h.value}`).join("\n")} />;
  } else if (event.type === "closed") {
    kind = "sys";
    icon = <span className="ws-dot" />;
    label = `Disconnected (code ${event.code})${event.data ? `: ${event.data}` : ""}`;
    canExpand = false;
  } else if (event.type === "error") {
    kind = "err";
    icon = <TriangleAlert size={14} strokeWidth={1.75} aria-label="Error" />;
    label = event.data;
    expand = <CodeBlock text={event.data} />;
  } else {
    kind = event.type === "sent" ? "sent" : "recv";
    icon =
      event.type === "sent" ? (
        <ArrowUp size={14} strokeWidth={1.75} aria-label="Sent" />
      ) : (
        <ArrowDown size={14} strokeWidth={1.75} aria-label="Received" />
      );
    label = event.binary ? `[binary, ${binaryByteLength(event.data)} bytes]` : event.data;
    if (event.binary) {
      expand = <CodeBlock text={event.data} />;
    } else if (isJson(event.data)) {
      expand = <CodeBlock text={JSON.stringify(JSON.parse(event.data), null, 2)} json />;
    } else {
      expand = <CodeBlock text={event.data} />;
    }
  }

  const open = canExpand && expanded;
  return (
    <>
      <div
        className={`ws-row ws-row-${kind}${open ? " open" : ""}${canExpand ? " expandable" : ""}`}
        role={canExpand ? "button" : undefined}
        tabIndex={canExpand ? 0 : undefined}
        aria-expanded={canExpand ? open : undefined}
        onClick={canExpand ? onToggle : undefined}
        onKeyDown={
          canExpand
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle();
                }
              }
            : undefined
        }
      >
        <span className="ws-row-dir">{icon}</span>
        <span className="ws-row-time">{time}</span>
        <span className="ws-row-body">{label}</span>
        {canExpand ? (
          <span className="ws-row-trail">
            {event.type === "open" ? <span className="ws-handshake-label">Handshake headers</span> : null}
            {open ? <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" /> : <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />}
          </span>
        ) : null}
      </div>
      {open ? expand : null}
    </>
  );
}

function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(total / 3600);
  return `${h ? h + ":" : ""}${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// Live connection state: "Connected 00:42", "Connecting…", or why it ended.
function ConnectionStatus({ status, events }: { status: string; events: WsEvent[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== "open") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  if (status === "open") {
    const opened = events.findLast((e) => e.type === "open");
    return (
      <span className="ws-conn ws-conn-open" role="status">
        <span className="ws-dot" />
        Connected
        {opened ? <span className="tnum ws-conn-time">{elapsed(now - opened.time)}</span> : null}
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="ws-conn" role="status">
        <span className="ws-dot" />
        Connecting…
      </span>
    );
  }
  const end = events.findLast((e) => e.type === "closed" || e.type === "error");
  if (!end) {
    return (
      <span className="ws-conn" role="status">
        <span className="ws-dot ws-dot-off" />
        Disconnected
      </span>
    );
  }
  // A failed handshake closes with code 0 and no reason, so the error before it says why.
  const failure = end.type === "closed" && end.code === 0 && !end.data ? events.findLast((e) => e.type === "error") : undefined;
  // 1000 normal and 1005 no status are clean closes, often the user's own Disconnect.
  if (!failure && end.type === "closed" && (end.code === 1000 || end.code === 1005)) {
    return (
      <span className="ws-conn" role="status">
        <span className="ws-dot ws-dot-off" />
        Disconnected
      </span>
    );
  }
  const text = failure
    ? `Disconnected: ${failure.data}`
    : end.type === "closed"
      ? `Disconnected (code ${end.code})${end.data ? `: ${end.data}` : ""}`
      : `Disconnected: ${end.data}`;
  return (
    <span className="ws-conn ws-conn-error" role="status" title={text}>
      <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" />
      <span className="ws-conn-text">{text}</span>
    </span>
  );
}

export default function WebSocketTab({ tab }: Props) {
  const sub = tab.wsSub ?? "params";
  const [localMessage, setLocalMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const logRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

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

  async function handleConnect() {
    if (!item) return;
    const id = crypto.randomUUID();
    tab.ws = { id, status: "connecting", events: [], message: tab.ws?.message ?? localMessage };
    notifyChange();
    try {
      await api.wsConnect(id, { file: tab.file, path: tab.path, item, env: selectedEnv(tab.file) });
    } catch (err) {
      toast(String(err), "error");
      if (tab.ws?.id === id && tab.ws.status === "connecting") {
        tab.ws.status = "closed";
        notifyChange();
      }
    }
  }

  async function handleDisconnect() {
    if (!tab.ws) return;
    try {
      await api.wsClose(tab.ws.id);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  function setMessage(value: string) {
    if (tab.ws) {
      tab.ws.message = value;
      notifyChange();
    } else {
      setLocalMessage(value);
    }
  }

  async function handleSend() {
    if (!tab.ws || tab.ws.status !== "open") return;
    try {
      await api.wsSend(tab.ws.id, tab.ws.message);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  function handleClearLog() {
    if (tab.ws) tab.ws.events.splice(0, tab.ws.events.length);
    setExpanded(new Set());
    notifyChange();
  }

  function toggle(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const events = tab.ws?.events ?? [];

  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const urlInputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+Enter (commands.ts) connects, or sends the composed message once connected.
  useEffect(() => {
    const send = () => {
      if (tab.ws?.status === "open") handleSend();
      else if (tab.ws?.status !== "connecting") handleConnect();
    };
    const focusUrl = () => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    };
    window.addEventListener(SEND, send);
    window.addEventListener(FOCUS_URL, focusUrl);
    return () => {
      window.removeEventListener(SEND, send);
      window.removeEventListener(FOCUS_URL, focusUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, item]);

  if (!isDraft && !coll) return <div className="empty-state">Loading…</div>;
  if (!item || !item.request) return <div className="empty-state">This request was deleted.</div>;
  const req = item.request;

  const status = tab.ws?.status ?? "closed";
  const message = tab.ws?.message ?? localMessage;
  const lowerFilter = filter.toLowerCase();
  const filtered = events
    .map((e, i) => [i, e] as const)
    .filter(([, e]) => !lowerFilter || e.data.toLowerCase().includes(lowerFilter));
  const crumbs = isDraft || !coll ? [] : [coll.info.name, ...tab.path.slice(0, -1).map((_, i) => itemAt(coll, tab.path.slice(0, i + 1))?.name ?? "")];
  const headerCount = (req.header ?? []).filter((h) => !(h as { disabled?: boolean }).disabled).length;
  const connected = status === "open";

  return (
    <div className="split ws-tab">
      <div className="ws-crumbs">
        <span className="ws-crumb-path">
          {crumbs.map((c, i) => (
            <span key={i} className="ws-crumb-part">
              {c}
              <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" />
            </span>
          ))}
          <b>{item.name || "New WebSocket"}</b>
        </span>
        <button className="ghost" onClick={handleSave}>
          <Save size={14} strokeWidth={1.75} aria-hidden="true" />
          Save
          <Kbd command="save" />
        </button>
      </div>

      <div className="ws-bar">
        <div className="ws-url">
          <span className="ws-url-tag">WS</span>
          <div className="url-field">
            <VarInput
              value={urlRaw(req.url)}
              placeholder="wss://example.com/socket"
              className="url-input"
              inputRef={urlInputRef}
              onChange={(value) => {
                setUrlRaw(item, value);
                edit();
              }}
            />
          </div>
        </div>
        <ConnectionStatus status={status} events={events} />
        {status === "connecting" || connected ? (
          <button className="ws-connect" onClick={handleDisconnect}>
            Disconnect
          </button>
        ) : (
          <button className="primary ws-connect" onClick={handleConnect}>
            Connect
          </button>
        )}
      </div>

      <div className="subtabs">
        {(["params", "headers", "auth"] as SubTab[]).map((s) => (
          <button key={s} className={sub === s ? "active" : ""} onClick={() => { tab.wsSub = s; notifyChange(); }}>
            {s[0].toUpperCase() + s.slice(1)}
            {s === "headers" && headerCount ? <span className="subtab-count">{headerCount}</span> : null}
          </button>
        ))}
      </div>

      <div className="subtab-body ws-subtab-body">
        {sub === "params" ? <ParamsPanel item={item} onChange={edit} /> : null}
        {sub === "headers" ? <KvTable rows={(req.header ??= [])} onChange={edit} label="header" /> : null}
        {sub === "auth" ? <AuthEditor target={req} onChange={edit} hideInherit={isDraft} inherited={inheritedAuth(tab.file, tab.path)} /> : null}
      </div>

      <div className="ws-messages">
        <div className="ws-log-toolbar">
          <div className="ws-filter">
            <Search size={14} strokeWidth={1.75} aria-hidden="true" />
            <input type="text" placeholder="Filter messages" aria-label="Filter messages" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <span className="ws-count tnum">
            {filter ? `${filtered.length} of ${events.length}` : events.length} {events.length === 1 ? "message" : "messages"}
          </span>
          <button className="ghost ws-clear" onClick={handleClearLog}>
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            Clear log
          </button>
        </div>

        <div className="ws-log" ref={logRef} onScroll={() => {
          const el = logRef.current;
          if (!el) return;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
        }}>
          {filtered.length === 0 ? (
            <div className="empty-state">No messages yet.</div>
          ) : (
            filtered.map(([i, e]) => <LogRow key={i} event={e} expanded={expanded.has(i)} onToggle={() => toggle(i)} />)
          )}
        </div>

        <div className={`ws-composer${connected ? "" : " off"}`}>
          <div className="ws-composer-head">
            <label htmlFor="ws-message">Message</label>
            {isJson(message) ? <span className="tag">JSON</span> : null}
          </div>
          <div className="ws-composer-box">
            <textarea
              id="ws-message"
              className="mono"
              value={message}
              placeholder="Message to send"
              onChange={(e) => setMessage(e.target.value)}
            />
            <button className="primary ws-send" disabled={!connected} onClick={handleSend}>
              Send
              <Kbd command="send" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
