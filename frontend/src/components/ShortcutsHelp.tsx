// Keyboard shortcuts reference: every registered command with keys, grouped, with a filter
// box. Rendered by Overlays.tsx on "restly:open-shortcuts" (mod+/).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listCommands } from "../commands";
import { formatKeys, effectiveKeys, isCustomized } from "../shortcuts";
import { fuzzyFilter, highlight } from "../fuzzy";
import * as api from "../api";
import { toast } from "../store";

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
    <div className="overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-panel" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts">
        <div className="overlay-input-row">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Filter shortcuts…"
          />
          <button
            type="button"
            onClick={() => api.openKeybindings().catch((err) => toast(String(err), "error"))}
          >
            Open keybindings.json
          </button>
        </div>
        <div className="shortcuts-help">
          {groups.length === 0 ? <div className="overlay-empty">No matching shortcuts</div> : null}
          {groups.map(([group, matches]) => (
            <div key={group} className="shortcuts-help-group">
              <div className="shortcuts-help-group-title">{group}</div>
              {matches.map((m) => (
                <div key={m.item.id} className="shortcuts-help-row">
                  <span>
                    {highlight(m.item.title, m.indices)}
                    {isCustomized(m.item) ? <span title="Changed by keybindings.json"> *</span> : null}
                    <span style={{ fontSize: "0.75em", opacity: 0.5, userSelect: "text", marginLeft: "0.5em" }}>{m.item.id}</span>
                  </span>
                  <span className="overlay-keys">{effectiveKeys(m.item).map((k) => formatKeys(k.split("+"))).join(" / ")}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
