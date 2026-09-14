import { useEffect, useRef, useState } from "react";
import type { RequestTab as RequestTabState } from "../store";
import { markCollectionDirty, notifyChange, saveCollectionFile, openSaveDraftModal, toast, getCollection, selectedEnv } from "../store";
import { itemAt } from "../tree";
import * as api from "../api";
import AuthEditor from "./AuthEditor";
import KvTable from "./KvTable";
import { ParamsPanel } from "./RequestTab";
import { setUrlRaw, urlRaw } from "../urlutil";
import type { WsEvent } from "../types";
import VarInput from "./VarInput";
import { FOCUS_URL, SEND } from "../commands";

interface Props {
  tab: RequestTabState;
}

type SubTab = "params" | "headers" | "auth";

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

function LogRow({ event, expanded, onToggle }: { event: WsEvent; expanded: boolean; onToggle: () => void }) {
  const time = formatTime(event.time);

  if (event.type === "open") {
    return (
      <div className="ws-row ws-row-system">
        <span className="ws-row-dir">•</span>
        <span className="ws-row-time">{time}</span>
        <div className="ws-row-body" onClick={onToggle}>
          Connected
          {expanded && event.header.length > 0 ? (
            <div className="ws-handshake">
              {event.header.map((h, i) => (
                <div key={i}>
                  {h.key}: {h.value}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (event.type === "closed") {
    return (
      <div className="ws-row ws-row-system">
        <span className="ws-row-dir">•</span>
        <span className="ws-row-time">{time}</span>
        <span className="ws-row-body">
          Disconnected (code {event.code}){event.data ? `: ${event.data}` : ""}
        </span>
      </div>
    );
  }

  if (event.type === "error") {
    return (
      <div className="ws-row ws-row-error">
        <span className="ws-row-dir">!</span>
        <span className="ws-row-time">{time}</span>
        <span className="ws-row-body">{event.data}</span>
      </div>
    );
  }

  const dir = event.type === "sent" ? "↑" : "↓";
  let body: string;
  if (event.binary) {
    body = expanded ? event.data : `[binary, ${binaryByteLength(event.data)} bytes]`;
  } else if (expanded) {
    try {
      body = JSON.stringify(JSON.parse(event.data), null, 2);
    } catch {
      body = event.data;
    }
  } else {
    body = event.data;
  }

  return (
    <div className={`ws-row ws-row-${event.type}`}>
      <span className="ws-row-dir">{dir}</span>
      <span className="ws-row-time">{time}</span>
      <div className={`ws-row-body${expanded ? "" : " ws-clamped"}`} onClick={onToggle}>
        {body}
      </div>
    </div>
  );
}

export default function WebSocketTab({ tab }: Props) {
  const [sub, setSub] = useState<SubTab>("params");
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
  const statusLabel = status === "connecting" ? "Connecting…" : status === "open" ? "Connected" : "Disconnected";
  const message = tab.ws?.message ?? localMessage;
  const lowerFilter = filter.toLowerCase();
  const filtered = events
    .map((e, i) => [i, e] as const)
    .filter(([, e]) => !lowerFilter || e.data.toLowerCase().includes(lowerFilter));

  return (
    <div className="split">
      <div className="split-top">
        <div className="request-toolbar">
          <div className="method-url-group">
            <span className="method-select-trigger method-select-static">
              <span className="method-select-label ms-color-ws">WS</span>
            </span>
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
          <span className={`ws-status ws-status-${status}`}>{statusLabel}</span>
          {status === "connecting" || status === "open" ? (
            <button onClick={handleDisconnect}>Disconnect</button>
          ) : (
            <button className="primary" onClick={handleConnect}>
              Connect
            </button>
          )}
          <button className="ghost" onClick={handleSave}>
            Save
          </button>
        </div>

        <div className="subtabs">
          {(["params", "headers", "auth"] as SubTab[]).map((s) => (
            <button key={s} className={sub === s ? "active" : ""} onClick={() => setSub(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="subtab-body">
          {sub === "params" ? <ParamsPanel item={item} onChange={edit} /> : null}
          {sub === "headers" ? <KvTable rows={(req.header ??= [])} onChange={edit} label="header" /> : null}
          {sub === "auth" ? <AuthEditor target={req} onChange={edit} hideInherit={isDraft} /> : null}
        </div>
      </div>

      <div className="split-bottom ws-messages">
        <div className="ws-composer">
          <textarea
            className="mono"
            value={message}
            placeholder="Message to send"
            onChange={(e) => setMessage(e.target.value)}
          />
          <button className="primary" disabled={status !== "open"} onClick={handleSend}>
            Send
          </button>
        </div>

        <div className="ws-log-toolbar">
          <input type="text" placeholder="Filter messages…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button onClick={handleClearLog}>Clear log</button>
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
      </div>
    </div>
  );
}
