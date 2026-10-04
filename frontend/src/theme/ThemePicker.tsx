import { useEffect, useReducer } from "react";
import type { CSSProperties } from "react";
import { Check, Import, Info, X } from "lucide-react";
import * as api from "../api";
import { confirmDialog } from "../dialog";
import { toast } from "../store";
import { addImportedTheme, getActiveThemeId, listThemes, onThemeChange, removeImportedTheme, setThemeId } from "./theme";
import type { Theme } from "./themes";
import { tokenToCssVar } from "./tokens";
import type { ThemeTokens } from "./tokens";
import "./theme.css";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function notes(theme: Theme): string[] {
  const out = [...(theme.warnings ?? [])];
  if (theme.adjusted?.length) out.push(`Adjusted for WCAG contrast: ${theme.adjusted.join(", ")}`);
  return out;
}

// A card's preview is drawn with the theme's own CSS variables, set on the preview element, so it
// shows the theme without applying it and without any literal color here.
function themeVars(theme: Theme): CSSProperties {
  const vars: Record<string, string> = {};
  for (const key of Object.keys(tokenToCssVar) as (keyof ThemeTokens)[]) vars[tokenToCssVar[key]] = theme.tokens[key];
  return vars;
}

export default function ThemePicker() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onThemeChange(rerender), []);

  const activeId = getActiveThemeId();
  const themes = listThemes();
  const active = themes.find((t) => t.id === activeId);

  async function importTheme() {
    let picked;
    try {
      picked = await api.importTheme();
    } catch (err) {
      toast(errorText(err), "error");
      return;
    }
    if (!picked) return;
    let theme: Theme;
    try {
      theme = addImportedTheme(picked);
    } catch (err) {
      await api.deleteTheme(picked.file).catch(() => undefined);
      toast(`Could not import ${picked.file}: ${errorText(err)}`, "error");
      return;
    }
    setThemeId(theme.id);
    toast(`Imported ${theme.name}`);
  }

  async function remove(theme: Theme) {
    const ok = await confirmDialog({
      title: "Remove theme",
      message: `Remove ${theme.name} from Restly? The original file is not touched.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeImportedTheme(theme);
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  return (
    <div className="theme-settings">
      <div className="themes" role="radiogroup" aria-label="Theme">
        {themes.map((theme) => {
          const checked = theme.id === activeId;
          return (
            <div key={theme.id} className={`tc${checked ? " on" : ""}`}>
              <label className="tc-choice" title={notes(theme).join("\n") || undefined}>
                <input
                  type="radio"
                  name="restly-theme"
                  value={theme.id}
                  checked={checked}
                  onChange={() => setThemeId(theme.id)}
                  className="theme-picker-input"
                />
                <span className="frame">
                  <span className="pv" style={themeVars(theme)} aria-hidden="true">
                    <span className="pv-side">
                      <i className="a" />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="pv-main">
                      <span className="pv-url">
                        <b />
                        <i />
                        <u />
                      </span>
                      <i style={{ width: "70%" }} />
                      <i className="b" style={{ width: "46%" }} />
                      <i className="c" style={{ width: "58%" }} />
                      <i style={{ width: "34%" }} />
                    </span>
                  </span>
                </span>
                <span className="tl">
                  {checked ? <Check size={13} aria-hidden="true" /> : null}
                  {theme.name}
                </span>
              </label>
              {theme.file ? (
                <button className="rm" title={`Remove ${theme.name}`} aria-label={`Remove ${theme.name}`} onClick={() => remove(theme)}>
                  <X size={10} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="imp">
        <button className="ghost" onClick={importTheme}>
          <Import size={13} /> Import VS Code theme…
        </button>
        {active && notes(active).length ? (
          <span className="note">
            <Info size={13} aria-hidden="true" />
            <span>{notes(active).join(" ")}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
