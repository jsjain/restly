// VS Code's find widget for CodeMirror: one row with the query, its three options, the match count,
// previous, next and close, and a replace row behind the chevron in editable editors.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery } from "@codemirror/search";
import { ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, Regex, Replace, ReplaceAll, WholeWord, X } from "lucide-react";
import { matchFrom, matchLabel } from "./findMatches";
import "./searchPanel.css";

type QueryPatch = Partial<Pick<SearchQuery, "search" | "replace" | "caseSensitive" | "regexp" | "wholeWord">>;

function updateQuery(view: EditorView, patch: QueryPatch, reveal: boolean): void {
  const current = getSearchQuery(view.state);
  const next = new SearchQuery({
    search: current.search,
    replace: current.replace,
    caseSensitive: current.caseSensitive,
    regexp: current.regexp,
    wholeWord: current.wholeWord,
    literal: current.literal,
    ...patch,
  });
  if (next.eq(current)) return;
  const match = reveal ? matchFrom(view.state, next, view.state.selection.main.from) : null;
  view.dispatch({
    effects: setSearchQuery.of(next),
    ...(match ? { selection: { anchor: match.from, head: match.to }, scrollIntoView: true, userEvent: "select.search" } : {}),
  });
}

// Buttons keep focus in the find field, as in VS Code, so typing continues after a click.
function IconButton({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={pressed === undefined ? "find-button" : "find-option"}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SearchWidget({ view }: { view: EditorView }) {
  const query = getSearchQuery(view.state);
  const readOnly = view.state.readOnly;
  const [replaceOpen, setReplaceOpen] = useState(false);
  const searchField = useRef<HTMLInputElement>(null);
  const replaceField = useRef<HTMLInputElement>(null);

  // The fields are uncontrolled so a keystroke never waits for a render. A query set from outside,
  // such as Cmd+F with text selected, is copied into them here.
  useEffect(() => {
    if (searchField.current && searchField.current.value !== query.search) searchField.current.value = query.search;
  }, [query.search]);
  useEffect(() => {
    if (replaceField.current && replaceField.current.value !== query.replace) replaceField.current.value = query.replace;
  }, [query.replace, replaceOpen]);

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (runScopeHandlers(view, e.nativeEvent, "search-panel")) {
      e.preventDefault();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view);
      else findNext(view);
    }
  }

  function onReplaceKey(e: KeyboardEvent<HTMLInputElement>) {
    if (runScopeHandlers(view, e.nativeEvent, "search-panel")) {
      e.preventDefault();
    } else if (e.key === "Enter") {
      e.preventDefault();
      replaceNext(view);
    }
  }

  const label = matchLabel(view.state, query);
  const canReplace = !readOnly;
  return (
    <div className={`find-widget${canReplace ? "" : " find-widget-readonly"}`}>
      {canReplace ? (
        <button
          type="button"
          className="find-expand"
          title="Toggle Replace"
          aria-label="Toggle Replace"
          aria-expanded={replaceOpen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setReplaceOpen((open) => !open)}
        >
          {replaceOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      ) : null}
      <div className="find-rows">
        <div className="find-row">
          <div className={`find-field${query.search && !query.valid ? " invalid" : ""}`}>
            <input
              ref={searchField}
              main-field="true"
              aria-label="Find"
              placeholder="Find"
              spellCheck={false}
              defaultValue={query.search}
              onChange={(e) => updateQuery(view, { search: e.target.value }, true)}
              onKeyDown={onSearchKey}
            />
            <IconButton label="Match Case" pressed={query.caseSensitive} onClick={() => updateQuery(view, { caseSensitive: !query.caseSensitive }, true)}>
              <CaseSensitive size={16} />
            </IconButton>
            <IconButton label="Match Whole Word" pressed={query.wholeWord} onClick={() => updateQuery(view, { wholeWord: !query.wholeWord }, true)}>
              <WholeWord size={16} />
            </IconButton>
            <IconButton label="Use Regular Expression" pressed={query.regexp} onClick={() => updateQuery(view, { regexp: !query.regexp }, true)}>
              <Regex size={16} />
            </IconButton>
          </div>
          <span className={`find-count${label === "No results" ? " find-count-none" : ""}`} aria-live="polite">
            {label}
          </span>
          <IconButton label="Previous Match (Shift+Enter)" disabled={!query.search} onClick={() => findPrevious(view)}>
            <ArrowUp size={16} />
          </IconButton>
          <IconButton label="Next Match (Enter)" disabled={!query.search} onClick={() => findNext(view)}>
            <ArrowDown size={16} />
          </IconButton>
          <IconButton label="Close (Escape)" onClick={() => closeSearchPanel(view)}>
            <X size={16} />
          </IconButton>
        </div>
        {canReplace && replaceOpen ? (
          <div className="find-row">
            <div className="find-field">
              <input
                ref={replaceField}
                aria-label="Replace"
                placeholder="Replace"
                spellCheck={false}
                defaultValue={query.replace}
                onChange={(e) => updateQuery(view, { replace: e.target.value }, false)}
                onKeyDown={onReplaceKey}
              />
            </div>
            <IconButton label="Replace (Enter)" disabled={!query.search} onClick={() => replaceNext(view)}>
              <Replace size={16} />
            </IconButton>
            <IconButton label="Replace All" disabled={!query.search} onClick={() => replaceAll(view)}>
              <ReplaceAll size={16} />
            </IconButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  const root = createRoot(dom);
  const render = () => root.render(<SearchWidget view={view} />);
  return {
    dom,
    top: true,
    // openSearchPanel finds the field by its main-field attribute, and expects it focused on open.
    mount() {
      flushSync(render);
      const field = dom.querySelector<HTMLInputElement>("[main-field]");
      field?.focus();
      field?.select();
    },
    update(update: ViewUpdate) {
      const queryChanged = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)));
      if (queryChanged || update.docChanged || update.selectionSet || update.startState.readOnly !== update.state.readOnly) render();
    },
    // Closing from the widget's own button runs inside its click handler, so unmount after it returns.
    destroy() {
      queueMicrotask(() => root.unmount());
    },
  };
}
