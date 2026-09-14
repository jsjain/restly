import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "../select.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
}

// Generic replacement for a native select element: trigger button + portaled popover,
// matching MethodSelect's pattern but option-list-driven instead of hardcoded to HTTP methods.
export default function Select({ value, options, onChange, placeholder, className, ariaLabel, title, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef({ buffer: "", timer: 0 });

  const selected = options.find((o) => o.value === value);

  // Position under the trigger and reset transient state each time the popover opens.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    const idx = options.findIndex((o) => o.value === value);
    setHighlighted(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Flip above the trigger once we know the popover's rendered height and there isn't
  // room below for it.
  useLayoutEffect(() => {
    if (!open || !pos || !popoverRef.current || !triggerRef.current) return;
    const popRect = popoverRef.current.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    if (popRect.height > spaceBelow && triggerRect.top > popRect.height) {
      const top = triggerRect.top - popRect.height - 4;
      if (Math.abs(top - pos.top) > 0.5) setPos((p) => (p ? { ...p, top } : p));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos]);

  // Click-outside closes. Scroll/resize also close rather than reposition: the popover is
  // short-lived, so tracking scroll containers isn't worth it here. Scrolling inside the
  // popover's own option list doesn't count (that's a capture-phase scroll event too).
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onScrollOrResize(e: Event) {
      if (popoverRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  // Keep the highlighted option in view when navigating by keyboard.
  useEffect(() => {
    if (!open) return;
    const el = popoverRef.current?.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted]);

  function closeAndRefocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function pick(v: string) {
    onChange(v);
    closeAndRefocus();
  }

  function selectHighlighted() {
    const opt = options[highlighted];
    if (!opt || opt.disabled) return;
    pick(opt.value);
  }

  function nextEnabled(from: number, dir: 1 | -1): number {
    const n = options.length;
    if (n === 0) return from;
    let i = from;
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n;
      if (!options[i]?.disabled) return i;
    }
    return from;
  }

  function firstEnabled(): number {
    const idx = options.findIndex((o) => !o.disabled);
    return idx >= 0 ? idx : 0;
  }

  function lastEnabled(): number {
    for (let i = options.length - 1; i >= 0; i--) {
      if (!options[i].disabled) return i;
    }
    return Math.max(options.length - 1, 0);
  }

  // Accumulates typed characters into a prefix match (reset after a pause), like a native
  // select. Jumps the value directly when closed, or just moves the highlight when open.
  function typeahead(char: string) {
    const ta = typeaheadRef.current;
    window.clearTimeout(ta.timer);
    let buffer = ta.buffer + char;
    let idx = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(buffer));
    if (idx < 0) {
      buffer = char;
      idx = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(buffer));
    }
    ta.buffer = buffer;
    ta.timer = window.setTimeout(() => {
      ta.buffer = "";
    }, 600);
    if (idx < 0) return;
    if (open) setHighlighted(idx);
    else onChange(options[idx].value);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key;

    if (!open) {
      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        return;
      }
    } else {
      if (key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => nextEnabled(h, 1));
        return;
      }
      if (key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => nextEnabled(h, -1));
        return;
      }
      if (key === "Home") {
        e.preventDefault();
        setHighlighted(firstEnabled());
        return;
      }
      if (key === "End") {
        e.preventDefault();
        setHighlighted(lastEnabled());
        return;
      }
      if (key === "Enter") {
        e.preventDefault();
        selectHighlighted();
        return;
      }
      if (key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeAndRefocus();
        return;
      }
      if (key === "Tab") {
        setOpen(false);
        return;
      }
    }

    if (key.length === 1) {
      e.preventDefault();
      typeahead(key.toLowerCase());
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`select-trigger ${className ?? ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
      >
        <span className="select-value">
          {selected ? selected.label : <span className="select-placeholder">{placeholder ?? ""}</span>}
        </span>
        <span className="select-chevron" aria-hidden="true">
          <ChevronDown size={15} strokeWidth={1.75} />
        </span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              className="select-popover"
              role="listbox"
              aria-label={ariaLabel}
              style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
              onKeyDown={handleKeyDown}
              tabIndex={-1}
            >
              {options.map((opt, i) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  disabled={opt.disabled}
                  className={`select-option ${highlighted === i ? "highlighted" : ""}`}
                  onMouseEnter={() => !opt.disabled && setHighlighted(i)}
                  onClick={() => !opt.disabled && pick(opt.value)}
                >
                  <span className="select-check">{opt.value === value ? <Check size={14} strokeWidth={2} /> : null}</span>
                  <span className="select-option-label">{opt.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
