import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import * as api from "../api";
import { state, openDraftTab, notifyChange, toast } from "../store";
import { isWebSocket } from "../websocket";
import { methodClass } from "../method";
import type { HistoryEntry } from "../types";

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
      <div className="history-actions">
        <button onClick={clearHistory} disabled={state.history.length === 0}>
          {clearArmed ? "Click again to clear" : "Clear history"}
        </button>
      </div>
      {entries.length === 0 ? <div className="empty-state">No history yet.</div> : null}
      {groups.map((g) => (
        <div key={g.label}>
          <div className="sidebar-section-title">{g.label}</div>
          {g.entries.map((entry) => {
            const key = `hist:${entry.id}`;
            const label = entry.url || entry.item.name;
            const isErr = entry.code === 0 && entry.error !== "";
            const statusClass = isErr || entry.code >= 400 ? "status-5xx" : entry.code >= 200 && entry.code < 300 ? "status-2xx" : "";
            const statusText = isErr ? "ERR" : entry.code === 0 ? "" : String(entry.code);
            return (
              <div
                className="tree-row history-row"
                key={entry.id}
                title={entry.error || undefined}
                onClick={() => openDraftTab(structuredClone(entry.item))}
              >
                {entry.method === "WS" || isWebSocket(entry.item) ? (
                  <span className="method-badge method-ws">WS</span>
                ) : (
                  <span className={`method-badge method-${methodClass(entry.method)}`}>{entry.method}</span>
                )}
                <span className="name">{label}</span>
                {statusText ? <span className={`history-status ${statusClass}`}>{statusText}</span> : null}
                <span className="history-time">{timeLabel(entry.time)}</span>
                <button
                  className={`icon menu-btn${menuKey === key ? " menu-open" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuKey(menuKey === key ? null : key);
                  }}
                >
                  <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
                {menuKey === key ? (
                  <div className="menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => deleteEntry(entry.id)}>Delete</button>
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
