// Right-click / middle-click menu for a tab. Rendered in a portal so it isn't clipped by the
// tab bar's overflow, and clamped to the viewport since a tab near the window edge would
// otherwise render partly off-screen.
//
// Wiring (Tabs.tsx, not done here): give each tab row
//   onAuxClick={(e) => { if (e.button === 1) requestClose(tab); }}
//   onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}  // stops middle-click autoscroll
//   onContextMenu={(e) => { e.preventDefault(); setMenu({ tab, x: e.clientX, y: e.clientY }); }}
// and render <TabContextMenu tab={menu.tab} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
// when `menu` is set.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tab } from "../store";
import { requestClose, closeOthers, closeToRight, closeSaved, closeAll, duplicateTab, copyUrl, revealInSidebar, tabItem } from "../tabActions";
import { listCommands } from "../commands";
import { formatKeys } from "../shortcuts";

interface Props {
  tab: Tab;
  x: number;
  y: number;
  onClose: () => void;
}

function keyHint(commandId: string): string | undefined {
  const keys = listCommands().find((c) => c.id === commandId)?.keys?.[0];
  return keys ? formatKeys(keys.split("+")) : undefined;
}

interface Item {
  id: string;
  label: string;
  keys?: string;
  onSelect: () => void;
}

export default function TabContextMenu({ tab, x, y, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [activeIndex, setActiveIndex] = useState(0);
  const isSavedRequest = tab.kind === "request" && tab.file !== "";
  const canDuplicate = !!tabItem(tab);

  const items: Item[] = [
    { id: "close", label: "Close", keys: keyHint("close-tab"), onSelect: () => requestClose(tab) },
    { id: "close-others", label: "Close Other Tabs", onSelect: () => closeOthers(tab) },
    { id: "close-right", label: "Close Tabs to the Right", onSelect: () => closeToRight(tab) },
    { id: "close-saved", label: "Close Saved Tabs", onSelect: () => closeSaved() },
    { id: "close-all", label: "Close All", onSelect: () => closeAll() },
  ];
  if (canDuplicate) items.push({ id: "duplicate", label: "Duplicate Tab", keys: keyHint("duplicate-tab"), onSelect: () => duplicateTab(tab) });
  if (canDuplicate) items.push({ id: "copy-url", label: "Copy URL", onSelect: () => void copyUrl(tab) });
  if (isSavedRequest) items.push({ id: "reveal", label: "Reveal in Sidebar", onSelect: () => revealInSidebar(tab) });

  function run(item: Item): void {
    item.onSelect();
    onClose();
  }

  // Clamp after the first layout, once we know the menu's actual size, and take keyboard
  // focus so arrows/Enter/Escape work without the user clicking first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 4);
    const top = Math.min(y, window.innerHeight - rect.height - 4);
    setPos({ left: Math.max(4, left), top: Math.max(4, top) });
    el.focus();
  }, [x, y]);

  useLayoutEffect(() => {
    function onMouseDown(e: MouseEvent): void {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onScroll(): void {
      onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", onScroll, { capture: true, once: true });
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("blur", onClose);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[activeIndex]);
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="tab-context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      {items.map((item, i) => (
        <div key={item.id}>
          {item.id === "duplicate" ? <div className="tab-context-menu-separator" /> : null}
          <button
            type="button"
            role="menuitem"
            className={`tab-context-menu-item ${i === activeIndex ? "active" : ""}`}
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => run(item)}
          >
            <span>{item.label}</span>
            {item.keys ? <span className="overlay-keys">{item.keys}</span> : null}
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
