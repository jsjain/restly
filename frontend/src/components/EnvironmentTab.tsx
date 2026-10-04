import { useLayoutEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Eye, EyeOff, Globe, Layers, Save, Search, Trash2 } from "lucide-react";
import {
  findFileRef,
  getEnvironment,
  markEnvironmentDirty,
  orphanedEnv,
  refreshWorkspace,
  saveEnvironmentFile,
  selectedEnv,
  setSelectedEnv,
  state,
  toast,
} from "../store";
import type { EnvironmentTab as EnvironmentTabState } from "../store";
import type { EnvValue, Environment } from "../types";
import { Kbd } from "./Kbd";
import { applyBulk, BulkEditor, ViewToggle } from "./pageKv";
import VarInput from "./VarInput";
import "../overview.css";
import "../environments.css";

interface Props {
  tab: EnvironmentTabState;
  embedded?: boolean; // inside a collection's Environments sub-tab, which already names the owner
}

export default function EnvironmentTab({ tab, embedded }: Props) {
  const loaded = getEnvironment(tab.file);
  const [shown, setShown] = useState<Set<number>>(new Set());

  if (!loaded) return <div className="empty-state">Loading…</div>;
  return <Loaded tab={tab} env={loaded} shown={shown} setShown={setShown} embedded={embedded} />;
}

function Loaded({
  tab,
  env,
  shown,
  setShown,
  embedded,
}: {
  tab: EnvironmentTabState;
  env: Environment;
  shown: Set<number>;
  setShown: (s: Set<number>) => void;
  embedded?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [bulkChosen, setBulk] = useState(false);
  // Bulk edit is plain text, which would show secret values unmasked.
  const hasSecrets = env.values.some((r) => r.type === "secret");
  const bulk = bulkChosen && !hasSecrets;
  const keyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);

  function edit() {
    markEnvironmentDirty(tab.file);
  }

  async function handleSave() {
    try {
      await saveEnvironmentFile(tab.file);
      toast("Saved");
    } catch (err) {
      toast(String(err), "error");
    }
  }

  useLayoutEffect(() => {
    if (focusIndex.current != null) {
      keyRefs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  });

  function addRow() {
    env.values.push({ key: "", value: "", type: "default", enabled: true });
    setFilter("");
    focusIndex.current = env.values.length - 1;
    edit();
  }

  function removeRow(index: number) {
    env.values.splice(index, 1);
    // Revealed secrets are tracked by row index, so the ones after the deleted row move up.
    setShown(new Set([...shown].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))));
    edit();
  }

  // The workspace reads the owner from the saved file, so the change is saved before it is re-read.
  async function makeShared() {
    delete env["x-restly-collection"];
    try {
      await saveEnvironmentFile(tab.file);
      await refreshWorkspace();
      toast("Environment is now shared");
    } catch (err) {
      toast(String(err), "error");
    }
  }

  const ref = findFileRef("environment", tab.file);
  const orphan = !!ref && orphanedEnv(ref);
  const isGlobals = state.workspace?.globals === tab.file;
  const owner = ref?.collection ?? "";
  const ownerName = state.workspace?.collections.find((c) => c.file === owner)?.name;
  const active = !!ref && !orphan && selectedEnv(owner) === tab.file;
  const q = filter.trim().toLowerCase();
  const visible = env.values
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !q || row.key.toLowerCase().includes(q) || (row.type !== "secret" && (row.value ?? "").toLowerCase().includes(q)));

  return (
    <div className={`page env${embedded ? " embedded" : ""}`}>
      <div className="page-head">
        <div className="page-titles">
          <input
            className="page-title page-title-field"
            aria-label="Environment name"
            style={{ width: `${Math.max(env.name.length, 8) + 1}ch` }}
            value={env.name}
            onChange={(e) => {
              env.name = e.target.value;
              edit();
            }}
          />
          {embedded ? null : (
            <div className="page-meta">
              {isGlobals ? (
                <>
                  <Globe size={13} />
                  <span>Available in every collection</span>
                </>
              ) : ownerName && !orphan ? (
                <>
                  <Layers size={13} />
                  <span>Belongs to {ownerName}</span>
                </>
              ) : (
                <>
                  <Globe size={13} />
                  <span>{orphan ? "Not attached to a collection" : "Shared environment"}</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="page-acts">
          {active ? <span className="tag ok">Active</span> : null}
          {ref && !orphan && !active ? (
            <button className="ghost" onClick={() => setSelectedEnv(owner, tab.file)}>
              <CircleCheck size={13} /> Set active
            </button>
          ) : null}
          <button className="ghost" onClick={handleSave}>
            <Save size={13} /> Save <Kbd command="save" />
          </button>
        </div>
      </div>

      <div className="page-body">
        {orphan ? (
          <div className="banner" role="status">
            <CircleAlert size={14} />
            <span>The collection this environment belonged to was deleted, so no request can use it.</span>
            <button onClick={makeShared}>Make shared</button>
          </div>
        ) : null}

        <div className="toolrow">
          {bulk ? null : (
            <div className="filter">
              <Search size={13} />
              <input
                type="text"
                aria-label="Filter variables"
                placeholder="Filter variables"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          )}
          <span className="grow" />
          <ViewToggle bulk={bulk} onChange={setBulk} bulkDisabled={hasSecrets ? "Unavailable while this environment has secret variables" : undefined} />
        </div>

        {bulk ? (
          <BulkEditor
            rows={env.values.map((r) => ({ key: r.key, value: r.value ?? "", off: r.enabled === false }))}
            onChange={(parsed) => {
              applyBulk<EnvValue>(env.values, parsed, (old, b) => ({
                ...old,
                key: b.key,
                value: b.value,
                type: old?.type ?? "default",
                enabled: !b.off,
              }));
              edit();
            }}
          />
        ) : (
          <div className="pg-wrap">
            <table className="pg-table">
              <thead>
                <tr>
                  <th className="ck" />
                  <th className="w-var">Variable</th>
                  <th>Value</th>
                  <th className="w-type">Type</th>
                  <th className="acts" />
                </tr>
              </thead>
              <tbody>
                {visible.map(({ row, index }) => {
                  const isSecret = row.type === "secret";
                  const revealed = !isSecret || shown.has(index);
                  return (
                    <tr key={index} className={row.enabled === false ? "off" : ""}>
                      <td className="ck">
                        <input
                          type="checkbox"
                          aria-label="Enabled"
                          checked={row.enabled ?? true}
                          onChange={(e) => {
                            row.enabled = e.target.checked;
                            edit();
                          }}
                        />
                      </td>
                      <td className="in">
                        <VarInput
                          value={row.key}
                          placeholder="Variable"
                          inputRef={(el) => {
                            keyRefs.current[index] = el;
                          }}
                          onChange={(v) => {
                            row.key = v;
                            edit();
                          }}
                        />
                      </td>
                      <td className="in">
                        <div className="vcell">
                          {isSecret && !revealed ? (
                            <input
                              type="password"
                              className="mono"
                              aria-label="Value"
                              value={row.value ?? ""}
                              onChange={(e) => {
                                row.value = e.target.value;
                                edit();
                              }}
                            />
                          ) : (
                            <VarInput
                              value={row.value ?? ""}
                              placeholder="Value"
                              onChange={(v) => {
                                row.value = v;
                                edit();
                              }}
                            />
                          )}
                          {isSecret ? (
                            <button
                              className="icon pg-eye"
                              aria-label={revealed ? "Hide value" : "Show value"}
                              title={revealed ? "Hide" : "Show"}
                              onClick={() => {
                                const next = new Set(shown);
                                if (next.has(index)) next.delete(index);
                                else next.add(index);
                                setShown(next);
                              }}
                            >
                              {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="t">
                        <div className="segmented" role="group" aria-label="Type">
                          {(["default", "secret"] as const).map((type) => (
                            <button
                              key={type}
                              type="button"
                              className={(row.type ?? "default") === type ? "active" : ""}
                              aria-pressed={(row.type ?? "default") === type}
                              onClick={() => {
                                row.type = type;
                                edit();
                              }}
                            >
                              {type === "default" ? "Default" : "Secret"}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="acts">
                        <button className="icon pg-del" aria-label="Delete row" title="Delete" onClick={() => removeRow(index)}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {q && visible.length === 0 ? (
                  <tr className="pg-empty">
                    <td colSpan={5}>No variables match.</td>
                  </tr>
                ) : null}
                <tr className="pg-ghost" onClick={addRow}>
                  <td className="ck" />
                  <td>
                    <button className="pg-add" aria-label="Add variable">
                      Variable
                    </button>
                  </td>
                  <td>Value</td>
                  <td />
                  <td className="acts" />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
