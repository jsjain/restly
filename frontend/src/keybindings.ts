// Loads keybindings.json (VS Code's format, minus "when" and multi-chord support) and applies
// it on top of the registerCommand defaults in commands.ts. Loaded at startup and again on
// window focus (so an edit made in the system text editor takes effect on tabbing back in),
// and on demand via the "Reload Keybindings" command.
import { parseJsonc } from "./jsonc";
import { listCommands } from "./commands";
import { RELOAD_KEYBINDINGS } from "./commands";
import { normalizeSpec, setKeyOverrides, isMac } from "./shortcuts";
import * as api from "./api";
import { toast } from "./store";

const mac = isMac();

interface Entry {
  key?: string;
  command?: string;
  when?: unknown;
}

// cmd/meta/win are the literal Meta key, fixed regardless of platform; "mod" is Restly's own
// platform-dependent token (resolved later by normalizeSpec) and passes through unchanged.
const MOD_ALIAS: Record<string, string> = {
  cmd: "meta",
  meta: "meta",
  win: "meta",
  ctrl: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  mod: "mod",
};

const PUNCT_BASES = new Set(["[", "]", ",", ".", "/", "\\", ";", "'", "`", "-", "="]);
const NAMED_BASES = new Set(["enter", "tab", "escape", "space", "backspace", "delete", "up", "down", "left", "right", "pageup", "pagedown", "home", "end"]);

function isValidBase(base: string): boolean {
  if (/^[a-z0-9]$/.test(base)) return true;
  if (PUNCT_BASES.has(base)) return true;
  if (NAMED_BASES.has(base)) return true;
  return /^f([1-9]|1[0-2])$/.test(base);
}

// Translates one VS Code-style key spec ("cmd+shift+]") into Restly's own token vocabulary
// ("meta+shift+]"), the form normalizeSpec/formatKeys expect. Returns null for anything it
// can't parse (unknown modifier or key name).
function translateSpec(spec: string): string | null {
  const tokens = spec.trim().toLowerCase().split("+").filter(Boolean);
  if (tokens.length === 0) return null;
  const base = tokens[tokens.length - 1];
  if (!isValidBase(base)) return null;
  const mods: string[] = [];
  for (const token of tokens.slice(0, -1)) {
    const alias = MOD_ALIAS[token];
    if (!alias) return null;
    mods.push(alias);
  }
  return [...mods, base].join("+");
}

function sameChord(a: string, b: string): boolean {
  return normalizeSpec(a, mac) === normalizeSpec(b, mac);
}

let lastText: string | null = null;

export async function loadKeybindings(): Promise<void> {
  let file;
  try {
    file = await api.getKeybindings();
  } catch (err) {
    toast(`Could not read keybindings.json: ${String(err)}`, "error");
    return;
  }
  if (file.data === lastText) return; // unchanged since last load: nothing to rebuild
  lastText = file.data;
  apply(file.data);
}

function apply(text: string): void {
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch (err) {
    toast(`keybindings.json is not valid: ${String(err)}`, "error");
    return;
  }
  if (!Array.isArray(parsed)) {
    toast("keybindings.json: expected a top-level array", "error");
    return;
  }

  const ids = new Set(listCommands().map((c) => c.id));
  const effective = new Map<string, string[]>();
  const get = (id: string): string[] => effective.get(id) ?? listCommands().find((c) => c.id === id)?.keys ?? [];

  const problems: string[] = [];

  for (const raw of parsed as Entry[]) {
    if (!raw || typeof raw.command !== "string") continue;
    if (raw.when !== undefined) {
      problems.push(`"${raw.command}": "when" is not supported`);
      continue;
    }
    if (typeof raw.key === "string" && raw.key.trim().includes(" ")) {
      problems.push(`"${raw.command}": chord keys are not supported ("${raw.key}")`);
      continue;
    }

    const remove = raw.command.startsWith("-");
    const id = remove ? raw.command.slice(1) : raw.command;
    if (!ids.has(id)) {
      problems.push(`unknown command "${id}"`);
      continue;
    }

    if (remove) {
      if (raw.key === undefined) {
        effective.set(id, []);
        continue;
      }
      const spec = translateSpec(raw.key);
      if (!spec) {
        problems.push(`"${raw.command}": invalid key "${raw.key}"`);
        continue;
      }
      effective.set(id, get(id).filter((k) => !sameChord(k, spec)));
      continue;
    }

    if (typeof raw.key !== "string") {
      problems.push(`"${raw.command}": missing key`);
      continue;
    }
    const spec = translateSpec(raw.key);
    if (!spec) {
      problems.push(`"${raw.command}": invalid key "${raw.key}"`);
      continue;
    }
    // A key can only fire one command: adding it here takes it away from anyone else holding
    // it (later entries win), the same way binding it twice in commands.ts would be a bug.
    for (const other of listCommands()) {
      if (other.id === id) continue;
      const keys = get(other.id);
      const filtered = keys.filter((k) => !sameChord(k, spec));
      if (filtered.length !== keys.length) effective.set(other.id, filtered);
    }
    const current = get(id);
    if (!current.some((k) => sameChord(k, spec))) effective.set(id, [...current, spec]);
  }

  if (problems.length > 0) toast(`keybindings.json: ${problems.join("; ")}`, "error");
  setKeyOverrides(effective);
}

// Installs the startup/focus/manual-reload loading and returns a teardown. Call once from
// App.tsx.
export function initKeybindings(): () => void {
  loadKeybindings().catch((err) => toast(String(err), "error"));
  const onFocus = () => loadKeybindings().catch((err) => toast(String(err), "error"));
  window.addEventListener("focus", onFocus);
  window.addEventListener(RELOAD_KEYBINDINGS, onFocus);
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener(RELOAD_KEYBINDINGS, onFocus);
  };
}
