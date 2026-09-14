import { Fragment, useState } from "react";
import * as api from "../api";
import { isCollectionDirty, notifyChange, saveCollectionFile, selectedEnv, state, toast } from "../store";
import type { RunnerTab as RunnerTabState } from "../store";
import { methodClass } from "../method";

interface Props {
  tab: RunnerTabState;
}

// The run:result/run:done subscription lives in store.ts (openRunnerTab), for the tab's
// whole lifetime, since only the active tab is mounted and a run can outlive tab switches.
export default function RunnerTab({ tab }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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
      notifyChange();
    }
  }

  async function handleStop() {
    await api.stopRun();
  }

  return (
    <div className="subtab-body">
      <div className="field-row">
        <label>Iterations</label>
        <input
          type="number"
          min={1}
          value={tab.iterations}
          onChange={(e) => {
            tab.iterations = Math.max(1, Number(e.target.value) || 1);
            notifyChange();
          }}
        />
      </div>
      <div className="field-row">
        <label>Delay (ms)</label>
        <input
          type="number"
          min={0}
          value={tab.delayMs}
          onChange={(e) => {
            tab.delayMs = Math.max(0, Number(e.target.value) || 0);
            notifyChange();
          }}
        />
      </div>
      <div className="field-row">
        <button className="primary" onClick={handleRun} disabled={tab.running}>
          {tab.running ? "Running…" : "Run"}
        </button>
        <button onClick={handleStop} disabled={!tab.running}>
          Stop
        </button>
      </div>

      <table className="kv-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Method</th>
            <th>Name</th>
            <th>URL</th>
            <th>Code</th>
            <th>Time</th>
            <th>Tests</th>
          </tr>
        </thead>
        <tbody>
          {tab.results.map((r, i) => {
            const passed = r.tests.filter((t) => t.passed).length;
            const isOpen = expanded.has(i);
            const method = methodClass(r.method);
            return (
              <Fragment key={i}>
                <tr
                  onClick={() => {
                    const next = new Set(expanded);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    setExpanded(next);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <td>{r.iteration}</td>
                  <td>
                    <span className={`method-badge method-${method}`}>{r.method}</span>
                  </td>
                  <td>{r.name}</td>
                  <td className="mono">{r.url}</td>
                  <td>{r.skipped ? "skipped" : r.code || "-"}</td>
                  <td>{Math.round(r.timeMs)} ms</td>
                  <td>
                    {passed}/{r.tests.length}
                  </td>
                </tr>
                {isOpen ? (
                  <tr>
                    <td colSpan={7}>
                      {r.error ? <div className="response-error">{r.error}</div> : null}
                      {r.tests.map((t, ti) => (
                        <div key={ti} className="test-row">
                          <span className={t.passed ? "test-pass" : "test-fail"}>{t.passed ? "✓" : "✗"}</span>
                          <span>{t.name}</span>
                          {t.error ? <span className="test-fail mono">{t.error}</span> : null}
                        </div>
                      ))}
                      {r.console.map((line, ci) => (
                        <div key={ci} className="console-line">
                          {line}
                        </div>
                      ))}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {tab.summary ? (
        <div className="hint">
          {tab.summary.requests} requests, {tab.summary.passed} tests passed, {tab.summary.failed} failed,{" "}
          {tab.summary.errors} errors{tab.summary.stopped ? " (stopped)" : ""}
        </div>
      ) : null}
    </div>
  );
}
