import { useEffect, useRef, useState } from "react";
import { Copy, Check, X } from "lucide-react";
import CodeEditor from "./CodeEditor";
import type { CodeLang } from "./CodeEditor";
import Select from "./Select";
import * as api from "../api";
import { toast } from "../store";
import type { RequestTab } from "../store";
import type { SendInput } from "../types";
import "../codePanel.css";

const WIDTH_KEY = "restly.codePanelWidth";
const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 420;
const DEBOUNCE_MS = 200;

function clampWidth(px: number): number {
  return Math.min(Math.max(px, MIN_WIDTH), window.innerWidth * 0.7);
}

function loadWidth(): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  return clampWidth(saved > 0 ? saved : DEFAULT_WIDTH);
}

interface Props {
  tab: RequestTab;
  buildInput: () => SendInput;
  onChange: () => void;
  onClose: () => void;
}

// The code panel: a resizable column docked to the right of the request editor and
// response, so both stay visible while it's open (see RequestTab's code-panel-row).
export default function SnippetPanel({ tab, buildInput, onChange, onClose }: Props) {
  const [langs, setLangs] = useState<string[]>([]);
  const [width, setWidth] = useState(loadWidth);
  const [copied, setCopied] = useState(false);
  // Mirrors `width` but updated synchronously inside the drag handler below, so a pointerup
  // that fires before React re-renders from the preceding pointermove still saves the final
  // value instead of a stale one.
  const widthRef = useRef(width);
  // Bumped on every regen request; a response is applied only if it's still the latest,
  // so a stale one that resolves late (out of order) is dropped instead of overwriting
  // newer code.
  const seq = useRef(0);

  useEffect(() => {
    api.snippetLangs().then(setLangs).catch((err) => toast(String(err), "error"));
  }, []);

  // Regenerates on any change to method/url/params/headers/body/auth (all of them flow
  // through notifyChange/markCollectionDirty, which re-renders this component), the
  // selected environment, or the language. The key equality check is what "skips
  // regeneration when nothing changed": effects only rerun when a dependency actually
  // differs, so a render triggered by something unrelated (e.g. a toast) is a no-op here.
  // The old code stays on screen until the new one arrives (tab.snippetCode is untouched
  // until then), so there's no flicker.
  const input = buildInput();
  const key = JSON.stringify({ item: input.item, env: input.env, lang: tab.snippetLang });
  useEffect(() => {
    const mySeq = ++seq.current;
    const timer = window.setTimeout(() => {
      api
        .snippet(buildInput(), tab.snippetLang)
        .then((code) => {
          if (seq.current !== mySeq) return;
          tab.snippetCode = code;
          onChange();
        })
        .catch((err) => toast(String(err), "error"));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    function onMove(ev: PointerEvent) {
      const next = clampWidth(startWidth + (startX - ev.clientX));
      widthRef.current = next;
      setWidth(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      localStorage.setItem(WIDTH_KEY, String(widthRef.current));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="code-panel" style={{ width }}>
      <div className="code-panel-divider" onPointerDown={startDrag} />
      <div className="code-panel-toolbar">
        <Select
          value={tab.snippetLang}
          onChange={(v) => {
            tab.snippetLang = v;
            onChange();
          }}
          ariaLabel="Snippet language"
          options={(langs.length ? langs : [tab.snippetLang]).map((l) => ({ value: l, label: l }))}
        />
        <button
          onClick={() => {
            api.ClipboardSetText(tab.snippetCode).then(() => {
              toast("Copied");
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check size={14} strokeWidth={1.75} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.75} aria-hidden="true" />}
          Copy
        </button>
        <button className="icon" title="Close" aria-label="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="code-panel-body">
        <CodeEditor value={tab.snippetCode} language={tab.snippetLang as CodeLang} readOnly />
      </div>
    </div>
  );
}
