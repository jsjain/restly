// Centered command palette: "all" (commands + requests + environments + recent), "requests"
// (quick-open) or "environments" (switcher). Rendered by Overlays.tsx on "restly:open-palette".
//
// Wiring: none needed beyond Overlays.tsx already rendering this. It reads collections/
// environments/history straight off the store, so it stays current as other components edit
// them (App re-renders the whole tree on every store bump; see App.tsx's useSyncExternalStore).
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { state, ensureCollection, getCollection, setSelectedEnv, selectedEnv, envOwner, usableEnvs, openRequestTab, openDraftTab, toast } from "../store";
import type { Item } from "../types";
import { listCommands } from "../commands";
import type { PaletteMode } from "../commands";
import { formatKeys } from "../shortcuts";
import { fuzzyFilter, highlight } from "../fuzzy";
import { methodClass } from "../method";
import { isWebSocket } from "../websocket";
import { urlRaw } from "../urlutil";

interface Props {
  mode: PaletteMode;
  onClose: () => void;
}

interface Row {
  id: string;
  badge?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  keys?: string;
  onSelect(): void;
}

interface RequestEntry {
  item: Item;
  file: string;
  path: number[];
  collName: string;
  folderPath: string[];
  url: string;
}

const MAX_ROWS = 100; // spec cap in lieu of virtualizing a plain-CSS list

function flattenRequests(): RequestEntry[] {
  const rows: RequestEntry[] = [];
  function walk(items: Item[] | undefined, file: string, path: number[], collName: string, folderPath: string[]): void {
    (items ?? []).forEach((item, i) => {
      const itemPath = [...path, i];
      if (item.request) rows.push({ item, file, path: itemPath, collName, folderPath, url: urlRaw(item.request.url) });
      else walk(item.item, file, itemPath, collName, [...folderPath, item.name]);
    });
  }
  for (const ref of state.workspace?.collections ?? []) {
    const coll = getCollection(ref.file);
    if (coll) walk(coll.item, ref.file, [], coll.info.name ?? ref.name, []);
  }
  return rows;
}

function methodBadge(item: Item): ReactNode {
  const label = isWebSocket(item) ? "WS" : item.request!.method;
  return <span className={`method-badge method-${isWebSocket(item) ? "WS" : methodClass(item.request!.method)}`}>{label}</span>;
}

export default function CommandPalette({ mode, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Requests are searched "from all collections" per spec, so load every one up front.
    (state.workspace?.collections ?? []).forEach((ref) => {
      ensureCollection(ref.file).catch((err) => toast(String(err), "error"));
    });
  }, []);

  useEffect(() => setActiveIndex(0), [query, mode]);

  const commandsOnly = mode === "all" && query.trimStart().startsWith(">");
  const effectiveQuery = commandsOnly ? query.trimStart().slice(1).trimStart() : query;

  const groups: { label: string; rows: Row[] }[] = [];

  if (mode === "all") {
    const visible = listCommands().filter((c) => !c.when || c.when());
    const rows = fuzzyFilter(visible, effectiveQuery, (c) => c.title).map(
      (m): Row => ({
        id: `cmd:${m.item.id}`,
        title: highlight(m.item.title, m.indices),
        subtitle: m.item.group,
        keys: m.item.keys?.[0] ? formatKeys(m.item.keys[0].split("+")) : undefined,
        onSelect: () => {
          m.item.run();
          onClose();
        },
      })
    );
    groups.push({ label: "Commands", rows });
  }

  if (!commandsOnly && (mode === "all" || mode === "requests")) {
    const entries = flattenRequests();
    const rows = fuzzyFilter(entries, effectiveQuery, [(e) => e.item.name, (e) => e.url, (e) => e.collName]).map(
      (m): Row => {
        const e = m.item;
        const breadcrumb = [e.collName, ...e.folderPath].join(" › ");
        return {
          id: `req:${e.file}:${e.path.join(",")}`,
          badge: methodBadge(e.item),
          title: m.field === 0 ? highlight(e.item.name, m.indices) : e.item.name,
          subtitle: (
            <>
              {m.field === 2 ? highlight(breadcrumb, m.indices) : breadcrumb} · {m.field === 1 ? highlight(e.url, m.indices) : e.url}
            </>
          ),
          onSelect: () => {
            openRequestTab(e.file, e.path);
            onClose();
          },
        };
      }
    );
    groups.push({ label: "Requests", rows });
  }

  if (!commandsOnly && (mode === "all" || mode === "environments")) {
    const owner = envOwner();
    const current = selectedEnv(owner);
    const envs = [{ file: "", name: "No Environment" }, ...usableEnvs(owner)];
    const rows = fuzzyFilter(envs, effectiveQuery, (e) => e.name).map(
      (m): Row => ({
        id: `env:${m.item.file}`,
        title: highlight(m.item.name, m.indices),
        subtitle: m.item.file === current ? "current" : undefined,
        onSelect: () => {
          setSelectedEnv(owner, m.item.file);
          onClose();
        },
      })
    );
    groups.push({ label: "Environments", rows });
  }

  if (!commandsOnly && mode === "all") {
    const recent = state.history.slice(0, 30);
    const rows = fuzzyFilter(recent, effectiveQuery, [(h) => h.item.name || h.url, (h) => h.url]).map(
      (m): Row => ({
        id: `hist:${m.item.id}`,
        badge: <span className={`method-badge method-${methodClass(m.item.method)}`}>{m.item.method}</span>,
        title: m.field === 0 ? highlight(m.item.item.name || m.item.url, m.indices) : m.item.item.name || m.item.url,
        subtitle: m.field === 1 ? highlight(m.item.url, m.indices) : m.item.url,
        onSelect: () => {
          openDraftTab(structuredClone(m.item.item));
          onClose();
        },
      })
    );
    groups.push({ label: "Recent", rows });
  }

  let budget = MAX_ROWS;
  const rendered = groups
    .map((g) => {
      const rows = g.rows.slice(0, budget);
      budget -= rows.length;
      return { label: g.label, rows };
    })
    .filter((g) => g.rows.length > 0);
  const flatRows = rendered.flatMap((g) => g.rows);

  function move(delta: 1 | -1): void {
    if (flatRows.length === 0) return;
    setActiveIndex((i) => (i + delta + flatRows.length) % flatRows.length);
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      flatRows[activeIndex]?.onSelect();
    }
  }

  const placeholder =
    mode === "requests" ? "Search requests…" : mode === "environments" ? "Switch environment…" : "Type a command or search… (> for commands only)";

  return createPortal(
    <div className="overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-panel" role="dialog" aria-modal="true" aria-label="Command Palette">
        <div className="overlay-input-row">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-activedescendant={flatRows[activeIndex]?.id}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
          />
          {mode !== "all" ? <span className="overlay-mode">{mode === "requests" ? "Requests" : "Environments"}</span> : null}
        </div>
        <div className="overlay-list" role="listbox" id="palette-listbox">
          {flatRows.length === 0 ? <div className="overlay-empty">No results</div> : null}
          {rendered.map((group) => (
            <div key={group.label}>
              <div className="overlay-group-title">{group.label}</div>
              {group.rows.map((row) => {
                const idx = flatRows.indexOf(row);
                return (
                  <div
                    key={row.id}
                    id={row.id}
                    role="option"
                    aria-selected={idx === activeIndex}
                    className={`overlay-row ${idx === activeIndex ? "active" : ""}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => row.onSelect()}
                  >
                    {row.badge}
                    <span className="overlay-title">{row.title}</span>
                    {row.subtitle ? <span className="overlay-subtitle">{row.subtitle}</span> : null}
                    {row.keys ? <span className="overlay-keys">{row.keys}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
