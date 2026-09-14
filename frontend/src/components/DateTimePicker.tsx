import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import "../dateTimePicker.css";

interface Props {
  value: Date | null; // null renders the placeholder ("Session" for cookies with no expiry)
  onChange: (value: Date | null) => void;
  placeholder?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]; // Monday-first grid

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDisplay(d: Date): string {
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

// Monday-before-the-1st through enough days to fill 6 full weeks (42 cells).
function buildGrid(monthStart: Date): Date[] {
  const firstWeekday = (monthStart.getDay() + 6) % 7; // 0 = Monday
  const gridStart = addDays(monthStart, -firstWeekday);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

// Themed replacement for a native datetime-local input: a trigger button showing the
// formatted value (or placeholder when null) and a portaled popover with a month grid plus
// hour/minute fields. Picking a day, editing the time, or clicking Now only updates the
// popover's own draft; onChange only fires on Done (commits the draft) or Session cookie
// (commits null), same as a native date picker only firing once a value is confirmed.
export default function DateTimePicker({ value, onChange, placeholder = "Session" }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => value ?? new Date());
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(value ?? new Date()));
  const [focused, setFocused] = useState<Date>(() => value ?? new Date());
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  function openPicker() {
    const base = value ?? new Date();
    setDraft(base);
    setViewMonth(startOfMonth(base));
    setFocused(base);
    setOpen(true);
  }

  function closeAndRefocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

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

  // Keep the roving-tabindex day in view and focused as keyboard nav moves it. Depends on
  // `pos` too: the popover (and its day buttons) only mount once `pos` is computed, one
  // render after `open` flips true, so an effect keyed on `open` alone would fire too early
  // and find `dayRefs` still empty.
  useEffect(() => {
    if (!open || !pos) return;
    dayRefs.current.get(focused.toDateString())?.focus();
  }, [open, pos, focused]);

  function pickDay(day: Date) {
    setDraft((d) => {
      const next = new Date(d);
      next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
      return next;
    });
    setFocused(day);
    if (day.getMonth() !== viewMonth.getMonth() || day.getFullYear() !== viewMonth.getFullYear()) {
      setViewMonth(startOfMonth(day));
    }
  }

  function setHour(h: number) {
    // ponytail: Number("") is 0, so clearing the field snaps to 00 rather than staying blank;
    // upgrade to a string draft + separate parse step if that proves annoying in practice.
    setDraft((d) => {
      const next = new Date(d);
      next.setHours(((h % 24) + 24) % 24);
      return next;
    });
  }

  function setMinute(m: number) {
    setDraft((d) => {
      const next = new Date(d);
      next.setMinutes(((m % 60) + 60) % 60);
      return next;
    });
  }

  function setNow() {
    const now = new Date();
    setDraft(now);
    setFocused(now);
    setViewMonth(startOfMonth(now));
  }

  function commitDone() {
    onChange(draft);
    closeAndRefocus();
  }

  function commitSession() {
    onChange(null);
    closeAndRefocus();
  }

  function handleGridKeyDown(e: React.KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      const next = addDays(focused, moves[e.key]);
      setFocused(next);
      if (next.getMonth() !== viewMonth.getMonth() || next.getFullYear() !== viewMonth.getFullYear()) {
        setViewMonth(startOfMonth(next));
      }
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const dir = e.key === "PageUp" ? -1 : 1;
      const next = addMonths(viewMonth, dir);
      setViewMonth(next);
      setFocused((f) => new Date(next.getFullYear(), next.getMonth(), Math.min(f.getDate(), 28)));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pickDay(focused);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeAndRefocus();
    }
  }

  const today = new Date();
  const cells = buildGrid(viewMonth);

  return (
    <>
      <button type="button" ref={triggerRef} className="dtp-trigger" onClick={() => (open ? setOpen(false) : openPicker())}>
        <Calendar size={13} aria-hidden="true" />
        <span className={value ? "" : "dtp-placeholder"}>{value ? formatDisplay(value) : placeholder}</span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              className="dtp-popover"
              style={{ top: pos.top, left: pos.left }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeAndRefocus();
                }
              }}
            >
              <div className="dtp-header">
                <button type="button" className="icon" onClick={() => setViewMonth((m) => addMonths(m, -1))} aria-label="Previous month">
                  <ChevronLeft size={15} />
                </button>
                <span className="dtp-month-label">
                  {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
                </span>
                <button type="button" className="icon" onClick={() => setViewMonth((m) => addMonths(m, 1))} aria-label="Next month">
                  <ChevronRight size={15} />
                </button>
              </div>
              <div className="dtp-weekdays">
                {WEEKDAYS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="dtp-grid" role="grid" onKeyDown={handleGridKeyDown}>
                {cells.map((day) => {
                  const inMonth = day.getMonth() === viewMonth.getMonth();
                  const isSelected = sameDay(day, draft);
                  const isToday = sameDay(day, today);
                  const isFocused = sameDay(day, focused);
                  const classNames = [
                    "dtp-day",
                    inMonth ? "" : "dtp-day-outside",
                    isSelected ? "dtp-day-selected" : "",
                    isToday ? "dtp-day-today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      type="button"
                      key={day.toDateString()}
                      ref={(el) => {
                        if (el) dayRefs.current.set(day.toDateString(), el);
                        else dayRefs.current.delete(day.toDateString());
                      }}
                      className={classNames}
                      tabIndex={isFocused ? 0 : -1}
                      onClick={() => pickDay(day)}
                      onFocus={() => setFocused(day)}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
              <div className="dtp-time">
                <input
                  type="number"
                  className="mono"
                  min={0}
                  max={23}
                  value={pad(draft.getHours())}
                  onChange={(e) => setHour(Number(e.target.value))}
                  aria-label="Hour"
                />
                <span>:</span>
                <input
                  type="number"
                  className="mono"
                  min={0}
                  max={59}
                  value={pad(draft.getMinutes())}
                  onChange={(e) => setMinute(Number(e.target.value))}
                  aria-label="Minute"
                />
              </div>
              <div className="dtp-actions">
                <button type="button" className="ghost dtp-session-btn" onClick={commitSession}>
                  <X size={13} /> Session cookie
                </button>
                <div className="dtp-actions-right">
                  <button type="button" className="ghost" onClick={setNow}>
                    Now
                  </button>
                  <button type="button" className="primary" onClick={commitDone}>
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
