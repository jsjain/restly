import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Lock, Play, Plus, Save, Trash2 } from "lucide-react";
import * as api from "../api";
import {
  collectionEnvs,
  confirmDelete,
  deleteEnvironmentFile,
  ensureCollection,
  ensureEnvironment,
  getCollection,
  getEnvironment,
  isCollectionDirty,
  markCollectionDirty,
  notifyChange,
  openRequestTab,
  openRunnerTab,
  refreshWorkspace,
  saveCollectionFile,
  selectedEnv,
  setSelectedEnv,
  toast,
} from "../store";
import type { CollectionTab, EnvironmentTab as EnvironmentTabState, FolderTab, SettingsSubTab as Sub } from "../store";
import { inheritedAuth } from "../authInherit";
import { itemAt } from "../tree";
import { isFolder } from "../types";
import type { Collection, FileRef, Item, Variable } from "../types";
import { urlRaw } from "../urlutil";
import { isWebSocket } from "../websocket";
import AuthEditor from "./AuthEditor";
import EnvironmentTab from "./EnvironmentTab";
import { Kbd } from "./Kbd";
import { applyBulk, BulkEditor, MethodTag, ViewToggle } from "./pageKv";
import ScriptEditor from "./ScriptEditor";
import "../overview.css";
import "../environments.css";
import { readDescription, setRowDescription, writeDescription } from "../description";

interface Props {
  tab: CollectionTab | FolderTab;
}

function countStats(items: Item[]): { requests: number; folders: number; ws: number } {
  let requests = 0;
  let folders = 0;
  let ws = 0;
  for (const it of items) {
    if (isFolder(it)) {
      folders++;
      const inner = countStats(it.item ?? []);
      requests += inner.requests;
      folders += inner.folders;
      ws += inner.ws;
    } else if (isWebSocket(it)) {
      ws++;
    } else {
      requests++;
    }
  }
  return { requests, folders, ws };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

interface RequestRow {
  item: Item;
  path: number[];
  folder: string; // folders between the page's target and the request
}

function listRequests(items: Item[], base: number[], chain: string[], out: RequestRow[] = []): RequestRow[] {
  items.forEach((item, i) => {
    const path = [...base, i];
    if (isFolder(item)) listRequests(item.item ?? [], path, [...chain, item.name], out);
    else out.push({ item, path, folder: chain.join(" / ") });
  });
  return out;
}

// The scheme and host (or a leading {{variable}}) are dropped so the path reads first.
function displayPath(raw: string): string {
  const m = raw.match(/^(?:[a-z][a-z0-9+.-]*:\/\/[^/?#]*|\{\{[^}]*\}\})(.*)$/i);
  return m ? m[1] || "/" : raw;
}

// Requests under `items` whose auth falls through to the page's own target.
function inheritCount(items: Item[]): number {
  let n = 0;
  for (const it of items) {
    const type = (isFolder(it) ? it.auth : it.request?.auth)?.type;
    if (type && type !== "inherit") continue;
    if (isFolder(it)) n += inheritCount(it.item ?? []);
    else if (!isWebSocket(it)) n++;
  }
  return n;
}

const AUTH_LABELS: Record<string, string> = {
  inherit: "Inherit from parent",
  noauth: "No auth",
  basic: "Basic auth",
  bearer: "Bearer token",
  apikey: "API key",
};

function scriptLines(target: { event?: Item["event"] }, listen: "prerequest" | "test"): number {
  const exec = target.event?.find((e) => e.listen === listen)?.script?.exec;
  const code = Array.isArray(exec) ? exec.join("\n") : (exec ?? "");
  return code.trim() === "" ? 0 : code.split("\n").length;
}

function scriptSummary(lines: number): string {
  return lines === 0 ? "None" : plural(lines, "line");
}

export default function SettingsTab({ tab }: Props) {
  const coll = getCollection(tab.file);

  useEffect(() => {
    if (!coll) ensureCollection(tab.file).catch((err) => toast(String(err), "error"));
  }, [tab.file, coll]);

  if (!coll) return <div className="empty-state">Loading…</div>;
  return <Loaded tab={tab} coll={coll} />;
}

function Loaded({ tab, coll }: { tab: CollectionTab | FolderTab; coll: Collection }) {
  const isCollection = tab.kind === "collection";
  const target: Collection | Item | undefined = isCollection ? coll : itemAt(coll, tab.path);

  const sub = tab.sub ?? "overview";
  const scriptView = tab.scriptView ?? "prerequest";
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  if (!target) return <div className="empty-state">This folder was deleted.</div>;

  const name = isCollection ? coll.info.name : (target as Item).name;
  const dirty = isCollectionDirty(tab.file);
  const stats = countStats(target.item ?? []);
  const fileName = tab.file.split(/[\\/]/).pop() || tab.file;
  const variableCount = (coll.variable ?? []).length;

  function edit() {
    markCollectionDirty(tab.file);
  }

  function startRename() {
    setTitleDraft(name);
    setEditingTitle(true);
  }

  function commitTitle() {
    const next = titleDraft.trim();
    if (next) {
      if (isCollection) coll.info.name = next;
      else target!.name = next;
      edit();
    }
    setEditingTitle(false);
  }

  async function handleSave() {
    try {
      await saveCollectionFile(tab.file);
      toast("Saved");
    } catch (err) {
      toast(String(err), "error");
    }
  }

  // Folders don't get Variables or Runs: only the collection root has variables, and the
  // header's Run button already covers running a folder.
  const subs: { key: Sub; label: string; count?: number }[] = isCollection
    ? [
        { key: "overview", label: "Overview" },
        { key: "auth", label: "Authorization" },
        { key: "scripts", label: "Scripts" },
        { key: "variables", label: "Variables", count: variableCount },
        { key: "environments", label: "Environments", count: collectionEnvs(tab.file).length },
        { key: "runs", label: "Runs" },
      ]
    : [
        { key: "overview", label: "Overview" },
        { key: "auth", label: "Authorization" },
        { key: "scripts", label: "Scripts" },
      ];

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-titles">
          <div className="page-title-row">
            {editingTitle ? (
              <input
                autoFocus
                className="page-title-input"
                aria-label="Name"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTitle();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingTitle(false);
                  }
                }}
              />
            ) : (
              <h1
                className="page-title rename"
                title="Click to rename"
                tabIndex={0}
                onClick={startRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "F2") startRename();
                }}
              >
                {name}
              </h1>
            )}
            {dirty ? <span className="ov-dirty-dot" title="Unsaved changes" /> : null}
          </div>
          <div className="page-meta">
            <span className="mono">{fileName}</span>
            <span className="dotsep" />
            <span>{[plural(stats.requests, "request"), stats.folders ? plural(stats.folders, "folder") : "", stats.ws ? `${stats.ws} WebSocket` : ""].filter(Boolean).join(", ")}</span>
            {isCollection ? (
              <>
                <span className="dotsep" />
                <span>{plural(variableCount, "variable")}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="page-acts">
          <button className="primary" onClick={() => openRunnerTab(tab.file, tab.path)}>
            <Play size={13} /> Run
          </button>
          <button className="ghost" onClick={handleSave}>
            <Save size={13} /> Save <Kbd command="save" />
          </button>
        </div>
      </div>

      <div className="subtabs">
        {subs.map((s) => (
          <button
            key={s.key}
            className={sub === s.key ? "active" : ""}
            onClick={() => {
              tab.sub = s.key;
              notifyChange();
            }}
          >
            {s.label}
            {s.count != null ? <span className="subtab-count">{s.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="page-body">
        {sub === "overview" ? (
          <OverviewPanel tab={tab} coll={coll} target={target} isCollection={isCollection} onChange={edit} />
        ) : null}
        {sub === "auth" ? (
          <div className="ov-auth">
            <p className="ov-hint">
              {isCollection ? "Requests and folders set to Inherit use this." : "Requests in this folder set to Inherit use this."}
            </p>
            <AuthEditor
              target={target}
              onChange={edit}
              hideInherit={isCollection}
              inherited={isCollection ? undefined : inheritedAuth(tab.file, tab.path)}
            />
          </div>
        ) : null}
        {sub === "scripts" ? (
          <div className="ov-scripts">
            <div className="segmented">
              <button className={scriptView === "prerequest" ? "active" : ""} onClick={() => { tab.scriptView = "prerequest"; notifyChange(); }}>
                Pre-request
              </button>
              <button className={scriptView === "test" ? "active" : ""} onClick={() => { tab.scriptView = "test"; notifyChange(); }}>
                Post-response
              </button>
            </div>
            <div className="ov-script-editor">
              <ScriptEditor
                key={scriptView}
                target={target}
                listen={scriptView}
                onChange={edit}
                hint={`Runs ${scriptView === "prerequest" ? "before" : "after"} every request in this ${isCollection ? "collection" : "folder"}.`}
              />
            </div>
          </div>
        ) : null}
        {sub === "variables" && isCollection ? <VariablesPanel coll={coll} onChange={edit} /> : null}
        {sub === "environments" && isCollection ? <EnvironmentsPanel file={tab.file} /> : null}
        {sub === "runs" && isCollection ? <RunsPanel tab={tab} /> : null}
      </div>
    </div>
  );
}

// Paragraphs split on blank lines, `inline code` in backticks. Everything else stays plain text.
function Prose({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className="prose">
      {paragraphs.map((p, i) => (
        <p key={i}>
          {p.split(/(`[^`\n]+`)/).map((part, j) =>
            part.length > 2 && part.startsWith("`") && part.endsWith("`") ? <code key={j}>{part.slice(1, -1)}</code> : part
          )}
        </p>
      ))}
    </div>
  );
}

function SideBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="blk">
      <div className="lbl">{label}</div>
      {children}
    </div>
  );
}

function OverviewPanel({
  tab,
  coll,
  target,
  isCollection,
  onChange,
}: {
  tab: CollectionTab | FolderTab;
  coll: Collection;
  target: Collection | Item;
  isCollection: boolean;
  onChange: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const description = readDescription(target.description);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description, editing]);

  const stats = countStats(target.item ?? []);
  const requests = listRequests(target.item ?? [], isCollection ? [] : tab.path, []);
  const envs = isCollection ? collectionEnvs(tab.file) : [];
  const active = selectedEnv(tab.file);
  const auth = target.auth?.type ?? (isCollection ? "noauth" : "inherit");
  const authLabel = AUTH_LABELS[auth] ?? auth;
  const used = inheritCount(target.item ?? []);
  // A folder page has nothing to say in the Folder column when every request sits directly in it.
  const showFolder = requests.some((r) => r.folder);

  return (
    <div className="cols">
      <div className="ov-main">
        <div className="secthead">
          Description
          <span className="grow" />
          <button className="ghost sm" onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Edit"}
          </button>
        </div>
        {editing ? (
          <textarea
            ref={textareaRef}
            autoFocus
            className="ov-description"
            aria-label="Description"
            placeholder="Add a description…"
            rows={1}
            value={description}
            onChange={(e) => {
              writeDescription(target, e.target.value);
              onChange();
            }}
          />
        ) : (
          <div
            className="descbox"
            title="Click to edit"
            onClick={() => {
              if (!window.getSelection()?.toString()) setEditing(true);
            }}
          >
            {description.trim() ? <Prose text={description} /> : <p className="subtlest descempty">No description</p>}
          </div>
        )}

        <div className="secthead requests-head">
          Requests <span className="c">{requests.length}</span>
        </div>
        <div className="pg-wrap">
          <table className="pg-table reqs">
            <thead>
              <tr>
                <th className="w-method">Method</th>
                <th className="w-name">Name</th>
                <th>Path</th>
                {showFolder ? <th className="w-folder">Folder</th> : null}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr
                  key={r.path.join(".")}
                  className="pg-open"
                  tabIndex={0}
                  onClick={() => openRequestTab(tab.file, r.path)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openRequestTab(tab.file, r.path);
                  }}
                >
                  <td>
                    <MethodTag method={r.item.request?.method ?? "GET"} ws={isWebSocket(r.item)} />
                  </td>
                  <td className="name">{r.item.name || "Untitled"}</td>
                  <td className="path mono">{displayPath(urlRaw(r.item.request?.url))}</td>
                  {showFolder ? <td className={r.folder ? "fold" : "fold subtlest"}>{r.folder || (isCollection ? "Root" : "This folder")}</td> : null}
                </tr>
              ))}
              {requests.length === 0 ? (
                <tr className="pg-empty">
                  <td colSpan={showFolder ? 4 : 3}>No requests yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="ov-side">
        <SideBlock label="Authorization">
          <div className="li">
            <Lock size={13} className="subtle" />
            {authLabel}
            {auth !== "inherit" ? <span className="sub">Used by {plural(used, "request")}</span> : null}
          </div>
        </SideBlock>
        {isCollection ? (
          <SideBlock label="Environments">
            {envs.length === 0 ? <div className="li subtlest">None</div> : null}
            {envs.map((ref) => (
              <div key={ref.file} className="li">
                <span className={`env-dot${active === ref.file ? " env-dot-active" : ""}`} />
                <span className="li-name">{getEnvironment(ref.file)?.name ?? ref.name}</span>
                {active === ref.file ? <span className="tag ok">Active</span> : null}
              </div>
            ))}
          </SideBlock>
        ) : null}
        <SideBlock label="Scripts">
          <div className="li">
            <span className="subtle">Pre-request</span>
            <span className="sub">{scriptSummary(scriptLines(target, "prerequest"))}</span>
          </div>
          <div className="li">
            <span className="subtle">Post-response</span>
            <span className="sub">{scriptSummary(scriptLines(target, "test"))}</span>
          </div>
        </SideBlock>
        <SideBlock label="Stats">
          <div className="stat-row tnum">
            <div className="stat">
              <div className="v">{stats.requests}</div>
              <div className="l">requests</div>
            </div>
            {stats.folders > 0 ? (
              <div className="stat">
                <div className="v">{stats.folders}</div>
                <div className="l">folders</div>
              </div>
            ) : null}
            {stats.ws > 0 ? (
              <div className="stat">
                <div className="v">{stats.ws}</div>
                <div className="l">WebSocket</div>
              </div>
            ) : null}
            {isCollection ? (
              <div className="stat">
                <div className="v">{(coll.variable ?? []).length}</div>
                <div className="l">variables</div>
              </div>
            ) : null}
          </div>
        </SideBlock>
      </aside>
    </div>
  );
}

function VariablesPanel({
  coll,
  onChange,
}: {
  coll: Collection;
  onChange: () => void;
}) {
  coll.variable ??= [];
  const rows = coll.variable;
  const [bulk, setBulk] = useState(false);
  const keyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (focusIndex.current != null) {
      keyRefs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  });

  function addRow() {
    rows.push({ key: "", value: "" });
    focusIndex.current = rows.length - 1;
    onChange();
  }

  return (
    <>
      <div className="hintrow">
        <span>Collection variables are saved in the collection file. Use environments for secrets.</span>
        <span className="grow" />
        <ViewToggle bulk={bulk} onChange={setBulk} />
      </div>
      {bulk ? (
        <BulkEditor
          rows={rows.map((r) => ({ key: r.key, value: r.value ?? "", off: !!r.disabled }))}
          onChange={(parsed) => {
            applyBulk<Variable>(rows, parsed, (old, b) => {
              const v: Variable = { ...old, key: b.key, value: b.value };
              if (b.off) v.disabled = true;
              else delete v.disabled;
              return v;
            });
            onChange();
          }}
        />
      ) : (
        <div className="pg-wrap">
          <table className="pg-table">
            <thead>
              <tr>
                <th className="ck" />
                <th className="w-var">Variable</th>
                <th className="w-val">Value</th>
                <th>Description</th>
                <th className="acts" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className={row.disabled ? "off" : ""}>
                  <td className="ck">
                    <input
                      type="checkbox"
                      aria-label="Enabled"
                      checked={!row.disabled}
                      onChange={(e) => {
                        if (e.target.checked) delete row.disabled;
                        else row.disabled = true;
                        onChange();
                      }}
                    />
                  </td>
                  <td className="in">
                    <input
                      type="text"
                      className="mono"
                      aria-label="Variable"
                      value={row.key}
                      ref={(el) => {
                        keyRefs.current[index] = el;
                      }}
                      onChange={(e) => {
                        row.key = e.target.value;
                        onChange();
                      }}
                    />
                  </td>
                  <td className="in">
                    <input
                      type="text"
                      className="mono"
                      aria-label="Value"
                      value={row.value ?? ""}
                      onChange={(e) => {
                        row.value = e.target.value;
                        onChange();
                      }}
                    />
                  </td>
                  <td className="in d">
                    <input
                      type="text"
                      aria-label="Description"
                      value={readDescription(row.description)}
                      onChange={(e) => {
                        setRowDescription(row, e.target.value);
                        onChange();
                      }}
                    />
                  </td>
                  <td className="acts">
                    <button
                      className="icon pg-del"
                      aria-label="Delete row"
                      title="Delete"
                      onClick={() => {
                        rows.splice(index, 1);
                        onChange();
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="pg-ghost" onClick={addRow}>
                <td className="ck" />
                <td>
                  <button className="pg-add" aria-label="Add variable">
                    Variable
                  </button>
                </td>
                <td>Value</td>
                <td>Description</td>
                <td className="acts" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Environments owned by this collection: only its requests are offered them.
function EnvironmentsPanel({ file }: { file: string }) {
  const envs = collectionEnvs(file);
  const active = selectedEnv(file);
  const [shownFile, setShownFile] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const shown = envs.find((e) => e.file === shownFile) ?? envs[0];
  const shownPath = shown?.file ?? "";
  const editorTab = useMemo<EnvironmentTabState | null>(
    () => (shownPath ? { kind: "environment", file: shownPath, path: [] } : null),
    [shownPath]
  );

  useEffect(() => {
    if (shownPath) ensureEnvironment(shownPath).catch((err) => toast(String(err), "error"));
  }, [shownPath]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      const ref = await api.newEnvironment(name, file);
      setNewName("");
      setAdding(false);
      await refreshWorkspace();
      setShownFile(ref.file);
      // A collection's first environment becomes its active one.
      if (envs.length === 0) setSelectedEnv(file, ref.file);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function remove(ref: FileRef) {
    if (!(await confirmDelete(getEnvironment(ref.file)?.name ?? ref.name))) return;
    try {
      await deleteEnvironmentFile(ref.file);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  return (
    <div className="ov-envs">
      <div className="ov-env-list">
        <div className="ov-env-head">
          Environments
          <button
            className="ghost icon"
            title="New environment"
            aria-label="New environment"
            aria-expanded={adding}
            onClick={() => setAdding((a) => !a)}
          >
            <Plus size={14} />
          </button>
        </div>
        {adding ? (
          <div className="ov-env-new">
            <input
              autoFocus
              type="text"
              placeholder="Name, then Enter"
              aria-label="New environment name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => {
                if (!newName.trim()) setAdding(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
                else if (e.key === "Escape") {
                  e.stopPropagation();
                  setNewName("");
                  setAdding(false);
                }
              }}
            />
          </div>
        ) : null}
        {envs.length === 0 ? (
          <p className="ov-hint">Add environments such as Dev or Staging. Requests in this collection can pick them, other collections can't.</p>
        ) : null}
        {envs.map((ref) => (
          <div
            key={ref.file}
            className={`ov-env-row${shown?.file === ref.file ? " selected" : ""}`}
            tabIndex={0}
            aria-current={shown?.file === ref.file ? "true" : undefined}
            onClick={() => setShownFile(ref.file)}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                setShownFile(ref.file);
              }
            }}
          >
            <span className={`env-dot${active === ref.file ? " env-dot-active" : ""}`} />
            <span className="ov-env-name">{getEnvironment(ref.file)?.name ?? ref.name}</span>
            {active === ref.file ? (
              <span className="ov-env-active">active</span>
            ) : (
              <button
                className="ghost ov-link-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEnv(file, ref.file);
                }}
              >
                Set active
              </button>
            )}
            <button
              className="icon ov-row-del"
              title="Delete"
              aria-label={`Delete ${getEnvironment(ref.file)?.name ?? ref.name}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(ref);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="ov-env-editor">{editorTab ? <EnvironmentTab key={editorTab.file} tab={editorTab} embedded /> : null}</div>
    </div>
  );
}

function RunsPanel({ tab }: { tab: CollectionTab | FolderTab }) {
  return (
    <div className="ov-runs">
      <span className="ov-runs-icon">
        <Play size={18} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h2>No runs yet</h2>
      <p>Run every request in this collection in order, with iterations and a delay between requests. Runs are not saved between sessions.</p>
      <button className="primary" onClick={() => openRunnerTab(tab.file, tab.path)}>
        <Play size={13} /> Run collection
      </button>
    </div>
  );
}
