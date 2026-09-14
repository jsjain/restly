import { useMemo, useState } from "react";
import CodeEditor from "./CodeEditor";
import Select from "./Select";
import * as api from "../api";
import { toast } from "../store";
import type { RequestTab } from "../store";
import type { SendResult } from "../types";

interface Props {
  tab: RequestTab;
  result: SendResult;
  onChange: () => void;
}

type SubTab = "body" | "headers" | "cookies" | "tests" | "console";

function statusClass(code: number): string {
  if (code >= 500) return "status-5xx";
  if (code >= 400) return "status-4xx";
  if (code >= 300) return "status-3xx";
  return "status-2xx";
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

export default function ResponsePane({ tab, result, onChange }: Props) {
  const [sub, setSub] = useState<SubTab>("body");
  const response = result.response;

  const parsed = useMemo(() => {
    if (result.binary || result.truncated || result.body.length > MAX_PRETTY) return null;
    try {
      return JSON.parse(result.body);
    } catch {
      return null;
    }
  }, [result.body, result.binary, result.truncated]);

  const pretty = useMemo(() => (parsed === null ? "" : JSON.stringify(parsed, null, 2)), [parsed]);

  const passed = result.tests.filter((t) => t.passed).length;
  const failed = result.tests.length - passed;

  return (
    <div className="split-bottom">
      {result.error ? <div className="response-error">{result.error}</div> : null}
      {response ? (
        <>
          <div className="response-status">
            <span className={`status-pill ${statusClass(response.code)}`}>
              {response.code} {response.status}
            </span>
            <span
              className="response-meta"
              title={`dns ${response.timings.dns}ms connect ${response.timings.connect}ms tls ${response.timings.tls}ms firstByte ${response.timings.firstByte}ms`}
            >
              {Math.round(response.timings.total)} ms
            </span>
            <span className="response-meta">{response.size} B</span>
          </div>
          <div className="subtabs">
            {(["body", "headers", "cookies", "tests", "console"] as SubTab[]).map((s) => (
              <button key={s} className={sub === s ? "active" : ""} onClick={() => setSub(s)}>
                {s === "tests" ? `Tests (${passed}/${result.tests.length})` : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="subtab-body" style={{ display: "flex", flexDirection: "column" }}>
            {sub === "body" ? (
              result.binary ? (
                <div>
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
                  {parsed !== null ? (
                    <>
                      <div className="field-row">
                        <label>View</label>
                        <Select
                          value={tab.bodyView}
                          onChange={(v) => { tab.bodyView = v as "pretty" | "raw"; onChange(); }}
                          ariaLabel="View"
                          options={[
                            { value: "pretty", label: "Pretty" },
                            { value: "raw", label: "Raw" },
                          ]}
                        />
                      </div>
                      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                        <CodeEditor
                          value={tab.bodyView === "pretty" ? pretty : result.body}
                          language="json"
                          readOnly
                        />
                      </div>
                    </>
                  ) : (
                    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                      <CodeEditor value={result.body} language="text" readOnly />
                    </div>
                  )}
                </>
              )
            ) : null}

            {sub === "headers" ? (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {response.header.map((h, i) => (
                    <tr key={i}>
                      <td className="mono">{h.key}</td>
                      <td className="mono">{h.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {sub === "cookies" ? (
              <table className="kv-table">
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
                      <td className="mono">{c.name}</td>
                      <td className="mono">{c.value}</td>
                      <td>{c.domain}</td>
                      <td>{c.path}</td>
                      <td>{c.expires}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {sub === "tests" ? (
              <div>
                <div className="hint">
                  {passed} passed, {failed} failed
                </div>
                {result.tests.map((t, i) => (
                  <div key={i} className="test-row">
                    <span className={t.passed ? "test-pass" : "test-fail"}>{t.passed ? "✓" : "✗"}</span>
                    <span>{t.name}</span>
                    {t.error ? <span className="test-fail mono">{t.error}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {sub === "console" ? (
              <div>
                {result.console.map((line, i) => (
                  <div key={i} className="console-line">
                    {line}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : !result.error ? (
        <div className="empty-state">No response.</div>
      ) : null}
    </div>
  );
}
