// One capture-phase keydown listener that dispatches to the command registry. Capture phase
// so it sees the key before App.tsx/RequestTab.tsx's bubble-phase listeners and before
// CodeMirror's own keymap acts on it (both are deleted as part of wiring this in — see the
// caller's integration doc).
import { listCommands } from "./commands";
import type { Command } from "./commands";

export function isMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;
  return /mac/i.test(platform);
}

const mac = isMac();

const MODIFIER_ORDER = ["alt", "ctrl", "meta", "shift"] as const;

// Translates an author-facing spec ("mod+shift+t") into the canonical form used for the
// runtime Map lookup ("meta+shift+t" on mac, "ctrl+shift+t" elsewhere). "mod" is the only
// token that's platform-dependent; "ctrl"/"meta" always mean the literal key (used for
// ctrl+tab and keybindings.json's "cmd", both fixed regardless of platform).
export function normalizeSpec(spec: string, onMac: boolean): string {
  const mods = new Set<string>();
  let base = "";
  for (const token of spec.toLowerCase().split("+")) {
    if (token === "mod") mods.add(onMac ? "meta" : "ctrl");
    else if (token === "ctrl" || token === "alt" || token === "shift" || token === "meta") mods.add(token);
    else base = token;
  }
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), base].join("+");
}

const NAMED_KEYS: Record<string, string> = {
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
  escape: "escape",
  enter: "enter",
  tab: "tab",
  backspace: "backspace",
  delete: "delete",
  pageup: "pageup",
  pagedown: "pagedown",
  home: "home",
  end: "end",
  " ": "space",
};

// Physical punctuation keys, read from event.code rather than event.key so Shift can stay
// part of the chord: event.key for Shift+[ is "{" on a US layout, which could never match a
// "mod+shift+[" spec if we read it. Keying off the physical code means Shift+[ and [ are two
// distinct, stable chords on every layout, at the cost of the old behavior where a layout that
// requires Shift to type "/" still matched a plain "mod+/" binding (accepted: not a chord any
// default or documented binding uses beyond the plain, un-shifted key).
const CODE_PUNCT: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
};

// Resolves the non-modifier part of a keydown, and whether Shift should be folded into the
// canonical string for it. Letters/digits/physical punctuation read event.code (so Shift+T is
// still "t", Shift+[ is "shift+["); named control keys and function keys read event.key; any
// other printable character falls back to event.key and drops Shift, since it's not one of the
// physical keys above and the character itself already reflects any Shift needed to produce it.
function baseKey(e: KeyboardEvent): { base: string; dropShift: boolean } | null {
  if (e.code.startsWith("Key")) return { base: e.code.slice(3).toLowerCase(), dropShift: false };
  if (e.code.startsWith("Digit")) return { base: e.code.slice(5), dropShift: false };
  if (e.code in CODE_PUNCT) return { base: CODE_PUNCT[e.code], dropShift: false };
  const key = e.key.toLowerCase();
  if (key === "shift" || key === "control" || key === "alt" || key === "meta") return null;
  if (key in NAMED_KEYS) return { base: NAMED_KEYS[key], dropShift: false };
  if (/^f([1-9]|1[0-2])$/.test(key)) return { base: key, dropShift: false };
  if (key.length === 1) return { base: key, dropShift: true };
  return null; // other function keys etc. -- not used by any default shortcut
}

function eventToCanonical(e: KeyboardEvent): string | null {
  const resolved = baseKey(e);
  if (!resolved) return null;
  const mods: string[] = [];
  if (e.altKey) mods.push("alt");
  if (e.ctrlKey) mods.push("ctrl");
  if (e.metaKey) mods.push("meta");
  if (e.shiftKey && !resolved.dropShift) mods.push("shift");
  return [...mods, resolved.base].join("+");
}

// Covers both "is this a text-entry field" (plain-letter shortcuts are suppressed there so a
// bare key doesn't hijack typing) and "is this a field whose own native/CodeMirror key
// handling must not be interfered with" (see suppressBeep below).
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return !!el.closest?.(".cm-editor");
}

const INTERACTIVE_SELECTOR =
  'button, a[href], input, textarea, select, [contenteditable], .cm-editor, ' +
  '[role="option"], [role="treeitem"], [role="listbox"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"]';

function isInteractiveTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.(INTERACTIVE_SELECTOR);
}

const NEVER_PREVENT_KEYS = new Set(["Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

// Wails installs a default app menu with an Edit menu when the app sets no custom Menu (see
// Wails' pkg/options/options.go, the `Menu == nil` branch), and on mac that menu's Edit/App
// roles carry the OS's standard items -- Undo/Redo, Cut/Copy/Paste, Paste and Match Style,
// Select All, Hide/Hide Others, Quit -- so these chords must reach that native menu unprevented
// even when no Restly command claims them, or they stop working outright.
const NEVER_PREVENT_CHORDS = new Set<string>([
  "ctrl+a", "meta+a",
  "ctrl+c", "meta+c",
  "ctrl+v", "meta+v",
  "ctrl+x", "meta+x",
  "ctrl+z", "meta+z",
  "ctrl+shift+z", "meta+shift+z",
  "ctrl+y", "meta+y",
  "meta+q", "meta+h", "meta+m",
  "alt+meta+h", // Hide Others
  "alt+meta+shift+v", // Paste and Match Style
]);

// A keydown the page doesn't handle bubbles up to Wails' native window, which has no handler
// of its own and plays the system beep. preventDefault (never stopPropagation, so component
// onKeyDown handlers still run) swallows two cases before that happens: (a) a ctrl/meta chord
// that matched no command, unless it's one of the editing/system chords above or the target is
// editable (CodeMirror and native Cocoa text-field chords like Ctrl+E/Ctrl+F/Cmd+F must reach
// the field unblocked -- a stray unmatched chord typed into a field is left to beep); and
// (b) a plain printable character, Backspace, or Enter typed where nothing will consume it.
// Tab/Escape/arrows/PageUp/PageDown/Home/End/Space always pass through untouched.
function suppressBeep(e: KeyboardEvent): void {
  if (NEVER_PREVENT_KEYS.has(e.key)) return;

  if (e.ctrlKey || e.metaKey) {
    if (isEditableTarget(e.target)) return;
    const chord = eventToCanonical(e);
    if (chord && NEVER_PREVENT_CHORDS.has(chord)) return;
    e.preventDefault();
    return;
  }

  const plainChar = e.key.length === 1;
  if (!plainChar && e.key !== "Backspace" && e.key !== "Enter") return;
  if (isInteractiveTarget(e.target)) return;
  e.preventDefault();
}

// Per-command effective key lists loaded from keybindings.json, keyed by command id. Absence
// means "use Command.keys" (the defaults from registerCommand); see keybindings.ts.
let keyOverrides = new Map<string, string[]>();
let keyMap = new Map<string, Command>();

function rebuildKeyMap(): void {
  const map = new Map<string, Command>();
  for (const command of listCommands()) {
    for (const spec of effectiveKeys(command)) map.set(normalizeSpec(spec, mac), command);
  }
  keyMap = map;
}

// Called by keybindings.ts after parsing keybindings.json. `overrides` gives the full,
// already-deduped effective key list for every command it touched.
export function setKeyOverrides(overrides: Map<string, string[]>): void {
  keyOverrides = overrides;
  rebuildKeyMap();
}

export function effectiveKeys(command: Command): string[] {
  return keyOverrides.get(command.id) ?? command.keys ?? [];
}

// True if keybindings.json changes this command's keys from its registerCommand default
// (comparing canonical forms, so a user entry that's a no-op, or an override that ends up
// identical to the default after edits, isn't flagged).
export function isCustomized(command: Command): boolean {
  const override = keyOverrides.get(command.id);
  if (!override) return false;
  const canon = (keys: string[]) => keys.map((k) => normalizeSpec(k, mac)).sort().join(",");
  return canon(override) !== canon(command.keys ?? []);
}

// A "plain-letter" shortcut has no modifier at all (canonical string has no "+"); those are
// suppressed while typing so a bare key doesn't hijack a text field. Modifier chords always
// fire, even in an input/textarea/CodeMirror.
function isTypingTarget(target: EventTarget | null): boolean {
  return isEditableTarget(target);
}

// Installs the single global keydown listener and returns a function to remove it (call from
// a useEffect cleanup; safe to install/uninstall repeatedly, e.g. under StrictMode).
export function installShortcuts(): () => void {
  rebuildKeyMap();

  function onKeyDown(e: KeyboardEvent): void {
    // An open overlay (palette, shortcuts help, tab context menu, or an existing .modal-overlay
    // dialog) owns the keyboard: it handles its own arrows/Enter/Escape and re-dispatches
    // commands itself, so don't also act on the tab/document underneath it.
    if ((e.target as HTMLElement | null)?.closest?.('[role="dialog"], [role="menu"], .modal-overlay')) return;

    const canonical = eventToCanonical(e);
    if (canonical) {
      const command = keyMap.get(canonical);
      const typing = !canonical.includes("+") && isTypingTarget(e.target);
      if (command && !typing && !(command.when && !command.when())) {
        e.preventDefault();
        e.stopPropagation();
        command.run();
        return;
      }
    }

    suppressBeep(e);
  }

  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}

const MAC_SYMBOL: Record<string, string> = {
  mod: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  enter: "↩",
  tab: "⇥",
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  escape: "⎋",
  backspace: "⌫",
  delete: "⌦",
  pageup: "⇞",
  pagedown: "⇟",
  home: "↖",
  end: "↘",
  space: "Space",
};

const OTHER_WORD: Record<string, string> = {
  mod: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  enter: "Enter",
  tab: "Tab",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  escape: "Esc",
  backspace: "Backspace",
  delete: "Delete",
  pageup: "Page Up",
  pagedown: "Page Down",
  home: "Home",
  end: "End",
  space: "Space",
};

// Renders one chord's tokens (as authored, e.g. ["mod", "shift", "t"]) for display: "⌘⇧T" on
// mac, "Ctrl+Shift+T" elsewhere. Command.keys entries are "+"-joined strings; split before
// calling, e.g. formatKeys("mod+shift+t".split("+")).
export function formatKeys(keys: string[]): string {
  if (isMac()) return keys.map((k) => MAC_SYMBOL[k] ?? k.toUpperCase()).join("");
  return keys.map((k) => OTHER_WORD[k] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1))).join("+");
}
