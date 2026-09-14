import { Decoration, EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// Every color here is a CSS variable set by applyTheme() in theme.ts, so switching themes only
// needs a document.documentElement.style write, never editor reconfiguration. See theme/tokens.ts
// for the token contract.

const restlyEditorBaseTheme = EditorView.theme({
  "&": {
    color: "var(--text)",
    backgroundColor: "var(--surface)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-mono)",
  },
  ".cm-content": {
    caretColor: "var(--text)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--text)",
  },
  // One selection color with or without focus: read-only viewers never take focus.
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--selection)",
  },
  ".cm-selectedText, .cm-selectedText *": {
    color: "var(--text) !important",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface)",
    color: "var(--text-subtlest)",
    border: "none",
    borderRight: "1px solid var(--border-subtle)",
  },
  // The selection layer is drawn under the lines, so a filled active line would hide the selection on it.
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  // VS Code marks the active line number by color only. A filled cell reads as a stray box in the gutter.
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--text)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--surface-active)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--var-defined-bg)",
    outline: "1px solid var(--var-defined)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--surface-active)",
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "var(--surface-active)",
    outline: "1px solid var(--border-focus)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--surface-overlay)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-small)",
    color: "var(--text-subtle)",
  },
  ".cm-panels": {
    backgroundColor: "var(--surface-overlay)",
    color: "var(--text)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--border)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--border)",
  },
  ".cm-panel input, .cm-panel button, .cm-panel select": {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-ui)",
  },
  ".cm-panel.cm-search button": {
    backgroundColor: "var(--surface-raised)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: "var(--radius-small)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--surface-overlay)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-small)",
    boxShadow: "var(--shadow-overlay)",
    color: "var(--text)",
  },
  ".cm-tooltip .cm-tooltip-arrow:before": {
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: "var(--surface-overlay)",
    borderBottomColor: "var(--surface-overlay)",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--surface-hover)",
      color: "var(--text)",
    },
  },
});

// Tags from lang-json, lang-javascript, and the shell, python, and go legacy modes. Restly has no
// function or type color, so those read as --text and --syntax-property like VS Code's JSON view.
const restlyHighlightStyle = HighlightStyle.define([
  // Legacy modes emit "builtin" as standard(variableName).
  { tag: [tags.keyword, tags.self, tags.standard(tags.variableName)], color: "var(--syntax-keyword)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syntax-property)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.integer, tags.float], color: "var(--syntax-number)" },
  { tag: [tags.bool, tags.atom, tags.null], color: "var(--syntax-boolean)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syntax-comment)", fontStyle: "italic" },
  {
    tag: [tags.punctuation, tags.bracket, tags.separator, tags.squareBracket, tags.brace, tags.operator, tags.meta],
    color: "var(--syntax-punctuation)",
  },
  {
    tag: [tags.name, tags.variableName, tags.definition(tags.variableName), tags.function(tags.variableName)],
    color: "var(--text)",
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-property)" },
  { tag: tags.invalid, color: "var(--danger)" },
]);

const selectedTextMark = Decoration.mark({ class: "cm-selectedText" });

// selectedText marks selected ranges so their text reads as --text over --selection. The selection
// layer sits under syntax-colored text, and a read-only or unfocused editor has no native selection
// for the ::selection rule in styles.css to recolor.
const selectedText = EditorView.decorations.compute(["selection"], (state) =>
  Decoration.set(state.selection.ranges.filter((r) => !r.empty).map((r) => selectedTextMark.range(r.from, r.to)))
);

/** CodeMirror 6 extension applying Restly's theme tokens. Reconfigure-free theme switching. */
export const restlyEditorTheme = [restlyEditorBaseTheme, syntaxHighlighting(restlyHighlightStyle), selectedText];
