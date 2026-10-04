import { useEffect, useState } from "react";
import { File as FileIcon, FileText } from "lucide-react";
import type { CodeLang } from "./CodeEditor";
import CodeEditor from "./CodeEditor";
import { Kbd } from "./Kbd";
import KvTable from "./KvTable";
import Select from "./Select";
import type { Item, RequestBody } from "../types";
import { detectFormatKind, formatBody } from "../format";
import { FORMAT_BODY } from "../commands";
import { toast } from "../store";
import * as api from "../api";

interface Props {
  item: Item;
  onChange: () => void;
}

type Mode = "none" | "raw" | "urlencoded" | "formdata" | "file" | "graphql";

const MODE_LABEL: Record<Mode, string> = {
  none: "None",
  raw: "Raw",
  urlencoded: "URL-encoded",
  formdata: "Form data",
  file: "File",
  graphql: "GraphQL",
};

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

  const filePath = req.body?.file?.src ?? "";
  const [editPath, setEditPath] = useState(false);

  function setFilePath(src: string) {
    req.body!.file = { ...req.body!.file, src };
    onChange();
  }

  async function chooseFile() {
    try {
      const picked = await api.pickFile("Choose a file to send as the body");
      if (picked) setFilePath(picked);
    } catch (err) {
      toast(String(err), "error");
    }
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
    <div className="body-pane">
      <div className="body-bar">
        <div className="segmented body-modes" role="radiogroup" aria-label="Body type">
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <label key={m}>
              <input type="radio" name="body-mode" checked={mode === m} onChange={() => setMode(m)} />
              {MODE_LABEL[m]}
            </label>
          ))}
        </div>
        {mode === "raw" ? (
          <div className="body-bar-end">
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
            {formatKind ? (
              <button type="button" className="ghost body-format" title="Format body" onClick={runFormat}>
                Format
                <Kbd command="format-body" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === "raw" ? (
        <div className="body-editor">
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
      ) : null}

      {mode === "urlencoded" ? <KvTable rows={(req.body!.urlencoded ??= [])} onChange={onChange} label="field" /> : null}

      {mode === "formdata" ? <KvTable rows={(req.body!.formdata ??= [])} onChange={onChange} formdata /> : null}

      {mode === "file" ? (
        <div className="body-file">
          <div className="body-file-row">
            <FileIcon size={15} strokeWidth={1.75} aria-hidden="true" />
            {editPath ? (
              <input
                type="text"
                className="mono"
                aria-label="File path"
                autoFocus
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
              />
            ) : (
              <span className={"body-file-path mono" + (filePath ? "" : " none")} title={filePath || undefined}>
                {filePath || "No file chosen"}
              </span>
            )}
            <button type="button" onClick={chooseFile}>
              Choose file…
            </button>
            <button type="button" className="ghost" onClick={() => setEditPath(!editPath)}>
              {editPath ? "Done" : "Edit path"}
            </button>
            {filePath ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setEditPath(false);
                  setFilePath("");
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className="body-file-hint">The file is read when the request is sent and sent as the raw body.</p>
        </div>
      ) : null}

      {mode === "graphql" ? (
        <div className="body-gql">
          <div className="body-gql-col body-gql-query">
            <div className="body-gql-head">
              <span>Query</span>
            </div>
            <div className="body-editor">
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
          <div className="body-gql-col">
            <div className="body-gql-head">
              <span>Variables (JSON)</span>
              {formatKind ? (
                <button type="button" className="ghost body-format" title="Format body" onClick={runFormat}>
                  Format
                  <Kbd command="format-body" />
                </button>
              ) : null}
            </div>
            <div className="body-editor">
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

      {mode === "none" ? (
        <div className="body-empty">
          <i aria-hidden="true">
            <FileText size={16} strokeWidth={1.75} />
          </i>
          <b>This request has no body</b>
          <span>Pick a body type above to add one.</span>
        </div>
      ) : null}
    </div>
  );
}
