import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "../methodSelect.css";

interface Props {
  value: string;
  onChange: (method: string) => void;
  disabled?: boolean;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_CLASS: Record<string, string> = {
  GET: "get",
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete",
  HEAD: "head",
  OPTIONS: "options",
};

function colorClass(method: string): string {
  return `ms-color-${METHOD_CLASS[method] ?? "other"}`;
}

// "g" -> GET, "d" -> DELETE, "p" cycles POST -> PUT -> PATCH -> POST based on the current
// value (stateless, so it stays correct if the value changed from elsewhere in between).
function typeaheadTarget(lower: string, current: string): string | null {
  if (lower === "g") return "GET";
  if (lower === "d") return "DELETE";
  if (lower === "p") {
    if (current === "POST") return "PUT";
    if (current === "PUT") return "PATCH";
    return "POST";
  }
  return null;
}

type OptionItem = { method: string; isCustomCurrent?: boolean } | { customEntry: true };

export default function MethodSelect({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [customEditing, setCustomEditing] = useState(false);
  const [customText, setCustomText] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  const isKnown = METHODS.includes(value);
  const options: OptionItem[] = [
    ...METHODS.map((m) => ({ method: m })),
    ...(!isKnown ? [{ method: value, isCustomCurrent: true } as OptionItem] : []),
    { customEntry: true } as OptionItem,
  ];

  // Position under the trigger and reset transient state each time the popover opens.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 180) });
    const idx = options.findIndex((o) => "method" in o && o.method === value);
    setHighlighted(idx >= 0 ? idx : 0);
    setCustomEditing(false);
    setCustomText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Click-outside closes. Scroll/resize also close rather than reposition: the popover is
  // short-lived, so tracking scroll containers isn't worth it here.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onScrollOrResize() {
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

  useEffect(() => {
    if (customEditing) customInputRef.current?.focus();
  }, [customEditing]);

  function closeAndRefocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function pick(method: string) {
    onChange(method);
    closeAndRefocus();
  }

  function selectHighlighted() {
    const opt = options[highlighted];
    if (!opt) return;
    if ("customEntry" in opt) {
      setCustomEditing(true);
      return;
    }
    pick(opt.method);
  }

  function applyCustom() {
    const v = customText.trim().toUpperCase();
    if (v) onChange(v);
    setCustomEditing(false);
    setCustomText("");
    closeAndRefocus();
  }

  // Shared by the trigger and the popover: which element currently has focus doesn't
  // matter, since we never move DOM focus into the list (highlighting is state-only).
  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key;

    if (customEditing) {
      if (key === "Enter") {
        e.preventDefault();
        applyCustom();
      } else if (key === "Escape") {
        e.preventDefault();
        setCustomEditing(false);
        setCustomText("");
      }
      return;
    }

    if (!open) {
      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        return;
      }
    } else {
      if (key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => (h + 1) % options.length);
        return;
      }
      if (key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => (h - 1 + options.length) % options.length);
        return;
      }
      if (key === "Enter") {
        e.preventDefault();
        selectHighlighted();
        return;
      }
      if (key === "Escape") {
        e.preventDefault();
        closeAndRefocus();
        return;
      }
      if (key === "Tab") {
        setOpen(false);
        return;
      }
    }

    if (key.length === 1) {
      const target = typeaheadTarget(key.toLowerCase(), value);
      if (!target) return;
      e.preventDefault();
      if (open) {
        const idx = options.findIndex((o) => "method" in o && o.method === target);
        if (idx >= 0) setHighlighted(idx);
      } else {
        onChange(target);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="method-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
      >
        <span className={`method-select-label ${colorClass(value)}`}>{value}</span>
        <span className="method-select-chevron" aria-hidden="true">
          <ChevronDown size={15} strokeWidth={1.75} />
        </span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              className="method-select-popover"
              role="listbox"
              style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
              onKeyDown={handleKeyDown}
              tabIndex={-1}
            >
              {options.map((opt, i) => {
                if ("customEntry" in opt) {
                  return customEditing ? (
                    <input
                      key="custom-input"
                      ref={customInputRef}
                      type="text"
                      className="method-select-custom-input mono"
                      value={customText}
                      placeholder="Custom method"
                      onChange={(e) => setCustomText(e.target.value)}
                      onBlur={() => {
                        setCustomEditing(false);
                        setCustomText("");
                      }}
                    />
                  ) : (
                    <button
                      key="custom-entry"
                      type="button"
                      role="option"
                      aria-selected={false}
                      className={`method-select-option ${highlighted === i ? "highlighted" : ""}`}
                      onMouseEnter={() => setHighlighted(i)}
                      onClick={() => setCustomEditing(true)}
                    >
                      <span className="method-select-check" />
                      <span className="method-select-custom-label">Custom…</span>
                    </button>
                  );
                }
                const selected = opt.method === value;
                return (
                  <button
                    key={opt.method + (opt.isCustomCurrent ? "-current" : "")}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`method-select-option ${highlighted === i ? "highlighted" : ""}`}
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => pick(opt.method)}
                  >
                    <span className="method-select-check">{selected ? <Check size={14} strokeWidth={2} /> : null}</span>
                    <span className={`method-select-option-label ${colorClass(opt.method)}`}>{opt.method}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
