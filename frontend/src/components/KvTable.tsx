import { useLayoutEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import Select from "./Select";
import VarInput from "./VarInput";
import type { KV } from "../types";
import "../kvtable.css";

interface Props {
  rows: KV[];
  onChange: () => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  formdata?: boolean; // adds a text/file type column; file rows edit `src` instead of `value`
  label?: string; // singular noun for what a row holds, e.g. "header", "param" — used for
  // the empty-state line ("No {label}s") and the Add button's title. Defaults to something
  // generic since not every caller knows to pass one.
}

// Shared table for params, headers, urlencoded, and form-data: an enabled checkbox
// (writes/deletes `disabled`), key, value, and a delete button. Rows persist until deleted,
// even if empty — new rows only appear via the Add button, never implicitly from typing.
export default function KvTable({ rows, onChange, keyPlaceholder = "Key", valuePlaceholder = "Value", formdata, label }: Props) {
  const rowLabel = label ?? (formdata ? "form field" : "row");
  const keyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (focusIndex.current != null) {
      keyRefs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  });

  function setEnabled(row: KV, enabled: boolean) {
    if (enabled) delete row.disabled;
    else row.disabled = true;
    onChange();
  }

  function remove(index: number) {
    rows.splice(index, 1);
    onChange();
  }

  function add() {
    rows.push({ key: "", value: "" });
    focusIndex.current = rows.length - 1;
    onChange();
  }

  if (rows.length === 0) {
    return (
      <div className="kv-empty">
        <p className="kv-empty-hint">No {rowLabel}s</p>
        <button className="ghost kv-add-btn" onClick={add}>
          <Plus size={13} /> Add
        </button>
      </div>
    );
  }

  return (
    <>
      <table className="kv-table">
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            <th>Key</th>
            <th>Value</th>
            {formdata ? <th style={{ width: 70 }}>Type</th> : null}
            <th style={{ width: 24 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isFile = formdata && row.type === "file";
            return (
              <tr key={index} className={row.disabled ? "disabled" : ""}>
                <td>
                  <input type="checkbox" checked={!row.disabled} onChange={(e) => setEnabled(row, e.target.checked)} />
                </td>
                <td>
                  <VarInput
                    value={row.key}
                    placeholder={keyPlaceholder}
                    inputRef={(el) => {
                      keyRefs.current[index] = el;
                    }}
                    onChange={(v) => {
                      row.key = v;
                      onChange();
                    }}
                  />
                </td>
                <td>
                  <VarInput
                    value={(isFile ? row.src : row.value) ?? ""}
                    placeholder={isFile ? "file path" : valuePlaceholder}
                    onChange={(v) => {
                      if (isFile) row.src = v;
                      else row.value = v;
                      onChange();
                    }}
                  />
                </td>
                {formdata ? (
                  <td>
                    <Select
                      value={row.type ?? "text"}
                      onChange={(v) => {
                        row.type = v as "text" | "file";
                        onChange();
                      }}
                      ariaLabel="Type"
                      options={[
                        { value: "text", label: "text" },
                        { value: "file", label: "file" },
                      ]}
                    />
                  </td>
                ) : null}
                <td>
                  <button className="kv-delete" onClick={() => remove(index)} aria-label="Delete row" title="Delete">
                    <X size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="ghost kv-add-btn" onClick={add}>
        <Plus size={13} /> Add
      </button>
    </>
  );
}
