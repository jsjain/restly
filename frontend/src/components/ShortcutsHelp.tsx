// Keyboard shortcuts reference: every registered command with keys, grouped, with a filter
// box. Rendered by Overlays.tsx on "restly:open-shortcuts" (mod+/).
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileText, Search } from "lucide-react";
import { listCommands } from "../commands";
import { effectiveKeys, formatKeys, isCustomized } from "../shortcuts";
import { fuzzyFilter, highlight } from "../fuzzy";
import * as api from "../api";
import { toast } from "../store";
import { Kbd } from "./Kbd";

interface Props {
  onClose: () => void;
}

export default function ShortcutsHelp({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const groups = useMemo(() => {
    // Every command is listed, including ones with no default key (e.g. Close All Tabs), so a
    // user can find its id to bind in keybindings.json.
    const matches = fuzzyFilter(listCommands(), query, (c) => c.title);
    const byGroup = new Map<string, typeof matches>();
    for (const m of matches) {
      const list = byGroup.get(m.item.group) ?? [];
      list.push(m);
      byGroup.set(m.item.group, list);
    }
    return [...byGroup.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return createPortal(
    <div className="overlay-backdrop centered" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-panel shortcuts-dialog" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts" onKeyDown={onKeyDown}>
        <div className="shortcuts-head">
          <h2>Keyboard shortcuts</h2>
          <Kbd command="keyboard-shortcuts" />
        </div>
        <div className="shortcuts-tools">
          <div className="shortcuts-filter">
            <Search size={14} strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter shortcuts"
              aria-label="Filter shortcuts"
            />
          </div>
          <button
            type="button"
            className="ghost"
            onClick={() => api.openKeybindings().catch((err) => toast(String(err), "error"))}
          >
            <FileText size={14} strokeWidth={1.75} aria-hidden="true" />
            Open keybindings.json
          </button>
        </div>
        <div className="shortcuts-help">
          {groups.length === 0 ? <div className="overlay-empty">No matching shortcuts</div> : null}
          {groups.map(([group, matches]) => (
            <div key={group} className="shortcuts-help-group">
              <div className="shortcuts-help-group-title">{group}</div>
              {matches.map((m) => (
                <ShortcutRow key={m.item.id} id={m.item.id} keys={effectiveKeys(m.item)} custom={isCustomized(m.item)}>
                  {highlight(m.item.title, m.indices)}
                </ShortcutRow>
              ))}
            </div>
          ))}
        </div>
        <div className="shortcuts-foot">
          <span>Edit keybindings.json to rebind a shortcut.</span>
          <button type="button" onClick={onClose}>
            Close <Kbd keys="escape" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// One chord per row keeps rows a single line. A second chord follows "or"; more than two collapse
// into "+N", with every chord listed in the row's tooltip.
export function ShortcutRow({ id, keys, custom, children }: { id: string; keys: string[]; custom: boolean; children: ReactNode }) {
  const shown = keys.length > 2 ? keys.slice(0, 1) : keys;
  const all = keys.map((k) => formatKeys(k.split("+"))).join(", ");
  return (
    <div className="shortcuts-help-row" title={keys.length ? `${id}: ${all}` : id}>
      <span className="shortcuts-help-title">{children}</span>
      {custom ? <span className="tag info" title="Changed by keybindings.json">custom</span> : null}
      <span className="shortcuts-help-keys">
        {shown.map((k, i) => (
          <Fragment key={k}>
            {i > 0 ? <span className="shortcuts-help-or">or</span> : null}
            <Kbd keys={k} />
          </Fragment>
        ))}
        {keys.length > 2 ? <span className="shortcuts-help-or">+{keys.length - 1}</span> : null}
      </span>
    </div>
  );
}
