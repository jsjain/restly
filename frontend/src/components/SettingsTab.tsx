import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
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
  openRunnerTab,
  refreshWorkspace,
  saveCollectionFile,
  selectedEnv,
  setSelectedEnv,
  toast,
} from "../store";
import type { CollectionTab, EnvironmentTab as EnvironmentTabState, FolderTab } from "../store";
import { itemAt } from "../tree";
import { isFolder } from "../types";
import type { Collection, FileRef, Item, Variable } from "../types";
import { isWebSocket } from "../websocket";
import AuthEditor from "./AuthEditor";
import EnvironmentTab from "./EnvironmentTab";
import ScriptEditor from "./ScriptEditor";
import "../overview.css";
import "../environments.css";
import "../kvtable.css";

interface Props {
  tab: CollectionTab | FolderTab;
}

// Postman stores description as either a plain string or `{content, type}`. We read
// whichever shape is present and write back the same shape, defaulting to a string.
function readDescription(d: unknown): string {
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "content" in d) {
    const c = (d as { content?: unknown }).content;
    return typeof c === "string" ? c : "";
  }
  return "";
}

function writeDescription(target: Collection | Item, text: string): void {
  const d = target.description;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    target.description = { ...(d as Record<string, unknown>), content: text };
  } else {
    target.description = text;
  }
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

export default function SettingsTab({ tab }: Props) {
  const coll = getCollection(tab.file);

  useEffect(() => {
    if (!coll) ensureCollection(tab.file).catch((err) => toast(String(err), "error"));
  }, [tab.file, coll]);

  if (!coll) return <div className="ov-empty">Loading…</div>;
  return <Loaded tab={tab} coll={coll} />;
}

type Sub = "overview" | "auth" | "scripts" | "variables" | "environments" | "runs";

function Loaded({ tab, coll }: { tab: CollectionTab | FolderTab; coll: Collection }) {
  const isCollection = tab.kind === "collection";
  const target: Collection | Item | undefined = isCollection ? coll : itemAt(coll, tab.path);

  const [sub, setSub] = useState<Sub>("overview");
  const [scriptView, setScriptView] = useState<"prerequest" | "test">("prerequest");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Menus and the environment picker open this tab straight on a sub-tab.
  useEffect(() => {
    if (tab.kind !== "collection" || !tab.initialSub) return;
    setSub(tab.initialSub as Sub);
    tab.initialSub = undefined;
  });

  if (!target) return <div className="ov-empty">This folder was deleted.</div>;

  const name = isCollection ? coll.info.name : (target as Item).name;
  const dirty = isCollectionDirty(tab.file);

  function edit() {
    markCollectionDirty(tab.file);
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
  const subs: { key: Sub; label: string }[] = isCollection
    ? [
        { key: "overview", label: "Overview" },
        { key: "auth", label: "Authorization" },
        { key: "scripts", label: "Scripts" },
        { key: "variables", label: "Variables" },
        { key: "environments", label: "Environments" },
        { key: "runs", label: "Runs" },
      ]
    : [
        { key: "overview", label: "Overview" },
        { key: "auth", label: "Authorization" },
        { key: "scripts", label: "Scripts" },
      ];

  return (
    <div className="ov-page">
      <div className="ov-header">
        <div className="ov-title-row">
          {editingTitle ? (
            <input
              autoFocus
              className="ov-title-input"
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
              className="ov-title"
              title="Click to rename"
              onClick={() => {
                setTitleDraft(name);
                setEditingTitle(true);
              }}
            >
              {name}
            </h1>
          )}
          {dirty ? <span className="ov-dirty-dot" /> : null}
        </div>
        <div className="ov-header-actions">
          <button onClick={() => openRunnerTab(tab.file, tab.path)}>Run</button>
          <button className="primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>

      <div className="ov-subtabs">
        {subs.map((s) => (
          <button key={s.key} className={`ov-subtab ${sub === s.key ? "active" : ""}`} onClick={() => setSub(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="ov-body">
        {sub === "overview" ? (
          <OverviewPanel coll={coll} target={target} isCollection={isCollection} file={tab.file} onChange={edit} />
        ) : null}
        {sub === "auth" ? <AuthEditor target={target} onChange={edit} hideInherit={isCollection} /> : null}
        {sub === "scripts" ? (
          <div className="ov-scripts">
            <div className="segmented">
              <button className={scriptView === "prerequest" ? "active" : ""} onClick={() => setScriptView("prerequest")}>
                Pre-request
              </button>
              <button className={scriptView === "test" ? "active" : ""} onClick={() => setScriptView("test")}>
                Post-response
              </button>
            </div>
            <div className="ov-hint">
              Runs {scriptView === "prerequest" ? "before" : "after"} every request in this{" "}
              {isCollection ? "collection" : "folder"}.
            </div>
            <div className="ov-script-editor">
              <ScriptEditor key={scriptView} target={target} listen={scriptView} onChange={edit} />
            </div>
          </div>
        ) : null}
        {sub === "variables" && isCollection ? (
          <VariablesPanel coll={coll} onChange={edit} />
        ) : null}
        {sub === "environments" && isCollection ? <EnvironmentsPanel file={tab.file} /> : null}
        {sub === "runs" && isCollection ? <RunsPanel tab={tab} /> : null}
      </div>
    </div>
  );
}

function OverviewPanel({
  coll,
  target,
  isCollection,
  file,
  onChange,
}: {
  coll: Collection;
  target: Collection | Item;
  isCollection: boolean;
  file: string;
  onChange: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const description = readDescription(target.description);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  const stats = countStats(target.item ?? []);
  const variableCount = (coll.variable ?? []).length;
  const fileName = file.split(/[\\/]/).pop() || file;

  return (
    <div className="ov-overview">
      <textarea
        ref={textareaRef}
        className="ov-description"
        placeholder="Add a description…"
        rows={1}
        value={description}
        onChange={(e) => {
          writeDescription(target, e.target.value);
          onChange();
        }}
      />
      <div className="ov-stats">
        <span className="ov-chip">{plural(stats.requests, "request")}</span>
        <span className="ov-chip">{plural(stats.folders, "folder")}</span>
        <span className="ov-chip">{plural(stats.ws, "WebSocket request")}</span>
        {isCollection ? <span className="ov-chip">{plural(variableCount, "variable")}</span> : null}
      </div>
      <div className="ov-filename">{fileName}</div>
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

  if (rows.length === 0) {
    return (
      <div className="kv-empty">
        <p className="kv-empty-hint">No variables</p>
        <button className="ghost kv-add-btn" onClick={addRow}>
          <Plus size={13} /> Add
        </button>
      </div>
    );
  }

  return (
    <>
      <table className="ov-var-table">
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            <th>Variable</th>
            <th>Value</th>
            <th style={{ width: 24 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>
                <input
                  type="checkbox"
                  checked={!row.disabled}
                  onChange={(e) => {
                    if (e.target.checked) delete row.disabled;
                    else row.disabled = true;
                    onChange();
                  }}
                />
              </td>
              <td>
                <input
                  type="text"
                  className="mono"
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
              <td>
                <input
                  type="text"
                  className="mono"
                  value={row.value ?? ""}
                  onChange={(e) => {
                    row.value = e.target.value;
                    onChange();
                  }}
                />
              </td>
              <td>
                <button className="kv-delete" aria-label="Delete row" title="Delete" onClick={() => {
                  rows.splice(index, 1);
                  onChange();
                }}>
                  <X size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ghost kv-add-btn" onClick={addRow}>
        <Plus size={13} /> Add
      </button>
    </>
  );
}

// Environments owned by this collection: only its requests are offered them.
function EnvironmentsPanel({ file }: { file: string }) {
  const envs = collectionEnvs(file);
  const active = selectedEnv(file);
  const [shownFile, setShownFile] = useState("");
  const [newName, setNewName] = useState("");
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
        <div className="ov-env-new">
          <input
            type="text"
            placeholder="New environment"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <button onClick={create} disabled={!newName.trim()}>
            Add
          </button>
        </div>
        {envs.length === 0 ? (
          <p className="ov-hint">Add environments such as Dev or Staging. Requests in this collection can pick them, other collections can't.</p>
        ) : null}
        {envs.map((ref) => (
          <div
            key={ref.file}
            className={`ov-env-row${shown?.file === ref.file ? " selected" : ""}`}
            onClick={() => setShownFile(ref.file)}
          >
            <span className="ov-env-name">{getEnvironment(ref.file)?.name ?? ref.name}</span>
            {active === ref.file ? (
              <span className="ov-env-active">Active</span>
            ) : (
              <button
                className="ov-link-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEnv(file, ref.file);
                }}
              >
                Set active
              </button>
            )}
            <button
              className="ov-icon-btn"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                remove(ref);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="ov-env-editor">{editorTab ? <EnvironmentTab key={editorTab.file} tab={editorTab} /> : null}</div>
    </div>
  );
}

function RunsPanel({ tab }: { tab: CollectionTab | FolderTab }) {
  return (
    <div className="ov-runs">
      <p className="ov-hint">
        Runs every request in this collection in order, top to bottom. Runs are not saved between sessions yet.
      </p>
      <button className="primary" onClick={() => openRunnerTab(tab.file, tab.path)}>
        Run collection
      </button>
    </div>
  );
}
