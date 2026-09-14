import { useLayoutEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { getEnvironment, markEnvironmentDirty, notifyChange, saveEnvironmentFile, toast } from "../store";
import type { EnvironmentTab as EnvironmentTabState } from "../store";
import type { Environment } from "../types";
import Select from "./Select";
import VarInput from "./VarInput";
import "../kvtable.css";

interface Props {
  tab: EnvironmentTabState;
}

export default function EnvironmentTab({ tab }: Props) {
  const loaded = getEnvironment(tab.file);
  const [shown, setShown] = useState<Set<number>>(new Set());

  if (!loaded) return <div className="empty-state">Loading…</div>;
  return <Loaded tab={tab} env={loaded} shown={shown} setShown={setShown} />;
}

function Loaded({
  tab,
  env,
  shown,
  setShown,
}: {
  tab: EnvironmentTabState;
  env: Environment;
  shown: Set<number>;
  setShown: (s: Set<number>) => void;
}) {
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

  const keyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (focusIndex.current != null) {
      keyRefs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  });

  function addRow() {
    env.values.push({ key: "", value: "", type: "default", enabled: true });
    focusIndex.current = env.values.length - 1;
    edit();
  }

  return (
    <div className="subtab-body">
      <div className="field-row">
        <label>Name</label>
        <input
          type="text"
          value={env.name}
          onChange={(e) => {
            env.name = e.target.value;
            edit();
          }}
        />
        <button className="primary" onClick={handleSave}>
          Save
        </button>
      </div>

      {env.values.length === 0 ? (
        <div className="kv-empty">
          <p className="kv-empty-hint">No variables</p>
          <button className="ghost kv-add-btn" onClick={addRow}>
            <Plus size={13} /> Add
          </button>
        </div>
      ) : (
        <>
          <table className="kv-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Key</th>
                <th>Value</th>
                <th style={{ width: 90 }}>Type</th>
                <th style={{ width: 24 }}></th>
              </tr>
            </thead>
            <tbody>
              {env.values.map((row, index) => {
                const isSecret = row.type === "secret";
                const visible = !isSecret || shown.has(index);
                return (
                  <tr key={index}>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.enabled ?? true}
                        onChange={(e) => {
                          row.enabled = e.target.checked;
                          edit();
                        }}
                      />
                    </td>
                    <td>
                      <VarInput
                        value={row.key}
                        inputRef={(el) => {
                          keyRefs.current[index] = el;
                        }}
                        onChange={(v) => {
                          row.key = v;
                          edit();
                        }}
                      />
                    </td>
                    <td style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {isSecret && !visible ? (
                        <input
                          type="password"
                          className="mono"
                          value={row.value ?? ""}
                          onChange={(e) => {
                            row.value = e.target.value;
                            edit();
                          }}
                        />
                      ) : (
                        <VarInput
                          value={row.value ?? ""}
                          onChange={(v) => {
                            row.value = v;
                            edit();
                          }}
                        />
                      )}
                      {isSecret ? (
                        <button
                          className="icon"
                          onClick={() => {
                            const next = new Set(shown);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            setShown(next);
                          }}
                        >
                          {visible ? "hide" : "show"}
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <Select
                        value={row.type ?? "default"}
                        onChange={(v) => {
                          row.type = v as "default" | "secret";
                          edit();
                        }}
                        ariaLabel="Type"
                        options={[
                          { value: "default", label: "default" },
                          { value: "secret", label: "secret" },
                        ]}
                      />
                    </td>
                    <td>
                      <button
                        className="kv-delete"
                        aria-label="Delete row"
                        title="Delete"
                        onClick={() => {
                          env.values.splice(index, 1);
                          edit();
                          notifyChange();
                        }}
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="ghost kv-add-btn" onClick={addRow}>
            <Plus size={13} /> Add
          </button>
        </>
      )}
    </div>
  );
}
