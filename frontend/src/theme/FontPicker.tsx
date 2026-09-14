import { useState } from "react";
import Select from "../components/Select";
import { getFontSettings, setFontSettings, type FontSettings } from "./theme";
import { dark } from "./themes";

const SYSTEM_UI = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const DEFAULT_UI_SIZE = parseFloat(dark.tokens.fontSizeUi);
const DEFAULT_MONO_SIZE = parseFloat(dark.tokens.fontSizeMono);

const monoFonts = [
  { label: "SF Mono / Menlo", family: '"SF Mono", Menlo, monospace', probe: ["SF Mono", "Menlo"] },
  { label: "JetBrains Mono", family: '"JetBrains Mono", monospace', probe: ["JetBrains Mono"] },
  { label: "Fira Code", family: '"Fira Code", monospace', probe: ["Fira Code"] },
];

// installed reports whether a local font exists. document.fonts.check() also answers true for any
// family it has no @font-face rule for, so a width change against the generic families confirms it.
function installed(family: string): boolean {
  if (!document.fonts.check(`16px "${family}"`)) return false;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return false;
  const sample = "mmmmmmmmmmwwwwwiiiiil1|O0@";
  return ["monospace", "serif", "sans-serif"].some((generic) => {
    ctx.font = `32px ${generic}`;
    const fallback = ctx.measureText(sample).width;
    ctx.font = `32px "${family}", ${generic}`;
    return ctx.measureText(sample).width !== fallback;
  });
}

export default function FontPicker() {
  const [fonts, setFonts] = useState<FontSettings>(getFontSettings);
  const [monoOptions] = useState(() => monoFonts.filter((f) => f.probe.some(installed)));

  function update(patch: FontSettings) {
    const next = { ...fonts, ...patch };
    setFonts(next);
    setFontSettings(next);
  }

  const uiMode = fonts.ui === undefined ? "default" : fonts.ui === SYSTEM_UI ? "system" : "custom";
  const monoMode =
    fonts.mono === undefined ? "default" : (monoOptions.find((f) => f.family === fonts.mono)?.family ?? "custom");

  function size(value: string, fallback: number): number | undefined {
    const n = parseFloat(value);
    return Number.isFinite(n) && n >= 9 && n <= 24 && n !== fallback ? n : undefined;
  }

  return (
    <div className="font-picker">
      <div className="settings-row">
        <label>UI font</label>
        <div className="settings-control-group">
          <Select
            className="font-picker-select"
            ariaLabel="UI font"
            value={uiMode}
            options={[
              { value: "default", label: "Inter (default)" },
              { value: "system", label: "System" },
              { value: "custom", label: "Custom…" },
            ]}
            onChange={(v) =>
              update({ ui: v === "default" ? undefined : v === "system" ? SYSTEM_UI : uiMode === "custom" ? fonts.ui : "" })
            }
          />
          {uiMode === "custom" ? (
            <input
              type="text"
              className="mono"
              aria-label="Custom UI font family"
              placeholder='"Helvetica Neue", sans-serif'
              value={fonts.ui ?? ""}
              onChange={(e) => update({ ui: e.target.value })}
            />
          ) : null}
          <input
            type="number"
            className="font-picker-size"
            aria-label="UI font size in pixels"
            min={9}
            max={24}
            step={0.5}
            defaultValue={fonts.uiSize ?? DEFAULT_UI_SIZE}
            onChange={(e) => update({ uiSize: size(e.target.value, DEFAULT_UI_SIZE) })}
          />
        </div>
      </div>
      <div className="settings-row">
        <label>Editor font</label>
        <div className="settings-control-group">
          <Select
            className="font-picker-select"
            ariaLabel="Editor font"
            value={monoMode}
            options={[
              { value: "default", label: "Default monospace" },
              ...monoOptions.map((f) => ({ value: f.family, label: f.label })),
              { value: "custom", label: "Custom…" },
            ]}
            onChange={(v) =>
              update({ mono: v === "default" ? undefined : v !== "custom" ? v : monoMode === "custom" ? fonts.mono : "" })
            }
          />
          {monoMode === "custom" ? (
            <input
              type="text"
              className="mono"
              aria-label="Custom editor font family"
              placeholder='"Cascadia Code", monospace'
              value={fonts.mono ?? ""}
              onChange={(e) => update({ mono: e.target.value })}
            />
          ) : null}
          <input
            type="number"
            className="font-picker-size"
            aria-label="Editor font size in pixels"
            min={9}
            max={24}
            step={0.5}
            defaultValue={fonts.monoSize ?? DEFAULT_MONO_SIZE}
            onChange={(e) => update({ monoSize: size(e.target.value, DEFAULT_MONO_SIZE) })}
          />
        </div>
      </div>
    </div>
  );
}
