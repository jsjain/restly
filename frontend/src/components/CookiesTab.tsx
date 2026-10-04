import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import * as api from "../api";
import { toast } from "../store";
import type { Cookie } from "../types";
import DateTimePicker, { formatDisplay } from "./DateTimePicker";
import "../overview.css";
import "../panels.css";

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

function rowKey(c: Cookie): string {
  return `${c.domain}\t${c.path}\t${c.name}`;
}

function showExpires(expires: string): string {
  const d = expiresToDate(expires);
  return d ? formatDisplay(d) : expires || "Session";
}

function FlagBoxes({ cookie, onChange }: { cookie: Cookie; onChange: (c: Cookie) => void }) {
  return (
    <span className="fl">
      {(["httpOnly", "secure", "hostOnly"] as const).map((flag) => (
        <label key={flag}>
          <input type="checkbox" checked={cookie[flag]} onChange={(e) => onChange({ ...cookie, [flag]: e.target.checked })} />
          {flag === "httpOnly" ? "HttpOnly" : flag === "secure" ? "Secure" : "HostOnly"}
        </label>
      ))}
    </span>
  );
}

export default function CookiesTab() {
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Cookie>(emptyDraft());
  // The row being edited, by rowKey. Name, domain and path identify a cookie, so only the rest is editable.
  const [editKey, setEditKey] = useState("");
  const [edit, setEdit] = useState<Cookie>(emptyDraft());
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
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(row: Cookie) {
    try {
      await api.deleteCookie(row.domain, row.path, row.name);
      await load();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function handleSaveEdit() {
    try {
      await api.saveCookie(edit);
      setEditKey("");
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
      setAdding(false);
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
  const domainCount = new Set(cookies.map((c) => c.domain)).size;

  function onEnter(e: React.KeyboardEvent, submit: () => void, cancel: () => void) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <div className="page cookies">
      <div className="page-head">
        <div className="page-titles">
          <h1 className="page-title">Cookies</h1>
          <div className="page-meta tnum">
            <span>
              {cookies.length} {cookies.length === 1 ? "cookie" : "cookies"} in {domainCount} {domainCount === 1 ? "domain" : "domains"}
            </span>
          </div>
        </div>
      </div>

      <div className="ck-bar">
        <div className="filter">
          <Search size={13} />
          <input type="text" aria-label="Filter by domain" placeholder="Filter by domain" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className="ghost" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="ghost" onClick={() => setAdding(true)} disabled={adding}>
          <Plus size={13} /> Add cookie
        </button>
        <span className="grow" />
        <span role="status">{clearArmed ? <span className="tag err">Click again to clear all</span> : null}</span>
        <button className="ghost danger" onClick={handleClearAll} disabled={cookies.length === 0}>
          <Trash2 size={13} /> Clear all
        </button>
      </div>

      <div className="page-body ck-body">
        {adding ? (
          <div className="ck-group">
            <div className="ck-gh ck-new">New cookie</div>
            <div className="pg-wrap">
              <table className="pg-table cookie-table">
                <ColGroup domain />
                <tbody>
                  <tr>
                    <td className="add">
                      <input
                        autoFocus
                        type="text"
                        className="mono"
                        aria-label="Domain"
                        placeholder="domain"
                        value={draft.domain}
                        onChange={(e) => setDraft({ ...draft, domain: e.target.value })}
                        onKeyDown={(e) => onEnter(e, handleAdd, () => setAdding(false))}
                      />
                    </td>
                    <td className="add">
                      <input
                        type="text"
                        className="mono"
                        aria-label="Name"
                        placeholder="name"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        onKeyDown={(e) => onEnter(e, handleAdd, () => setAdding(false))}
                      />
                    </td>
                    <td className="add">
                      <input
                        type="text"
                        className="mono"
                        aria-label="Value"
                        placeholder="value"
                        value={draft.value}
                        onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                        onKeyDown={(e) => onEnter(e, handleAdd, () => setAdding(false))}
                      />
                    </td>
                    <td className="add">
                      <input
                        type="text"
                        className="mono"
                        aria-label="Path"
                        placeholder="path"
                        value={draft.path}
                        onChange={(e) => setDraft({ ...draft, path: e.target.value })}
                        onKeyDown={(e) => onEnter(e, handleAdd, () => setAdding(false))}
                      />
                    </td>
                    <td className="add">
                      <DateTimePicker value={expiresToDate(draft.expires)} onChange={(d) => setDraft({ ...draft, expires: dateToExpires(d) })} />
                    </td>
                    <td className="add">
                      <FlagBoxes cookie={draft} onChange={setDraft} />
                    </td>
                    <td className="add acts2 always">
                      <button className="icon ok" aria-label="Add cookie" title="Add" onClick={handleAdd} disabled={!draft.domain || !draft.name}>
                        <Check size={14} />
                      </button>
                      <button className="icon" aria-label="Cancel" title="Cancel" onClick={() => setAdding(false)}>
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {loading && cookies.length === 0 ? (
          <div className="empty-state">Loading…</div>
        ) : groups.size === 0 && !adding ? (
          <div className="empty-state">{cookies.length === 0 ? "No cookies." : "No cookies match."}</div>
        ) : (
          [...groups.entries()].map(([domain, rows]) => (
            <div key={domain} className="ck-group">
              <div className="ck-gh">
                <span className="mono">{domain}</span>
                <span className="count">
                  {rows.length} {rows.length === 1 ? "cookie" : "cookies"}
                </span>
              </div>
              <div className="pg-wrap">
                <table className="pg-table cookie-table">
                  <ColGroup />
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Value</th>
                      <th>Path</th>
                      <th>Expires</th>
                      <th>Flags</th>
                      <th className="acts2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const key = rowKey(row);
                      if (key === editKey) {
                        return (
                          <tr key={key}>
                            <td className="k mono">{row.name}</td>
                            <td className="add">
                              <input
                                autoFocus
                                type="text"
                                className="mono"
                                aria-label="Value"
                                value={edit.value}
                                onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                                onKeyDown={(e) => onEnter(e, handleSaveEdit, () => setEditKey(""))}
                              />
                            </td>
                            <td className="v mono">{row.path}</td>
                            <td className="add">
                              <DateTimePicker value={expiresToDate(edit.expires)} onChange={(d) => setEdit({ ...edit, expires: dateToExpires(d) })} />
                            </td>
                            <td className="add">
                              <FlagBoxes cookie={edit} onChange={setEdit} />
                            </td>
                            <td className="add acts2 always">
                              <button className="icon ok" aria-label="Save cookie" title="Save" onClick={handleSaveEdit}>
                                <Check size={14} />
                              </button>
                              <button className="icon" aria-label="Cancel" title="Cancel" onClick={() => setEditKey("")}>
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={key}>
                          <td className="k mono" title={row.name}>
                            {row.name}
                          </td>
                          <td className="v mono" title={row.value}>
                            {row.value}
                          </td>
                          <td className="v mono">{row.path}</td>
                          <td className="tnum">{showExpires(row.expires)}</td>
                          <td>
                            <span className="flags">
                              {row.httpOnly ? <span className="tag">HttpOnly</span> : null}
                              {row.secure ? <span className="tag">Secure</span> : null}
                              {row.hostOnly ? <span className="tag">HostOnly</span> : null}
                            </span>
                          </td>
                          <td className="acts2">
                            <button
                              className="icon pg-del pg-edit"
                              aria-label={`Edit ${row.name}`}
                              title="Edit"
                              onClick={() => {
                                setEdit(row);
                                setEditKey(key);
                              }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button className="icon pg-del" aria-label={`Delete ${row.name}`} title="Delete" onClick={() => handleDelete(row)}>
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ColGroup({ domain }: { domain?: boolean }) {
  return (
    <colgroup>
      {domain ? <col style={{ width: 170 }} /> : null}
      <col style={{ width: 150 }} />
      <col />
      <col style={{ width: 80 }} />
      <col style={{ width: 170 }} />
      <col style={{ width: 250 }} />
      <col style={{ width: 72 }} />
    </colgroup>
  );
}
