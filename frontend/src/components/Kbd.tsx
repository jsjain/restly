import { listCommands } from "../commands";
import { effectiveKeys, formatKeys } from "../shortcuts";

// "⎋" is not widely recognized, so keycaps spell Escape out.
const KEY_LABEL: Record<string, string> = { escape: "esc" };

// Keycaps for a command's first shortcut, or for a literal chord, one cap per key. Bindings are read
// on each render, as ShortcutsHelp does, so keybindings.json edits show on the next render.
export function Kbd({ command, keys, className }: { command?: string; keys?: string; className?: string }) {
  const cmd = command ? listCommands().find((c) => c.id === command) : undefined;
  const chord = keys ?? (cmd ? effectiveKeys(cmd)[0] : undefined);
  if (!chord) return null;
  // A trailing "+" is the plus key itself (mod++), not a separator.
  const tokens = chord.endsWith("++") ? [...chord.slice(0, -2).split("+"), "+"] : chord.split("+");
  return (
    <kbd className={"kbd" + (className ? " " + className : "")} aria-hidden="true">
      {tokens.map((token, i) => (
        <span key={i} className="key">
          {KEY_LABEL[token] ?? formatKeys([token])}
        </span>
      ))}
    </kbd>
  );
}
