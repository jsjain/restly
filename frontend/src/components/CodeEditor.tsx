import { useEffect, useRef } from "react";
import { EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { StreamLanguage } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { python } from "@codemirror/legacy-modes/mode/python";
import { go } from "@codemirror/legacy-modes/mode/go";
import { restlyEditorTheme } from "../theme/codemirror";
import { variablesExtension } from "../editor/variablesExtension";

// basicSetup's defaultKeymap binds Mod-Enter to insertBlankLine and does not stop
// propagation. The app uses Mod-Enter to send the active request, so swallow it here
// with higher precedence instead of letting CodeMirror insert a newline first.
const noModEnter = Prec.highest(
  keymap.of([{ key: "Mod-Enter", run: () => true }])
);

// The snippet ids (see internal/snippet.Langs) beyond "javascript"/"json"/"text": "curl" and
// "fetch" cover the two request-tab languages that aren't legacy StreamLanguage modes, "fetch"
// snippets are plain JavaScript so they share the lang-javascript extension.
export type CodeLang = "json" | "javascript" | "text" | "curl" | "fetch" | "python" | "go";

interface Props {
  value: string;
  language: CodeLang;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  variables?: boolean;
}

function langExtension(lang: CodeLang): Extension[] {
  if (lang === "json") return [json()];
  if (lang === "javascript" || lang === "fetch") return [javascript()];
  if (lang === "curl") return [StreamLanguage.define(shell)];
  // The python mode emits a "self" token that has no default tag and logs a warning without this.
  if (lang === "python") return [StreamLanguage.define({ ...python, tokenTable: { self: tags.self } })];
  if (lang === "go") return [StreamLanguage.define(go)];
  return [];
}

export default function CodeEditor({ value, language, readOnly, onChange, variables }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Guards the programmatic value-sync dispatch below so it is never mistaken for a user
  // edit (which would report a false change) and never recorded in undo history (which
  // would let Cmd+Z restore another tab's content into this one).
  const syncing = useRef(false);

  // Recreate the view when language/readOnly change; StrictMode mounts this effect twice,
  // so the cleanup must destroy the view it created.
  useEffect(() => {
    if (!container.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        noModEnter,
        ...restlyEditorTheme,
        ...langExtension(language),
        ...(variables ? [variablesExtension()] : []),
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(!!readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing.current) onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });
    const instance = new EditorView({ state, parent: container.current });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly, variables]);

  // Sync an externally-changed value (e.g. switching tabs) without recreating the view or
  // fighting the user's cursor: only dispatch when the doc actually differs.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current !== value) {
      syncing.current = true;
      instance.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: Transaction.addToHistory.of(false),
      });
      syncing.current = false;
    }
  }, [value]);

  return <div className="cm-wrapper" ref={container} />;
}
