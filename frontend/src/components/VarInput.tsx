import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, FocusEvent, KeyboardEvent, MouseEvent, Ref } from "react";
import { createPortal } from "react-dom";
import { ensureGlobalsLoaded, listVariables, resolveVariable, VARIABLE_PATTERN, type ResolvedVariable } from "../variables";
import "../variables.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  mono?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

type Segment = { text: string; name?: string };

// Splits on {{name}} into plain-text and variable segments, for both the mirror render
// and the class lookup. Braces are never nested per VARIABLE_PATTERN.
function splitSegments(value: string): Segment[] {
  const out: Segment[] = [];
  const re = new RegExp(VARIABLE_PATTERN.source, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    if (match.index > last) out.push({ text: value.slice(last, match.index) });
    out.push({ text: match[0], name: match[1] });
    last = match.index + match[0].length;
  }
  if (last < value.length) out.push({ text: value.slice(last) });
  return out;
}

// Finds an unclosed {{ before the caret, i.e. an in-progress variable reference to
// autocomplete. Returns null once }} (or another {{) has been typed.
function findTrigger(value: string, caret: number): { start: number; query: string } | null {
  const idx = value.lastIndexOf("{{", caret - 1);
  if (idx === -1 || idx + 2 > caret) return null;
  const between = value.slice(idx + 2, caret);
  if (between.includes("{") || between.includes("}")) return null;
  return { start: idx, query: between };
}

let measureCanvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string): number {
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
}

function maskValue(v: string): string {
  return "•".repeat(Math.min(Math.max(v.length, 4), 10));
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") (ref as { current: T | null }).current = value;
}

export default function VarInput({
  value,
  onChange,
  placeholder,
  className,
  onPaste,
  onKeyDown,
  onBlur,
  autoFocus,
  mono = true,
  inputRef,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const innerInputRef = useRef<HTMLInputElement | null>(null);
  const tokenRefs = useRef<{ name: string; el: HTMLElement }[]>([]);
  const pendingCaret = useRef<number | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoveredName = useRef<string | null>(null);

  const [hover, setHover] = useState<{ name: string; rect: DOMRect } | null>(null);
  const [autocomplete, setAutocomplete] = useState<{ start: number; query: string } | null>(null);
  const [acIndex, setAcIndex] = useState(0);
  const acId = useId();

  useEffect(() => {
    ensureGlobalsLoaded();
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    };
  }, []);

  // Move the caret after an autocomplete insertion, once the new value has landed in props.
  // useLayoutEffect (not useEffect) so the caret never flashes at the end of the value first.
  useLayoutEffect(() => {
    if (pendingCaret.current != null && innerInputRef.current) {
      const pos = pendingCaret.current;
      innerInputRef.current.setSelectionRange(pos, pos);
      pendingCaret.current = null;
    }
  }, [value]);

  // Escape should close the hover popup even though hovering doesn't focus this input.
  // Listener is added only while a popup is actually shown, so idle inputs hold none.
  useEffect(() => {
    if (!hover) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setHover(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hover]);

  const segments = useMemo(() => splitSegments(value), [value]);

  const filtered = useMemo<ResolvedVariable[]>(() => {
    if (!autocomplete) return [];
    const q = autocomplete.query.toLowerCase();
    return listVariables().filter((v) => v.name.toLowerCase().includes(q));
  }, [autocomplete]);

  function syncScroll() {
    if (mirrorRef.current && innerInputRef.current) mirrorRef.current.scrollLeft = innerInputRef.current.scrollLeft;
  }

  function evaluateAutocomplete() {
    const el = innerInputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const trigger = findTrigger(el.value, caret);
    setAutocomplete(trigger);
    setAcIndex(0);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
    // selectionStart reflects the caret post-edit synchronously on the native input.
    requestAnimationFrame(syncScroll);
    evaluateAutocomplete();
  }

  function commit(item: ResolvedVariable) {
    const el = innerInputRef.current;
    if (!autocomplete || !el) return;
    const { start, query } = autocomplete;
    const caret = start + 2 + query.length;
    const hasClosing = value.slice(caret, caret + 2) === "}}";
    const insertion = item.name + "}}";
    const next = value.slice(0, start + 2) + insertion + value.slice(caret + (hasClosing ? 2 : 0));
    pendingCaret.current = start + 2 + insertion.length;
    setAutocomplete(null);
    onChange(next);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (autocomplete && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAcIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAcIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (filtered[acIndex]) {
          e.preventDefault();
          commit(filtered[acIndex]);
          return;
        }
      }
    }
    if (autocomplete && e.key === "Escape") {
      e.preventDefault();
      setAutocomplete(null);
      return;
    }
    if (!autocomplete && e.key === "Escape" && hover) {
      setHover(null);
    }
    onKeyDown?.(e);
  }

  function handleKeyUp(e: KeyboardEvent<HTMLInputElement>) {
    syncScroll();
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) evaluateAutocomplete();
  }

  function hitTestToken(x: number, y: number): { name: string; rect: DOMRect } | null {
    for (const { name, el } of tokenRefs.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { name, rect: r };
    }
    return null;
  }

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const hit = hitTestToken(e.clientX, e.clientY);
    if (hit) {
      if (hit.name === hoveredName.current) return;
      hoveredName.current = hit.name;
      clearTimeout(hideTimer.current);
      clearTimeout(showTimer.current);
      showTimer.current = setTimeout(() => setHover({ name: hit.name, rect: hit.rect }), 150);
    } else if (hoveredName.current !== null) {
      hoveredName.current = null;
      clearTimeout(showTimer.current);
      hideTimer.current = setTimeout(() => setHover(null), 200);
    }
  }

  function handleMouseLeave() {
    hoveredName.current = null;
    clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setHover(null), 200);
  }

  function handlePopupEnter() {
    clearTimeout(hideTimer.current);
  }

  function handlePopupLeave() {
    hideTimer.current = setTimeout(() => setHover(null), 150);
  }

  // Autocomplete dropdown position: caret x measured with canvas text metrics against the
  // input's own font, since it's a plain <input> with no per-character DOM to read from.
  const acStyle = useMemo(() => {
    if (!autocomplete) return null;
    const el = innerInputRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const prefix = value.slice(0, autocomplete.start + 2 + autocomplete.query.length);
    const paddingLeft = parseFloat(cs.paddingLeft) || 0;
    const left = rect.left + paddingLeft + textWidth(prefix, font) - el.scrollLeft;
    return { top: rect.bottom + 4, left };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autocomplete, value]);

  tokenRefs.current = [];
  const classNames = ["varinput-input", mono ? "mono" : "", className ?? ""].filter(Boolean).join(" ");
  const mirrorClassNames = ["varinput-mirror", mono ? "mono" : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <div className="varinput-wrap" ref={wrapRef} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <div className={mirrorClassNames} ref={mirrorRef} aria-hidden="true">
        {segments.map((seg, i) =>
          seg.name != null ? (
            <span
              key={i}
              ref={(el) => {
                if (el) tokenRefs.current.push({ name: seg.name!, el });
              }}
              className={resolveVariable(seg.name).scope === "undefined" ? "vartoken-undefined" : "vartoken-defined"}
            >
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </div>
      <input
        type="text"
        className={classNames}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        ref={(el) => {
          innerInputRef.current = el;
          setRef(inputRef, el);
        }}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onScroll={syncScroll}
        onClick={syncScroll}
        onFocus={syncScroll}
        onSelect={syncScroll}
        onBlur={(e) => {
          setAutocomplete(null);
          onBlur?.(e);
        }}
        onPaste={onPaste}
        aria-activedescendant={autocomplete && filtered[acIndex] ? `${acId}-${acIndex}` : undefined}
      />
      {hover ? (
        <VarPopup token={hover.name} anchorRect={hover.rect} onEnter={handlePopupEnter} onLeave={handlePopupLeave} />
      ) : null}
      {autocomplete && acStyle && filtered.length > 0
        ? createPortal(
            <ul className="var-autocomplete" role="listbox" id={acId} style={{ top: acStyle.top, left: acStyle.left }}>
              {filtered.map((v, i) => (
                <li
                  key={v.name}
                  id={`${acId}-${i}`}
                  role="option"
                  aria-selected={i === acIndex}
                  className={"var-autocomplete-item" + (i === acIndex ? " active" : "")}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus in the input so the caret survives the click
                    commit(v);
                  }}
                  onMouseEnter={() => setAcIndex(i)}
                >
                  <span className="var-autocomplete-name mono">{v.name}</span>
                  {v.secret ? <span className="var-autocomplete-value mono">{maskValue(v.value)}</span> : null}
                  <span className="var-autocomplete-scope">{v.scopeLabel}</span>
                </li>
              ))}
            </ul>,
            document.body
          )
        : null}
    </div>
  );
}

function VarPopup({
  token,
  anchorRect,
  onEnter,
  onLeave,
}: {
  token: string;
  anchorRect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; ready: boolean }>({
    top: anchorRect.bottom + 6,
    left: anchorRect.left,
    ready: false,
  });
  const [shown, setShown] = useState(false);
  const info = useMemo(() => resolveVariable(token), [token]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const top = spaceBelow < h + 10 ? anchorRect.top - h - 6 : anchorRect.bottom + 6;
    setPos({ top, left: anchorRect.left, ready: true });
  }, [token, anchorRect.top, anchorRect.left, anchorRect.bottom]);

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="var-popup"
      style={{ top: pos.top, left: pos.left, visibility: pos.ready ? "visible" : "hidden" }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="var-popup-name mono">{`{{${info.name}}}`}</div>
      {info.scope === "undefined" ? (
        <div className="var-popup-hint">Not defined in the selected environment, collection, or globals</div>
      ) : (
        <>
          <div className="var-popup-row mono">{info.secret && !shown ? maskValue(info.value) : info.value}</div>
          {info.resolved !== info.value ? (
            <div className="var-popup-row var-popup-resolved mono">→ {info.secret && !shown ? maskValue(info.resolved) : info.resolved}</div>
          ) : null}
          <div className="var-popup-scope">{info.scopeLabel}</div>
          {info.secret ? (
            <button className="icon" onClick={() => setShown((s) => !s)}>
              {shown ? "Hide" : "Show"}
            </button>
          ) : null}
        </>
      )}
    </div>,
    document.body
  );
}
