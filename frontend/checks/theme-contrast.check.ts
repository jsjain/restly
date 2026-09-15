// Run with: node frontend/checks/theme-contrast.check.ts [folder of VS Code themes]
// Checks every WCAG pair in contrastPairs (src/theme/vscode.ts) for each built-in theme and for each
// VS Code theme in the folder (default /tmp/restly-themes) after conversion, and that the method
// colors stay distinguishable. Exits 1 with the failures listed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseJsonc } from "../src/jsonc.ts";
import { builtinThemes, dark, light } from "../src/theme/themes.ts";
import { contrastPairs, convertVscodeTheme, methodKeys, pairLabel, pairRatio, parseColor } from "../src/theme/vscode.ts";
import type { ThemeTokens } from "../src/theme/tokens.ts";

// CIE76 distance. Around 2 is barely noticeable; 12 reads as a different color at badge size.
const MIN_METHOD_DELTA_E = 12;

assert.deepEqual(parseColor("#abc"), { r: 170, g: 187, b: 204, a: 1 });
assert.deepEqual(parseColor("#0000"), { r: 0, g: 0, b: 0, a: 0 });
assert.deepEqual(parseColor("#689d6a80"), { r: 104, g: 157, b: 106, a: 128 / 255 });
assert.equal(parseColor("#12345"), null);

function lab(color: string): number[] {
  const c = parseColor(color)!;
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [lin(c.r), lin(c.g), lin(c.b)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const failures: string[] = [];

function check(label: string, tokens: ThemeTokens): string {
  let lowest = Infinity;
  for (const pair of contrastPairs) {
    const ratio = pairRatio(tokens, pair);
    lowest = Math.min(lowest, ratio / pair.min);
    if (ratio < pair.min) failures.push(`${label}: ${pairLabel(pair)}, got ${ratio.toFixed(2)}`);
  }
  let closest = { deltaE: Infinity, pair: "" };
  for (const [i, a] of methodKeys.entries()) {
    for (const b of methodKeys.slice(i + 1)) {
      const deltaE = Math.hypot(...lab(tokens[a]).map((v, k) => v - lab(tokens[b])[k]));
      if (deltaE < MIN_METHOD_DELTA_E) failures.push(`${label}: ${a} and ${b} are too similar, deltaE ${deltaE.toFixed(1)}`);
      if (deltaE < closest.deltaE) closest = { deltaE, pair: `${a}/${b}` };
    }
  }
  return `tightest pair at ${lowest.toFixed(2)}x its minimum, closest methods ${closest.pair} deltaE ${closest.deltaE.toFixed(1)}`;
}

for (const theme of builtinThemes) {
  console.log(`built-in ${theme.name}: ${check(theme.name, theme.tokens)}`);
}

const folder = process.argv[2] ?? "/tmp/restly-themes";
const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith(".json")).sort() : [];
if (files.length === 0) console.log(`no VS Code themes found in ${folder}`);
for (const file of files) {
  try {
    const json = parseJsonc(fs.readFileSync(path.join(folder, file), "utf8"));
    const theme = convertVscodeTheme(json, file, { dark: dark.tokens, light: light.tokens });
    console.log(`imported ${file} (${theme.name}, ${theme.base}): ${check(file, theme.tokens)}`);
    console.log(`  adjusted: ${theme.adjusted.join(", ") || "none"}`);
    for (const warning of theme.warnings) console.log(`  warning: ${warning}`);
  } catch (err) {
    failures.push(`${file}: conversion failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// restly.<token> keys set tokens directly, opaque ones composited on the surface, translucent ones kept.
const custom = convertVscodeTheme(
  {
    type: "dark",
    colors: {
      "editor.background": "#202020",
      "editorGroup.border": "#101010",
      "panel.border": "#404040",
      "restly.methodGet": "#00c853",
      "restly.overlayBackdrop": "#00000080",
      "restly.scrollbarThumb": "#ffffff33",
      "restly.nope": "#ffffff",
    },
  },
  "custom",
  { dark: dark.tokens, light: light.tokens }
);
assert.equal(custom.tokens.methodGet, "#00c853");
assert.equal(custom.tokens.overlayBackdrop, "rgba(0, 0, 0, 0.502)");
assert.equal(custom.tokens.scrollbarThumb, "rgba(255, 255, 255, 0.2)");
assert.ok(custom.warnings.some((w) => w.startsWith("restly.nope")), "unknown restly key warns");
// A divider darker than a dark background reads as a gap, so the lighter panel.border wins.
assert.equal(custom.tokens.borderSubtle, "#404040");
// With no line highlight keys, VS Code's default 2px border marks the cursor line.
assert.equal(custom.tokens.lineHighlight, "rgba(0, 0, 0, 0)");
assert.equal(custom.tokens.lineHighlightBorder, "#282828");
// A theme that sets only a fill gets no default border, as in VS Code.
const filled = convertVscodeTheme(
  { type: "dark", colors: { "editor.background": "#202020", "editor.lineHighlightBackground": "#ffffff10" } },
  "filled",
  { dark: dark.tokens, light: light.tokens }
);
assert.equal(filled.tokens.lineHighlight, "rgba(255, 255, 255, 0.063)");
assert.equal(filled.tokens.lineHighlightBorder, "rgba(0, 0, 0, 0)");
// Dark Modern's own divider, #2b2b2b on #1f1f1f, is lifted until grid lines show.
const faint = convertVscodeTheme(
  { type: "dark", colors: { "editor.background": "#1f1f1f", "panel.border": "#2b2b2b" } },
  "faint",
  { dark: dark.tokens, light: light.tokens }
);
assert.ok(faint.adjusted.includes("borderSubtle"), "faint divider is adjusted");
const dividerPair = contrastPairs.find((p) => p.fg === "borderSubtle" && p.bg[0] === "surface")!;
assert.ok(pairRatio(faint.tokens, dividerPair) >= 1.4, `faint divider lifted to ${faint.tokens.borderSubtle}`);

if (failures.length) {
  console.error(`\n${failures.length} theme check failures:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`\ntheme contrast ok: ${builtinThemes.length + files.length} themes, ${contrastPairs.length} pairs each`);
