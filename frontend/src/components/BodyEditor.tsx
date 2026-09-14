import { useEffect } from "react";
import type { CodeLang } from "./CodeEditor";
import CodeEditor from "./CodeEditor";
import KvTable from "./KvTable";
import Select from "./Select";
import type { Item, RequestBody } from "../types";
import { detectFormatKind, formatBody } from "../format";
import { FORMAT_BODY } from "../commands";
import { toast } from "../store";

interface Props {
  item: Item;
  onChange: () => void;
}

type Mode = "none" | "raw" | "urlencoded" | "formdata" | "file" | "graphql";

function rawLang(language: string | undefined): CodeLang {
  if (language === "json") return "json";
  if (language === "javascript") return "javascript";
  return "text";
}

export default function BodyEditor({ item, onChange }: Props) {
  const req = item.request!;
  const mode: Mode = (req.body?.mode as Mode) ?? "none";

  function setMode(next: Mode) {
    if (next === "none") {
      delete req.body;
      onChange();
      return;
    }
    const body: RequestBody = req.body ?? { mode: next };
    body.mode = next;
    if (next === "raw") {
      body.raw ??= "";
      body.options ??= { raw: { language: "json" } };
    } else if (next === "urlencoded") {
      body.urlencoded ??= [];
    } else if (next === "formdata") {
      body.formdata ??= [];
    } else if (next === "file") {
      body.file ??= { src: "" };
    } else if (next === "graphql") {
      body.graphql ??= { query: "", variables: "" };
    }
    req.body = body;
    onChange();
  }

  // "json"/"xml" format the raw body text; "graphql-variables" formats the Variables pane
  // instead (the query itself isn't JSON, so there's nothing to format there).
  const formatKind = detectFormatKind(mode, req.body?.options?.raw?.language);

  function runFormat() {
    if (!formatKind) return;
    const current = formatKind === "graphql-variables" ? req.body?.graphql?.variables ?? "" : req.body?.raw ?? "";
    const result = formatBody(formatKind, current);
    if (!result.ok) {
      toast(result.error ?? "Invalid body", "error");
      return;
    }
    if (formatKind === "graphql-variables") {
      req.body!.graphql = { ...req.body!.graphql, query: req.body?.graphql?.query ?? "", variables: result.text };
    } else {
      req.body!.raw = result.text;
    }
    onChange();
  }

  // Shift+Alt+F ("format-body" in commands.ts) fires this event; only the active request
  // tab's BodyEditor is mounted, so it alone listens (mirrors RequestTab's SEND/FOCUS_URL).
  useEffect(() => {
    const handler = () => runFormat();
    window.addEventListener(FORMAT_BODY, handler);
    return () => window.removeEventListener(FORMAT_BODY, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, formatKind]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="field-row">
        {(["none", "raw", "urlencoded", "formdata", "file", "graphql"] as Mode[]).map((m) => (
          <label key={m} style={{ width: "auto", marginRight: 12 }}>
            <input type="radio" name="body-mode" checked={mode === m} onChange={() => setMode(m)} /> {m}
          </label>
        ))}
        {mode === "raw" ? (
          <Select
            className="select-inline"
            value={req.body?.options?.raw?.language ?? "json"}
            onChange={(v) => {
              req.body!.options = { raw: { language: v as never } };
              onChange();
            }}
            ariaLabel="Language"
            options={[
              { value: "json", label: "JSON" },
              { value: "text", label: "Text" },
              { value: "xml", label: "XML" },
              { value: "html", label: "HTML" },
              { value: "javascript", label: "JavaScript" },
            ]}
          />
        ) : null}
        {mode === "raw" && formatKind ? (
          <button type="button" className="ghost" style={{ marginLeft: "auto" }} title="Format Body (Shift+Alt+F)" onClick={runFormat}>
            Format
          </button>
        ) : null}
      </div>

      {mode === "raw" ? (
        <>
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <CodeEditor
              value={req.body?.raw ?? ""}
              language={rawLang(req.body?.options?.raw?.language)}
              variables
              onChange={(v) => {
                req.body!.raw = v;
                onChange();
              }}
            />
          </div>
        </>
      ) : null}

      {mode === "urlencoded" ? <KvTable rows={req.body!.urlencoded!} onChange={onChange} /> : null}

      {mode === "formdata" ? <KvTable rows={req.body!.formdata!} onChange={onChange} formdata /> : null}

      {mode === "file" ? (
        <div className="field-row">
          <label>File path</label>
          <input
            type="text"
            className="mono"
            value={req.body?.file?.src ?? ""}
            onChange={(e) => {
              req.body!.file = { ...req.body!.file, src: e.target.value };
              onChange();
            }}
          />
        </div>
      ) : null}

      {mode === "graphql" ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 8 }}>
          <div>
            <div className="hint">Query</div>
            <div style={{ height: 180, display: "flex" }}>
              <CodeEditor
                value={req.body?.graphql?.query ?? ""}
                language="text"
                variables
                onChange={(v) => {
                  req.body!.graphql = { ...req.body!.graphql, query: v, variables: req.body?.graphql?.variables ?? "" };
                  onChange();
                }}
              />
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div className="hint">Variables (JSON)</div>
              {formatKind ? (
                <button type="button" className="ghost" style={{ marginLeft: "auto" }} title="Format Body (Shift+Alt+F)" onClick={runFormat}>
                  Format
                </button>
              ) : null}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <CodeEditor
                value={req.body?.graphql?.variables ?? ""}
                language="json"
                variables
                onChange={(v) => {
                  req.body!.graphql = { ...req.body!.graphql, query: req.body?.graphql?.query ?? "", variables: v };
                  onChange();
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
