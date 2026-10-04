import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import * as api from "../api";
import { state, openDraftTab, notifyChange, toast } from "../store";
import { isWebSocket } from "../websocket";
import type { HistoryEntry } from "../types";

const SHORT_METHOD: Record<string, string> = { DELETE: "DEL", OPTIONS: "OPT" };
const COLORED = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

// Method (or WS) tag shared by the tree and history rows. DELETE and OPTIONS are shortened to fit the column.
export function MethodTag({ method, ws }: { method: string; ws?: boolean }) {
  if (ws) return <span className="method-badge method-ws">WS</span>;
  const m = method.toUpperCase();
  return <span className={`method-badge method-${COLORED.has(m) ? m : "OTHER"}`}>{SHORT_METHOD[m] ?? method}</span>;
}

// Splits a URL into its path (with query) and host. A leading {{variable}} counts as the host.
function splitUrl(url: string): { path: string; host: string } {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/?#]*)(.*)$/i.exec(url.trim());
  if (!m) return { path: url, host: "" };
  const rest = m[2];
  return { path: rest === "" ? "/" : rest.startsWith("/") ? rest : `/${rest}`, host: m[1] };
}

function statusTag(entry: HistoryEntry): { text: string; cls: string } | null {
  if (entry.code === 0) return entry.error !== "" ? { text: "ERR", cls: "err" } : null;
  const cls = entry.code >= 500 ? "err" : entry.code >= 400 ? "warn" : entry.code >= 300 ? "info" : "ok";
  return { text: String(entry.code), cls };
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString();
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function historyMatches(entry: HistoryEntry, query: string): boolean {
  if (!query) return true;
  return (
    entry.url.toLowerCase().includes(query) ||
    entry.method.toLowerCase().includes(query) ||
    entry.item.name.toLowerCase().includes(query)
  );
}

interface Props {
  search: string;
  menuKey: string | null;
  setMenuKey: (k: string | null) => void;
}

export default function HistoryList({ search, menuKey, setMenuKey }: Props) {
  const [clearArmed, setClearArmed] = useState(false);
  const clearTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
  }, []);

  async function deleteEntry(id: string) {
    setMenuKey(null);
    try {
      await api.deleteHistory(id);
      state.history = state.history.filter((h) => h.id !== id);
      notifyChange();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function clearHistory() {
    if (!clearArmed) {
      setClearArmed(true);
      clearTimer.current = window.setTimeout(() => setClearArmed(false), 3000);
      return;
    }
    setClearArmed(false);
    try {
      await api.clearHistory();
      state.history = [];
      notifyChange();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  const query = search.trim().toLowerCase();
  const entries = state.history.filter((e) => historyMatches(e, query));

  const groups: { label: string; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.time);
    const group = groups.find((g) => g.label === label);
    if (group) group.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }

  return (
    <div className="history-list">
      {entries.length === 0 ? <div className="empty-state">{query ? "No matching history." : "No history yet."}</div> : null}
      {groups.map((g, gi) => (
        <div key={g.label}>
          <div className="sidebar-section-title">
            <span className="grow">{g.label}</span>
            {gi === 0 ? (
              <button className="ghost" onClick={clearHistory} disabled={state.history.length === 0}>
                {clearArmed ? "Click again to clear" : "Clear"}
              </button>
            ) : null}
          </div>
          {g.entries.map((entry) => {
            const key = `hist:${entry.id}`;
            const { path, host } = entry.url ? splitUrl(entry.url) : { path: entry.item.name, host: "" };
            const status = statusTag(entry);
            return (
              <div
                className="tree-row history-row"
                key={entry.id}
                title={[entry.url || entry.item.name, entry.error].filter(Boolean).join("\n")}
                onClick={() => openDraftTab(structuredClone(entry.item))}
              >
                <MethodTag method={entry.method} ws={entry.method === "WS" || isWebSocket(entry.item)} />
                <span className="name">
                  <span>{path}</span>
                  {host ? <span className="host">{host}</span> : null}
                </span>
                {status ? <span className={`tag tnum ${status.cls}`}>{status.text}</span> : null}
                <span className="history-time">{timeLabel(entry.time)}</span>
                <button
                  className={`icon menu-btn${menuKey === key ? " menu-open" : ""}`}
                  aria-label="History entry actions"
                  title="More actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuKey(menuKey === key ? null : key);
                  }}
                >
                  <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
                {menuKey === key ? (
                  <div className="menu" onClick={(e) => e.stopPropagation()}>
                    <button className="danger" onClick={() => deleteEntry(entry.id)}>
                      <span className="menu-item-main">
                        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        Delete
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
