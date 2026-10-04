import { useEffect, useRef, useState } from "react";
import { placeholder } from "@codemirror/view";
import { ChevronDown, Plus } from "lucide-react";
import CodeEditor from "./CodeEditor";
import { scriptCompletions } from "../editor/scriptCompletions";
import type { EventEntry } from "../types";

// Passed once so CodeEditor does not recreate its view on every render.
const scriptExtensions = [...scriptCompletions, placeholder("// Write JavaScript using pm.* (or restly.*)")];

const SNIPPETS: Record<"prerequest" | "test", { label: string; code: string }[]> = {
  prerequest: [
    { label: "Set an environment variable", code: 'pm.environment.set("name", "value");' },
    { label: "Set a collection variable", code: 'pm.collectionVariables.set("name", "value");' },
    { label: "Generate a timestamp", code: 'pm.environment.set("timestamp", new Date().toISOString());' },
    { label: "Log a value", code: 'console.log(pm.environment.get("name"));' },
  ],
  test: [
    { label: "Status code is 200", code: 'pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});' },
    {
      label: "Response time is below 500 ms",
      code: 'pm.test("Response time is below 500 ms", function () {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});',
    },
    {
      label: "Body has a JSON value",
      code: 'pm.test("Body has a JSON value", function () {\n  pm.expect(pm.response.json()).to.have.property("id");\n});',
    },
    { label: "Save a value from the response to the environment", code: 'pm.environment.set("token", pm.response.json().token);' },
  ],
};

interface Target {
  event?: EventEntry[];
}

interface Props {
  target: Target;
  listen: "prerequest" | "test";
  onChange: () => void;
  // Replaces the default "when it runs" sentence, e.g. for scripts that cover many requests.
  hint?: string;
}

// Edits the first event with the given `listen`: creates it when the code stops being
// empty, and removes it when the code becomes empty. Other events are left untouched.
export default function ScriptEditor({ target, listen, onChange, hint }: Props) {
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const event = target.event?.find((e) => e.listen === listen);
  const exec = event?.script?.exec;
  const code = Array.isArray(exec) ? exec.join("\n") : exec ?? "";

  function setCode(next: string) {
    if (next.trim() === "") {
      if (target.event) target.event = target.event.filter((e) => e !== event);
      onChange();
      return;
    }
    if (!event) {
      target.event ??= [];
      target.event.push({ listen, script: { type: "text/javascript", exec: next.split("\n") } });
    } else {
      event.script = { ...event.script, type: "text/javascript", exec: next.split("\n") };
    }
    onChange();
  }

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && anchor.current?.contains(e.target as Node)) return;
      setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setMenu(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Appended rather than inserted at the cursor: CodeEditor does not expose its view.
  function insert(snippet: string) {
    setMenu(false);
    setCode(code.trim() ? code.replace(/\s+$/, "") + "\n\n" + snippet : snippet);
  }

  return (
    <div className="script-editor">
      <div className="script-head">
        <span>{hint ?? (listen === "prerequest" ? "Runs before the request is sent." : "Runs after the response arrives. Use it for tests.")}</span>
        <div className="menu-anchor" ref={anchor}>
          <button type="button" className="ghost" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
            Snippets
            <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {menu ? (
            <div className="menu script-snippets" role="menu">
              {SNIPPETS[listen].map((sn) => (
                <button key={sn.label} type="button" role="menuitem" onClick={() => insert(sn.code)}>
                  {sn.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="script-frame">
        <CodeEditor value={code} language="javascript" onChange={setCode} extensions={scriptExtensions} />
      </div>
    </div>
  );
}
