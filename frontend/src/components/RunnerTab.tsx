import { Fragment, useEffect, useState } from "react";
import { CircleCheck, CircleX, Check, Download, Play, Square, Terminal, X } from "lucide-react";
import * as api from "../api";
import { getCollection, isCollectionDirty, notifyChange, saveCollectionFile, selectedEnv, toast } from "../store";
import type { RunnerTab as RunnerTabState } from "../store";
import { itemAt } from "../tree";
import { isFolder } from "../types";
import type { Collection, Item, RunResult } from "../types";
import { urlRaw } from "../urlutil";
import { isWebSocket } from "../websocket";
import { MethodTag } from "./pageKv";
import Select from "./Select";
import type { SelectOption } from "./Select";
import "../overview.css";
import "../panels.css";

interface Props {
  tab: RunnerTabState;
}

// Wall-clock timing per run tab. The run:result and run:done subscriptions live in store.ts, but they
// only record results, so the start and end of a run are tracked here. Only one run is active at a time.
const timing = new WeakMap<RunnerTabState, { start: number; end?: number }>();
let runningTab: RunnerTabState | null = null;

// Registered before the store's own run:done handler, so the end time is set before a re-render reads it.
api.onRunDone(() => {
  const t = runningTab && timing.get(runningTab);
  if (t && !t.end) t.end = Date.now();
  runningTab = null;
});

type Filter = "all" | "failed" | "skipped";

function failedTests(r: RunResult): number {
  return r.tests.filter((t) => !t.passed).length;
}

function isFailing(r: RunResult): boolean {
  return !!r.error || failedTests(r) > 0;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function statusClass(code: number): string {
  return code >= 500 ? "s5" : code >= 400 ? "s4" : code >= 300 ? "s3" : "s2";
}

// The scheme and host are dimmed so the path reads first.
function UrlCell({ url }: { url: string }) {
  const m = url.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i);
  if (!m) return <>{url}</>;
  return (
    <>
      <span className="host">{m[1]}</span>
      {m[2]}
    </>
  );
}

function leaves(items: Item[], base: number[], out: { item: Item; path: number[] }[] = []) {
  items.forEach((item, i) => {
    const path = [...base, i];
    if (isFolder(item)) leaves(item.item ?? [], path, out);
    // The runner skips WebSocket items.
    else if (!isWebSocket(item)) out.push({ item, path });
  });
  return out;
}

// Every folder, depth first, for the scope select.
function folderOptions(items: Item[], base: number[], depth: number, out: SelectOption[] = []): SelectOption[] {
  items.forEach((item, i) => {
    if (!isFolder(item)) return;
    const path = [...base, i];
    out.push({ value: path.join("."), label: item.name, indent: depth });
    folderOptions(item.item ?? [], path, depth + 1, out);
  });
  return out;
}

function targetName(coll: Collection | undefined, path: number[]): string {
  if (!coll) return "";
  return (path.length ? itemAt(coll, path)?.name : coll.info.name) ?? coll.info.name;
}

// The run:result/run:done subscription lives in store.ts (openRunnerTab), for the tab's
// whole lifetime, since only the active tab is mounted and a run can outlive tab switches.
export default function RunnerTab({ tab }: Props) {
  // Rows the user flipped: failures start open, everything else starts closed.
  const [toggled, setToggled] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!tab.running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [tab.running]);

  const coll = getCollection(tab.file);
  const scope = coll && tab.path.length ? itemAt(coll, tab.path) : undefined;
  const entries = coll ? leaves(scope ? (scope.item ?? []) : coll.item, tab.path) : [];
  const name = targetName(coll, tab.path);

  async function handleRun() {
    if (isCollectionDirty(tab.file)) {
      try {
        await saveCollectionFile(tab.file);
      } catch (err) {
        toast(String(err), "error");
        return;
      }
    }
    tab.results = [];
    tab.summary = null;
    tab.running = true;
    timing.set(tab, { start: Date.now() });
    runningTab = tab;
    setToggled(new Set());
    setFilter("all");
    notifyChange();
    try {
      await api.run({
        file: tab.file,
        path: tab.path,
        env: selectedEnv(tab.file),
        iterations: tab.iterations,
        delayMs: tab.delayMs,
      });
    } catch (err) {
      toast(String(err), "error");
      tab.running = false;
      runningTab = null;
      notifyChange();
    }
  }

  async function handleStop() {
    await api.stopRun();
  }

  function toggle(i: number, open: boolean) {
    const next = new Set(toggled);
    // A row is open when it is failing xor flipped, so flipping an open row closes it.
    if (next.has(i) === !open) next.delete(i);
    else next.add(i);
    setToggled(next);
  }

  async function exportResults() {
    const t = timing.get(tab);
    const data = {
      collection: coll?.info.name ?? "",
      scope: name,
      iterations: tab.iterations,
      startedAt: t ? new Date(t.start).toISOString() : undefined,
      durationMs: t?.end ? t.end - t.start : undefined,
      summary: tab.summary,
      results: tab.results,
    };
    try {
      const saved = await api.saveTextFile(`${name || "run"} results.json`, JSON.stringify(data, null, 2));
      if (saved) toast(`Saved ${saved}`);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  const results = tab.results;
  const summary = tab.summary;
  const finished = !!summary && !tab.running;
  const started = timing.get(tab);
  const timed = results.reduce((sum, r) => sum + r.timeMs, 0);
  const elapsed = started ? (tab.running ? now : (started.end ?? now)) - started.start : timed;
  const failedRows = results.filter(isFailing).length;
  const skippedRows = results.filter((r) => r.skipped).length;
  const passedTests = summary?.passed ?? results.reduce((sum, r) => sum + r.tests.filter((t) => t.passed).length, 0);
  const failed = summary?.failed ?? results.reduce((sum, r) => sum + failedTests(r), 0);
  const errors = summary?.errors ?? results.filter((r) => r.error).length;
  const total = Math.max(entries.length * tab.iterations, results.length);
  const slowest = Math.max(0, ...results.map((r) => r.timeMs));
  const lastIteration = results.length ? results[results.length - 1].iteration + 1 : 1;
  // The request in flight is the next entry in order. A setNextRequest jump makes this a guess until the result lands.
  const inFlight = tab.running && entries.length ? entries[results.length % entries.length] : undefined;

  const shown = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => filter === "all" || (filter === "failed" ? isFailing(r) : r.skipped));
  const hasRun = results.length > 0 || tab.running || !!summary;
  const cols = finished ? 8 : 7;

  const folders = coll ? folderOptions(coll.item, [], 0) : [];

  return (
    <div className="page runner">
      <div className="page-head">
        <div className="page-titles">
          {finished ? (
            <h1 className="page-title">
              {summary.stopped ? "Stopped" : "Finished"} in {seconds(elapsed)}. <span className="dim">{summary.requests} requests,</span>{" "}
              <span className={summary.passed ? "ok" : "dim"}>{summary.passed} {summary.passed === 1 ? "test" : "tests"} passed</span>
              <span className="dim">,</span> <span className={failed ? "bad" : "dim"}>{summary.failed} failed</span>
              <span className="dim">,</span> <span className={summary.errors ? "bad" : "dim"}>{summary.errors} {summary.errors === 1 ? "error" : "errors"}</span>
              <span className="dim">.</span>
            </h1>
          ) : (
            <h1 className="page-title">Run {name}</h1>
          )}
          <div className="page-meta tnum">
            {tab.running ? <span>{`Iteration ${lastIteration} of ${tab.iterations}`}</span> : null}
            {finished ? <span>{tab.iterations === 1 ? "1 iteration" : `${tab.iterations} iterations`}</span> : null}
            {started ? <span>Started {clock(started.start)}</span> : null}
            {finished ? <span>Runs are not kept after the tab closes</span> : null}
            {!hasRun ? <span>{entries.length === 1 ? "1 request" : `${entries.length} requests`}</span> : null}
          </div>
        </div>
        <div className="page-acts">
          {tab.running ? (
            <button className="ghost" onClick={handleStop}>
              <Square size={13} /> Stop
            </button>
          ) : null}
          {finished ? (
            <button className="ghost" onClick={exportResults}>
              <Download size={13} /> Export results
            </button>
          ) : null}
          <button className="primary" onClick={handleRun} disabled={tab.running}>
            <Play size={13} /> {finished ? "Run again" : "Run"}
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="opts">
          <div className="field">
            <label htmlFor="runner-iterations">Iterations</label>
            <input
              id="runner-iterations"
              type="number"
              className="tnum w-num"
              min={1}
              disabled={tab.running}
              value={tab.iterations}
              onChange={(e) => {
                tab.iterations = Math.max(1, Number(e.target.value) || 1);
                notifyChange();
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="runner-delay">Delay</label>
            <div className="affix w-ms">
              <input
                id="runner-delay"
                type="number"
                className="tnum"
                min={0}
                disabled={tab.running}
                value={tab.delayMs}
                onChange={(e) => {
                  tab.delayMs = Math.max(0, Number(e.target.value) || 0);
                  notifyChange();
                }}
              />
              <span className="u">ms</span>
            </div>
          </div>
          <div className="field">
            <label>Folder scope</label>
            <Select
              className="w-scope"
              ariaLabel="Folder scope"
              disabled={tab.running}
              value={tab.path.join(".")}
              options={[{ value: "", label: "Whole collection" }, ...folders]}
              onChange={(v) => {
                tab.path = v === "" ? [] : v.split(".").map(Number);
                notifyChange();
              }}
            />
          </div>
          <span className="help-r">Unsaved changes are saved before the run</span>
        </div>

        {hasRun ? (
          <div className="card sum">
            <div className="bar">
              <div className="progress" role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={results.length}>
                <i style={{ width: `${((results.length - failedRows) / total) * 100}%`, background: "var(--success)" }} />
                <i style={{ width: `${(failedRows / total) * 100}%`, background: "var(--danger)" }} />
              </div>
              <div className="cap">
                <span>
                  <span className="dot" style={{ color: "var(--success)" }} />
                  Passed
                </span>
                <span>
                  <span className="dot" style={{ color: "var(--danger)" }} />
                  Failed
                </span>
                <span>
                  <span className="dot" style={{ color: "var(--border-control)" }} />
                  Pending
                </span>
              </div>
            </div>
            <div className="stat-row tnum">
              <div className="stat">
                <div className="v">
                  {results.length}
                  <span className="subtlest">/{total}</span>
                </div>
                <div className="l">Requests</div>
              </div>
              <div className="stat">
                <div className="v ok">{passedTests}</div>
                <div className="l">Tests passed</div>
              </div>
              <div className="stat">
                <div className={`v${failed ? " bad" : ""}`}>{failed}</div>
                <div className="l">Tests failed</div>
              </div>
              <div className="stat">
                <div className={`v${errors ? " bad" : ""}`}>{errors}</div>
                <div className="l">Errors</div>
              </div>
              <div className="stat">
                <div className="v">{seconds(elapsed)}</div>
                <div className="l">Elapsed</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="ov-hint runner-empty">Press Run to send every request in order. Results appear here as they finish.</div>
        )}

        {finished ? (
          <div className="fin-tools">
            <div className="segmented" role="group" aria-label="Filter results">
              <button className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                All
              </button>
              <button className={filter === "failed" ? "active" : ""} aria-pressed={filter === "failed"} onClick={() => setFilter("failed")}>
                Failed<span className="c">{failedRows}</span>
              </button>
              <button className={filter === "skipped" ? "active" : ""} aria-pressed={filter === "skipped"} onClick={() => setFilter("skipped")}>
                Skipped<span className="c">{skippedRows}</span>
              </button>
            </div>
            <span className="grow" />
            <span className="note tnum">
              Showing {shown.length} of {results.length}
            </span>
          </div>
        ) : null}

        {hasRun ? (
          <div className="pg-wrap results">
            <table className="pg-table">
              <colgroup>
                <col style={{ width: 44 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 150 }} />
                <col />
                <col style={{ width: 76 }} />
                <col style={{ width: 80 }} />
                {finished ? <col style={{ width: 110 }} /> : null}
                <col style={{ width: 86 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="r">#</th>
                  <th>Method</th>
                  <th>Name</th>
                  <th>URL</th>
                  <th>Code</th>
                  <th className="r">Time</th>
                  {finished ? <th>Duration</th> : null}
                  <th>Tests</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ r, i }) => {
                  const passed = r.tests.filter((t) => t.passed).length;
                  const failing = isFailing(r);
                  const isOpen = failing !== toggled.has(i);
                  const hasDetail = !!r.error || r.tests.length > 0 || r.console.length > 0;
                  return (
                    <Fragment key={i}>
                      <tr
                        className={`pg-open${failing ? " fail" : ""}${r.skipped ? " skip" : ""}`}
                        tabIndex={0}
                        aria-expanded={isOpen}
                        onClick={() => toggle(i, isOpen)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle(i, isOpen);
                          }
                        }}
                      >
                        <td className="n" title={`Iteration ${r.iteration + 1}`}>
                          {i + 1}
                        </td>
                        <td>
                          <MethodTag method={r.method} />
                        </td>
                        <td className="name">{r.name}</td>
                        <td className="u">
                          <UrlCell url={r.url} />
                        </td>
                        <td>
                          {r.skipped ? "skipped" : r.code ? <span className={`status ${statusClass(r.code)}`}>{r.code}</span> : r.error ? <span className="status s5">error</span> : "-"}
                        </td>
                        <td className="r t">{r.skipped ? "-" : `${Math.round(r.timeMs)} ms`}</td>
                        {finished ? (
                          <td className="d2">
                            {r.skipped || !slowest ? null : (
                              <span className={`dur${failing ? " bad" : r.timeMs === slowest ? " slow" : ""}`}>
                                <i style={{ width: `${Math.max(2, (r.timeMs / slowest) * 100)}%` }} />
                              </span>
                            )}
                          </td>
                        ) : null}
                        <td>
                          {r.tests.length === 0 ? (
                            "-"
                          ) : (
                            <span className={`tests ${passed === r.tests.length ? "ok" : "no"}`}>
                              {passed === r.tests.length ? <Check size={13} /> : <X size={13} />}
                              {passed}/{r.tests.length}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="detail">
                          <td colSpan={cols}>
                            <div className={`in${failing ? " fail" : ""}`}>
                              {r.error ? (
                                <div className="tl no">
                                  <CircleX size={13} />
                                  <div>
                                    <span className="err">{r.error}</span>
                                  </div>
                                </div>
                              ) : null}
                              {r.tests.map((t, ti) => (
                                <div key={ti} className={`tl ${t.passed ? "ok" : "no"}`}>
                                  {t.passed ? <CircleCheck size={13} /> : <CircleX size={13} />}
                                  <div>
                                    {t.name}
                                    {t.error ? <span className="err">{t.error}</span> : null}
                                  </div>
                                </div>
                              ))}
                              {r.console.map((line, ci) => (
                                <div key={ci} className="con">
                                  <Terminal size={13} />
                                  <span>{line}</span>
                                </div>
                              ))}
                              {hasDetail ? null : <span className="subtlest">No tests or console output.</span>}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {inFlight && filter === "all" ? (
                  <tr className="run">
                    <td className="n">{results.length + 1}</td>
                    <td>
                      <MethodTag method={inFlight.item.request?.method ?? "GET"} />
                    </td>
                    <td className="name">{inFlight.item.name}</td>
                    <td className="u">
                      <UrlCell url={urlRaw(inFlight.item.request?.url)} />
                    </td>
                    <td>
                      <span className="spin" aria-hidden="true" />
                    </td>
                    <td className="r">running</td>
                    <td className="subtlest">-</td>
                  </tr>
                ) : null}
                {shown.length === 0 && !inFlight ? (
                  <tr className="pg-empty">
                    <td colSpan={cols}>No results match.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
