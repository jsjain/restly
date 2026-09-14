import CodeEditor from "./CodeEditor";
import type { EventEntry } from "../types";

interface Target {
  event?: EventEntry[];
}

interface Props {
  target: Target;
  listen: "prerequest" | "test";
  onChange: () => void;
}

// Edits the first event with the given `listen`: creates it when the code stops being
// empty, and removes it when the code becomes empty. Other events are left untouched.
export default function ScriptEditor({ target, listen, onChange }: Props) {
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

  return <CodeEditor value={code} language="javascript" onChange={setCode} />;
}
