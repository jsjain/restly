import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import Select from "./Select";
import VarInput from "./VarInput";
import type { KV } from "../types";
import "../kvtable.css";
import { readDescription, setRowDescription } from "../description";

interface Props {
  rows: KV[];
  onChange: () => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  formdata?: boolean; // adds a text/file type column; file rows edit `src` instead of `value`
  description?: boolean; // adds a free-text description column
  label?: string; // singular noun for what a row holds, e.g. "header", "param", used in aria labels
}

type Field = "key" | "value";

// Shared table for params, headers, urlencoded, and form-data: an enabled checkbox
// (writes/deletes `disabled`), key, value, an optional description, and a delete button. The
// last row is a blank ghost row: typing in it appends a real row and moves focus there.
export default function KvTable({ rows, onChange, keyPlaceholder = "Key", valuePlaceholder = "Value", formdata, description, label }: Props) {
  const rowLabel = label ?? (formdata ? "form field" : "row");
  const refs = useRef<Record<Field, (HTMLInputElement | null)[]>>({ key: [], value: [] });
  const focus = useRef<{ index: number; field: Field } | null>(null);

  useLayoutEffect(() => {
    const target = focus.current;
    if (!target) return;
    focus.current = null;
    const el = refs.current[target.field][target.index];
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
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

  function addFrom(field: Field, text: string) {
    rows.push(field === "key" ? { key: text, value: "" } : { key: "", value: text });
    focus.current = { index: rows.length - 1, field };
    onChange();
  }

  return (
    <div className="kv-frame">
      <table className="kv-table">
        <thead>
          <tr>
            <th className="kv-ck"></th>
            <th>Key</th>
            <th>Value</th>
            {formdata ? <th className="kv-type">Type</th> : null}
            {description ? <th>Description</th> : null}
            <th className="kv-acts"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isFile = formdata && row.type === "file";
            return (
              <tr key={index} className={row.disabled ? "disabled" : ""}>
                <td className="kv-ck">
                  <input
                    type="checkbox"
                    checked={!row.disabled}
                    aria-label={`Enable ${rowLabel}`}
                    onChange={(e) => setEnabled(row, e.target.checked)}
                  />
                </td>
                <td>
                  <VarInput
                    value={row.key}
                    placeholder={keyPlaceholder}
                    inputRef={(el) => {
                      refs.current.key[index] = el;
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
                    inputRef={(el) => {
                      refs.current.value[index] = el;
                    }}
                    onChange={(v) => {
                      if (isFile) row.src = v;
                      else row.value = v;
                      onChange();
                    }}
                  />
                </td>
                {formdata ? (
                  <td className="kv-type">
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
                {description ? (
                  <td>
                    <input
                      type="text"
                      className="kv-desc"
                      value={readDescription(row.description)}
                      aria-label="Description"
                      onChange={(e) => {
                        setRowDescription(row, e.target.value);
                        onChange();
                      }}
                    />
                  </td>
                ) : null}
                <td className="kv-acts">
                  <button className="kv-delete" onClick={() => remove(index)} aria-label={`Delete ${rowLabel}`} title="Delete">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            );
          })}
          <tr className="kv-ghost">
            <td className="kv-ck"></td>
            <td>
              <VarInput value="" placeholder={keyPlaceholder} onChange={(v) => addFrom("key", v)} />
            </td>
            <td>
              <VarInput value="" placeholder={valuePlaceholder} onChange={(v) => addFrom("value", v)} />
            </td>
            {formdata ? <td className="kv-type"></td> : null}
            {description ? <td></td> : null}
            <td className="kv-acts"></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// "key: value" per line, "// " in front of a disabled row.
function toLine(row: KV): string {
  return `${row.disabled ? "// " : ""}${row.key}: ${row.value ?? ""}`;
}

function parseLines(text: string): KV[] {
  const out: KV[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (line === "") continue;
    const disabled = line.startsWith("//");
    if (disabled) line = line.replace(/^\/\/\s*/, "");
    const colon = line.indexOf(":");
    const row: KV = colon === -1 ? { key: line, value: "" } : { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
    if (disabled) row.disabled = true;
    out.push(row);
  }
  return out;
}

const toText = (rows: KV[]) => rows.map(toLine).join("\n");

// The table's rows as editable text. Edits apply to `rows` as they are typed, so leaving bulk edit
// needs no commit step. A row keeps its description when a line with the same key is still there.
export function KvBulkEdit({ rows, onChange, label }: { rows: KV[]; onChange: () => void; label?: string }) {
  const [text, setText] = useState(() => toText(rows));
  // Descriptions seen so far, by key, so a key that is briefly mistyped does not lose its own.
  const descriptions = useRef(new Map<string, KV["description"]>());
  for (const r of rows) if (r.description) descriptions.current.set(r.key, r.description);

  // Rows changed from outside, such as the URL bar rewriting the query: show them.
  const current = toText(rows);
  useEffect(() => {
    if (current !== toText(parseLines(text))) setText(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  function edit(next: string) {
    setText(next);
    const parsed = parseLines(next).map((row) => {
      const description = descriptions.current.get(row.key);
      return description ? { ...row, description } : row;
    });
    rows.splice(0, rows.length, ...parsed);
    onChange();
  }

  return (
    <textarea
      className="kv-bulk mono"
      value={text}
      spellCheck={false}
      aria-label={`Bulk edit ${label ?? "row"}s`}
      placeholder={"key: value\n// disabled: row"}
      onChange={(e) => edit(e.target.value)}
    />
  );
}
