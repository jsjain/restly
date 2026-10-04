import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Copy, Download, MinusCircle, RefreshCw, Search, Send, X } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import CodeEditor from "./CodeEditor";
import { Kbd } from "./Kbd";
import * as api from "../api";
import { toast } from "../store";
import type { RequestTab, ResponseSubTab as SubTab } from "../store";
import type { HttpResponse, SendResult, Timings } from "../types";

interface Props {
  tab: RequestTab;
  onChange: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  style?: CSSProperties;
}

// When a tab's send started and how long a result took. They live here, not on the tab, because only
// this pane and RequestTab read them.
export const sendStarted = new WeakMap<RequestTab, number>();
export const sendDuration = new WeakMap<SendResult, number>();

// The error the backend sets after CancelSend (errSendCancelled in constants.go).
const CANCELLED = "Request cancelled";

const SUBTABS: SubTab[] = ["body", "headers", "cookies", "tests", "console"];

function statusClass(code: number): string {
  if (code >= 500) return "s5";
  if (code >= 400) return "s4";
  if (code >= 300) return "s3";
  return "s2";
}

const MAX_PRETTY = 5 * 1024 * 1024;

async function saveFullBody() {
  try {
    const path = await api.saveLastBody();
    if (path) toast(`Saved to ${path}`);
  } catch (err) {
    toast(String(err), "error");
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const formatMs = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
const formatRan = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

function contentType(response: HttpResponse | null): string {
  return response?.header.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() ?? "";
}

// Errors where the proxy or TLS settings are a plausible cause; URL and script errors are not.
const NETWORK_ERROR = /dial|connect|refused|timeout|timed out|proxy|tls|x509|certificate|no such host|EOF|reset by peer/i;

export default function ResponsePane({ tab, onChange, onRetry, onOpenSettings, style }: Props) {
  const result = tab.sendResult;
  const sub = tab.responseSub ?? "body";
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => {
    if (!result || result.binary || result.truncated || result.body.length > MAX_PRETTY) return null;
    try {
      return JSON.parse(result.body);
    } catch {
      return null;
    }
  }, [result]);

  const pretty = useMemo(() => (parsed === null ? "" : JSON.stringify(parsed, null, 2)), [parsed]);

  const settled = !tab.sending && result !== null;
  const cancelled = settled && result.error === CANCELLED;
  const response = settled && !cancelled ? result.response : null;
  const tests = settled && !cancelled ? result.tests : [];
  const passed = tests.filter((t) => t.passed).length;

  const type = contentType(response);
  const isHtml = type.includes("html");
  const kind = parsed !== null || type.includes("json") ? "JSON" : isHtml ? "HTML" : type.includes("xml") ? "XML" : "Text";
  const view = parsed !== null ? tab.bodyView : isHtml && preview ? "preview" : "raw";
  const views = parsed !== null ? ["pretty", "raw"] : isHtml ? ["raw", "preview"] : [];

  function openFind() {
    const editor = codeRef.current?.querySelector<HTMLElement>(".cm-editor");
    const cm = editor && EditorView.findFromDOM(editor);
    if (cm) openSearchPanel(cm);
  }

  function copyBody() {
    api
      .ClipboardSetText(result!.body)
      .then(() => {
        toast("Copied");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch((err) => toast(String(err), "error"));
  }

  function setView(next: string) {
    setPreview(next === "preview");
    if (next === "pretty" || (next === "raw" && parsed !== null)) tab.bodyView = next as "pretty" | "raw";
    onChange();
  }

  return (
    <div className="split-bottom resp" style={style}>
      <div className="resp-head">
        <div className="subtabs">
          {SUBTABS.map((s) => (
            <button key={s} className={sub === s ? "active" : ""} onClick={() => { tab.responseSub = s; onChange(); }}>
              {s[0].toUpperCase() + s.slice(1)}
              {s === "headers" && response ? <span className="subtab-count">{response.header.length}</span> : null}
              {s === "tests" && tests.length > 0 ? (
                <span className={`subtab-count ${passed === tests.length ? "tests-ok" : "tests-fail"}`}>
                  {passed}/{tests.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {settled && !cancelled && response ? (
          <div className="resp-meta tnum">
            <span className={`resp-status ${statusClass(response.code)}`}>
              <span className="resp-status-dot" />
              {response.code} {response.status}
            </span>
            <TimingPopover timings={response.timings} />
            <span>{formatSize(response.size)}</span>
          </div>
        ) : null}
      </div>

      {tab.sending ? (
        <div className="resp-state" role="status">
          <div className="resp-sending">
            <span>Sending request…</span>
            <Elapsed since={sendStarted.get(tab) ?? Date.now()} />
          </div>
        </div>
      ) : !result ? (
        <div className="resp-state">
          <div className="resp-stack">
            <Send size={20} aria-hidden="true" />
            <span>Send a request to see the response</span>
            <Kbd command="send" />
          </div>
        </div>
      ) : cancelled ? (
        <div className="resp-state">
          <div className="resp-stack">
            <MinusCircle size={20} aria-hidden="true" />
            <span>Request cancelled</span>
            <span className="resp-note">
              {sendDuration.has(result) ? <span className="tnum">Ran for {formatRan(sendDuration.get(result)!)}. </span> : null}
              Send again with <Kbd command="send" />
            </span>
          </div>
        </div>
      ) : (
        <>
          {result.error ? (
            <div className="error-banner" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <div className="error-msg">
                <b>{result.error}</b>
                <div className="error-actions">
                  <button onClick={onRetry}>
                    <RefreshCw size={13} aria-hidden="true" />
                    Retry
                  </button>
                  {!response && NETWORK_ERROR.test(result.error) ? (
                    <button className="ghost link" onClick={onOpenSettings}>
                      Check proxy settings
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {response ? (
            <div className="resp-pane">
              {sub === "body" ? (
                result.binary ? (
                  <div className="resp-scroll">
                    <p>Response body is binary and cannot be displayed.</p>
                    <button onClick={saveFullBody}>Save full body</button>
                  </div>
                ) : (
                  <>
                    {result.truncated ? (
                      <div className="banner">
                        <span>Response body was truncated at 10 MB.</span>
                        <button onClick={saveFullBody}>Save full body</button>
                      </div>
                    ) : null}
                    <div className="resp-tools">
                      {views.length > 0 ? (
                        <div className="segmented" role="group" aria-label="View">
                          {views.map((v) => (
                            <button key={v} className={view === v ? "active" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
                              {v[0].toUpperCase() + v.slice(1)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <span className="tag">{kind}</span>
                      <span className="resp-tools-grow" />
                      <button className="icon" title="Find" aria-label="Find in response" disabled={view === "preview"} onClick={openFind}>
                        <Search />
                      </button>
                      <button className="icon" title="Copy body" aria-label="Copy body" onClick={copyBody}>
                        {copied ? <Check /> : <Copy />}
                      </button>
                      <button className="icon" title="Save to file" aria-label="Save to file" onClick={saveFullBody}>
                        <Download />
                      </button>
                    </div>
                    {view === "preview" ? (
                      <iframe className="resp-preview" title="Response preview" sandbox="" srcDoc={result.body} />
                    ) : (
                      <div className="resp-code" ref={codeRef}>
                        <CodeEditor
                          value={view === "pretty" ? pretty : result.body}
                          language={parsed !== null ? "json" : "text"}
                          readOnly
                        />
                      </div>
                    )}
                  </>
                )
              ) : null}

              {sub === "headers" ? (
                <div className="resp-scroll">
                  <div className="kv-frame">
                    <table className="kv-table kv-auto">
                      <thead>
                        <tr>
                          <th>Key</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {response.header.map((h, i) => (
                          <tr key={i}>
                            <td className="mono kv-name">{h.key}</td>
                            <td className="mono kv-name">{h.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {sub === "cookies" ? (
                <div className="resp-scroll">
                  {response.cookies.length === 0 ? (
                    <div className="resp-note">This response set no cookies.</div>
                  ) : (
                    <div className="kv-frame">
                      <table className="kv-table kv-auto">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Value</th>
                            <th>Domain</th>
                            <th>Path</th>
                            <th>Expires</th>
                          </tr>
                        </thead>
                        <tbody>
                          {response.cookies.map((c, i) => (
                            <tr key={i}>
                              <td className="mono kv-name">{c.name}</td>
                              <td className="mono kv-name">{c.value}</td>
                              <td className="kv-name">{c.domain}</td>
                              <td className="kv-name">{c.path}</td>
                              <td className="kv-name">{c.expires}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              {sub === "tests" ? (
                <div className="resp-scroll">
                  <div className="hint">
                    {passed} passed, {tests.length - passed} failed
                  </div>
                  {tests.map((t, i) => (
                    <div key={i} className="test-row">
                      <span className={t.passed ? "test-pass" : "test-fail"}>
                        {t.passed ? <Check size={14} aria-label="Passed" /> : <X size={14} aria-label="Failed" />}
                      </span>
                      <span>{t.name}</span>
                      {t.error ? <span className="test-fail mono">{t.error}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {sub === "console" ? (
                <div className="resp-scroll">
                  {result.console.map((line, i) => (
                    <div key={i} className="console-line">
                      {line}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : !result.error ? (
            <div className="resp-state">
              <span>No response.</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// Counts up in tenths of a second while a request is in flight.
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="tnum resp-elapsed">{(Math.max(now - since, 0) / 1000).toFixed(1)} s</span>;
}

// The total time, with a breakdown on hover or focus. Each phase is a bar placed on one timeline.
// TLS and Connect are zero on a reused connection. First byte is the wait after setup.
function TimingPopover({ timings }: { timings: Timings }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);

  const total = Math.max(timings.total, 0.001);
  const setup = timings.dns + timings.connect + timings.tls;
  const wait = Math.max(timings.firstByte - setup, 0);
  const download = Math.max(timings.total - timings.firstByte, 0);
  const phases = [
    { label: "DNS", start: 0, ms: timings.dns, tone: "subtle" },
    { label: "Connect", start: timings.dns, ms: timings.connect, tone: "subtle" },
    { label: "TLS", start: timings.dns + timings.connect, ms: timings.tls, tone: "subtle" },
    { label: "First byte", start: setup, ms: wait, tone: "primary" },
    { label: "Download", start: timings.firstByte, ms: download, tone: "success" },
  ];

  const show = () => setRect(anchor.current?.getBoundingClientRect() ?? null);
  const hide = () => setRect(null);

  return (
    <>
      <span
        ref={anchor}
        className="resp-time"
        tabIndex={0}
        aria-describedby={rect ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {Math.round(timings.total)} ms
      </span>
      {rect
        ? createPortal(
            <div id={id} role="tooltip" className="pop timing-pop tnum" style={{ top: rect.bottom + 6, right: window.innerWidth - rect.right }}>
              <div className="timing-title">Timing</div>
              <div className="timing-grid">
                {phases.map((p) => (
                  <div key={p.label} className="timing-row">
                    <span className="timing-label">{p.label}</span>
                    <div className="timing-track">
                      <i
                        className={`timing-bar timing-${p.tone}`}
                        style={{ left: `${Math.min((p.start / total) * 100, 100)}%`, width: `${Math.min((p.ms / total) * 100, 100)}%` }}
                      />
                    </div>
                    <span className={p.label === "TLS" && p.ms === 0 ? "timing-none" : undefined}>
                      {p.label === "TLS" && p.ms === 0 ? "none" : formatMs(p.ms)}
                    </span>
                  </div>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
