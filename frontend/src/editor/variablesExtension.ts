// {{variable}} highlighting + hover for CodeMirror bodies (raw/GraphQL editors).
// @codemirror/autocomplete isn't an installed dependency, so the {{ completion source
// described in the spec is skipped here; VarInput covers autocomplete for KV/env inputs.
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { resolveVariable, VARIABLE_PATTERN } from "../variables";

const matcher = new MatchDecorator({
  regexp: new RegExp(VARIABLE_PATTERN.source, "g"),
  decoration: (match) => {
    const info = resolveVariable(match[1]);
    return Decoration.mark({ class: info.scope === "undefined" ? "cm-var-undefined" : "cm-var-defined" });
  },
});

const decorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      // Recomputed on every update, not just doc/viewport changes: a variable's
      // defined/undefined status can flip from outside this editor (switching the
      // environment, editing another tab's collection variables), and MatchDecorator's
      // own updateDeco has no way to know that happened.
      this.decorations = matcher.createDeco(update.view);
    }
  },
  { decorations: (v) => v.decorations }
);

function maskValue(v: string): string {
  return "•".repeat(Math.min(Math.max(v.length, 4), 10));
}

// Builds the same popup content VarInput shows, as plain DOM (CodeMirror tooltips render
// outside React).
function popupDom(name: string): HTMLElement {
  const info = resolveVariable(name);
  const dom = document.createElement("div");
  dom.className = "var-popup";
  dom.setAttribute("role", "tooltip");

  const title = document.createElement("div");
  title.className = "var-popup-name mono";
  title.textContent = `{{${info.name}}}`;
  dom.appendChild(title);

  if (info.scope === "undefined") {
    const hint = document.createElement("div");
    hint.className = "var-popup-hint";
    hint.textContent = "Not defined in the selected environment, collection, or globals";
    dom.appendChild(hint);
    return dom;
  }

  const valueRow = document.createElement("div");
  valueRow.className = "var-popup-row mono";
  dom.appendChild(valueRow);

  const resolvedRow = document.createElement("div");
  resolvedRow.className = "var-popup-row var-popup-resolved mono";
  if (info.resolved !== info.value) dom.appendChild(resolvedRow);

  let shown = false;
  const render = () => {
    valueRow.textContent = info.secret && !shown ? maskValue(info.value) : info.value;
    resolvedRow.textContent = "→ " + (info.secret && !shown ? maskValue(info.resolved) : info.resolved);
  };
  render();

  const scopeRow = document.createElement("div");
  scopeRow.className = "var-popup-scope";
  scopeRow.textContent = info.scopeLabel;
  dom.appendChild(scopeRow);

  if (info.secret) {
    const toggle = document.createElement("button");
    toggle.className = "icon";
    toggle.textContent = "Show";
    toggle.onclick = () => {
      shown = !shown;
      toggle.textContent = shown ? "Hide" : "Show";
      render();
    };
    dom.appendChild(toggle);
  }

  return dom;
}

const varHover = hoverTooltip(
  (view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const re = new RegExp(VARIABLE_PATTERN.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(line.text))) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      if (pos >= from && pos <= to) {
        return { pos: from, end: to, above: false, create: () => ({ dom: popupDom(match![1]) }) };
      }
    }
    return null;
  },
  { hoverTime: 150 }
);

export function variablesExtension(): Extension {
  return [decorationPlugin, varHover];
}
