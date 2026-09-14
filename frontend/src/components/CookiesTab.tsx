import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import * as api from "../api";
import { toast } from "../store";
import type { Cookie } from "../types";
import DateTimePicker from "./DateTimePicker";

const emptyDraft = (): Cookie => ({
  name: "",
  value: "",
  domain: "",
  path: "/",
  expires: "",
  httpOnly: false,
  secure: false,
  hostOnly: true,
});

// Date <-> Cookie.expires ("" for a session cookie, otherwise an HTTP date string).
function expiresToDate(expires: string): Date | null {
  if (!expires) return null;
  const d = new Date(expires);
  return isNaN(d.getTime()) ? null : d;
}

function dateToExpires(d: Date | null): string {
  return d ? d.toUTCString() : "";
}

export default function CookiesTab() {
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<Cookie>(emptyDraft());
  const [clearArmed, setClearArmed] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    setLoading(true);
    try {
      setCookies(await api.listCookies());
    } catch (err) {
      toast(String(err), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(row: Cookie) {
    try {
      await api.saveCookie(row);
      await load();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function handleDelete(row: Cookie) {
    try {
      await api.deleteCookie(row.domain, row.path, row.name);
      await load();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  function handleClearAll() {
    if (!clearArmed) {
      setClearArmed(true);
      clearTimer.current = setTimeout(() => setClearArmed(false), 3000);
      return;
    }
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setClearArmed(false);
    api
      .clearCookies()
      .then(load)
      .catch((err) => toast(String(err), "error"));
  }

  async function handleAdd() {
    if (!draft.domain || !draft.name) return;
    try {
      await api.saveCookie(draft);
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  const lowerFilter = filter.toLowerCase();
  const filtered = cookies.filter((c) => !lowerFilter || c.domain.toLowerCase().includes(lowerFilter));
  const groups = new Map<string, Cookie[]>();
  for (const c of filtered) {
    const list = groups.get(c.domain) ?? [];
    list.push(c);
    groups.set(c.domain, list);
  }

  return (
    <div className="subtab-body">
      <div className="cookies-toolbar">
        <input type="text" placeholder="Filter by domain…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button onClick={load}>Refresh</button>
        <button onClick={handleClearAll}>{clearArmed ? "Click again to clear all" : "Clear all"}</button>
      </div>

      <div className="cookie-add-form">
        <input
          type="text"
          className="mono"
          placeholder="domain"
          value={draft.domain}
          onChange={(e) => setDraft({ ...draft, domain: e.target.value })}
        />
        <input
          type="text"
          className="mono"
          placeholder="path"
          value={draft.path}
          onChange={(e) => setDraft({ ...draft, path: e.target.value })}
        />
        <input
          type="text"
          className="mono"
          placeholder="name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <input
          type="text"
          className="mono"
          placeholder="value"
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
        />
        <DateTimePicker value={expiresToDate(draft.expires)} onChange={(d) => setDraft({ ...draft, expires: dateToExpires(d) })} />
        <label>
          <input type="checkbox" checked={draft.secure} onChange={(e) => setDraft({ ...draft, secure: e.target.checked })} />
          Secure
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.httpOnly}
            onChange={(e) => setDraft({ ...draft, httpOnly: e.target.checked })}
          />
          HttpOnly
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.hostOnly}
            onChange={(e) => setDraft({ ...draft, hostOnly: e.target.checked })}
          />
          Host-only
        </label>
        <button className="primary" onClick={handleAdd}>
          Add cookie
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : groups.size === 0 ? (
        <div className="empty-state">No cookies.</div>
      ) : (
        [...groups.entries()].map(([domain, rows]) => (
          <div key={domain} className="cookie-domain-group">
            <div className="cookie-domain-title">{domain}</div>
            <table className="kv-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Path</th>
                  <th>Expires</th>
                  <th>HttpOnly</th>
                  <th>Secure</th>
                  <th>HostOnly</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td className="mono">{row.name}</td>
                    <td>
                      <input
                        type="text"
                        className="mono"
                        value={row.value}
                        onChange={(e) => {
                          row.value = e.target.value;
                          setCookies([...cookies]);
                        }}
                      />
                    </td>
                    <td className="mono">{row.path}</td>
                    <td>{row.expires || "Session"}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.httpOnly}
                        onChange={(e) => {
                          row.httpOnly = e.target.checked;
                          setCookies([...cookies]);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.secure}
                        onChange={(e) => {
                          row.secure = e.target.checked;
                          setCookies([...cookies]);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.hostOnly}
                        onChange={(e) => {
                          row.hostOnly = e.target.checked;
                          setCookies([...cookies]);
                        }}
                      />
                    </td>
                    <td>
                      <button onClick={() => handleSave(row)}>Save</button>
                      <button className="icon" onClick={() => handleDelete(row)} aria-label="Delete row" title="Delete">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
