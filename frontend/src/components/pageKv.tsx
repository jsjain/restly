import { useState } from "react";
import { methodClass } from "../method";

// Pieces shared by the full-page tabs (collection variables, environments, runner, overview).

const SHORT_METHOD: Record<string, string> = { DELETE: "DEL", OPTIONS: "OPT" };

export function MethodTag({ method, ws }: { method: string; ws?: boolean }) {
  return (
    <span className={`method-badge method-${ws ? "ws" : methodClass(method)}`}>{ws ? "WS" : (SHORT_METHOD[method] ?? method)}</span>
  );
}

// Table | Bulk edit switch above a key-value table.
// bulkDisabled carries the reason bulk edit is unavailable, shown as its tooltip.
export function ViewToggle({ bulk, onChange, bulkDisabled }: { bulk: boolean; onChange: (bulk: boolean) => void; bulkDisabled?: string }) {
  return (
    <div className="segmented" role="group" aria-label="Edit mode">
      <button type="button" className={bulk ? "" : "active"} aria-pressed={!bulk} onClick={() => onChange(false)}>
        Table
      </button>
      <button
        type="button"
        className={bulk ? "active" : ""}
        aria-pressed={bulk}
        disabled={!!bulkDisabled}
        title={bulkDisabled}
        onClick={() => onChange(true)}
      >
        Bulk edit
      </button>
    </div>
  );
}

// Bulk text is one "key: value" per line, a leading "//" marks a disabled row.
export interface BulkRow {
  key: string;
  value: string;
  off: boolean;
}

export function formatBulk(rows: BulkRow[]): string {
  return rows.map((r) => `${r.off ? "// " : ""}${r.key}: ${r.value}`).join("\n");
}

export function parseBulk(text: string): BulkRow[] {
  const out: BulkRow[] = [];
  for (const line of text.split("\n")) {
    let t = line.trim();
    const off = t.startsWith("//");
    if (off) t = t.slice(2).trim();
    if (!t) continue;
    const i = t.indexOf(":");
    const key = (i < 0 ? t : t.slice(0, i)).trim();
    if (key) out.push({ key, value: i < 0 ? "" : t.slice(i + 1).trim(), off });
  }
  return out;
}

// Replaces rows with the parsed lines. A line keeps the row with the same key, else the row at its
// own position, so fields the text cannot show (descriptions, secret type) survive edits.
export function applyBulk<T extends { key: string }>(rows: T[], parsed: BulkRow[], build: (old: T | undefined, b: BulkRow) => T): void {
  const used = new Set<number>();
  const byKey = parsed.map((b) => {
    const i = rows.findIndex((r, ri) => !used.has(ri) && r.key === b.key);
    if (i >= 0) used.add(i);
    return i;
  });
  const next = parsed.map((b, pi) => {
    let i = byKey[pi];
    if (i < 0 && pi < rows.length && !used.has(pi)) {
      i = pi;
      used.add(pi);
    }
    return build(i >= 0 ? rows[i] : undefined, b);
  });
  rows.splice(0, rows.length, ...next);
}

// The text is local state, so blank lines and half-typed lines survive while the rows are rebuilt.
export function BulkEditor({ rows, onChange }: { rows: BulkRow[]; onChange: (rows: BulkRow[]) => void }) {
  const [text, setText] = useState(() => formatBulk(rows));
  return (
    <textarea
      className="pg-bulk mono"
      aria-label="Bulk edit"
      spellCheck={false}
      placeholder="key: value"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseBulk(e.target.value));
      }}
    />
  );
}
