import { useEffect, useReducer } from "react";
import { X } from "lucide-react";
import * as api from "../api";
import { confirmDialog } from "../dialog";
import { toast } from "../store";
import { addImportedTheme, getActiveThemeId, listThemes, onThemeChange, removeImportedTheme, setThemeId } from "./theme";
import type { Theme } from "./themes";
import "./theme.css";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function notes(theme: Theme): string[] {
  const out = [...(theme.warnings ?? [])];
  if (theme.adjusted?.length) out.push(`Adjusted for WCAG contrast: ${theme.adjusted.join(", ")}`);
  return out;
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
      <div className="theme-picker" role="radiogroup" aria-label="Theme">
        {themes.map((theme) => {
          const checked = theme.id === activeId;
          return (
            <div key={theme.id} className={`theme-picker-option${checked ? " active" : ""}`}>
              <label className="theme-picker-choice" title={notes(theme).join("\n") || undefined}>
                <input
                  type="radio"
                  name="restly-theme"
                  value={theme.id}
                  checked={checked}
                  onChange={() => setThemeId(theme.id)}
                  className="theme-picker-input"
                />
                <span
                  className="theme-picker-swatch"
                  style={{ background: theme.tokens.surface, borderColor: theme.tokens.border }}
                >
                  <span className="theme-picker-swatch-dot" style={{ background: theme.tokens.primary }} />
                  <span className="theme-picker-swatch-text" style={{ background: theme.tokens.text }} />
                </span>
                <span className="theme-picker-label">{theme.name}</span>
              </label>
              {theme.file ? (
                <button
                  className="icon theme-picker-remove"
                  title={`Remove ${theme.name}`}
                  aria-label={`Remove ${theme.name}`}
                  onClick={() => remove(theme)}
                >
                  <X />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {active && notes(active).length ? (
        <div className="hint theme-picker-notes">
          {notes(active).map((note) => (
            <div key={note}>{note}</div>
          ))}
        </div>
      ) : null}
      <div>
        <button onClick={importTheme}>Import VS Code theme…</button>
      </div>
    </div>
  );
}
