// Converts a VS Code color theme into Restly tokens, and holds the WCAG contrast table that both the
// conversion guard and frontend/checks/theme-contrast.check.ts use. Only `import type` statements
// here: the check runs this file directly under node, which cannot resolve extensionless imports.
import type { ThemeTokens } from "./tokens";

type Key = keyof ThemeTokens;
type Rgba = { r: number; g: number; b: number; a: number };
export type Base = "dark" | "light";

// --- colors ---

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
// {{variable}} highlight background: the variable color at this alpha.
const VAR_BG_ALPHA = 0.16;
const MIN_VAR_BG_ALPHA = 0.08;
// textSubtlest's contrast on the surface is at most textSubtle's divided by this.
const SUBTLEST_STEP = 1.25;
// Tokens that are not colors, so no "restly.<token>" key sets them.
const NON_COLOR_KEYS = new Set<string>(["fontUi", "fontMono", "fontSizeUi", "fontSizeMono", "radius", "radiusSmall"]);
// Tokens drawn as translucent layers, which keep their alpha instead of being composited on the surface.
const TRANSLUCENT_KEYS = new Set<string>(["varDefinedBg", "varUndefinedBg", "overlayBackdrop", "scrollbarThumb", "scrollbarThumbHover"]);

// parseColor reads #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb() and rgba().
export function parseColor(value: string): Rgba | null {
  const s = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3], a: fn[4] === undefined ? 1 : +fn[4] };
  return null;
}

function toHex(c: Rgba): string {
  return "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

function toCss(c: Rgba, alpha = c.a): string {
  if (alpha >= 1) return toHex(c);
  return `rgba(${[c.r, c.g, c.b].map(Math.round).join(", ")}, ${+alpha.toFixed(3)})`;
}

// over composites top onto an opaque bottom.
function over(top: Rgba, bottom: Rgba): Rgba {
  const t = top.a;
  return { r: top.r * t + bottom.r * (1 - t), g: top.g * t + bottom.g * (1 - t), b: top.b * t + bottom.b * (1 - t), a: 1 };
}

// mix moves a toward b by t in sRGB.
function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
}

function luminance(c: Rgba): number {
  const ch = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// dimmer moves c toward bg until its contrast on bg is 1/step of what it was.
function dimmer(c: Rgba, bg: Rgba, step: number): Rgba {
  const target = contrast(c, bg) / step;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(c, bg, mid), bg) > target) lo = mid;
    else hi = mid;
  }
  return mix(c, bg, lo);
}

// --- contrast table ---

// A layer is a token painted at full strength, or [token, alpha] for a color-mix tint.
type Layer = Key | [Key, number];

export interface ContrastPair {
  fg: Key;
  // Painted bottom to top. The first layer is opaque.
  bg: Layer[];
  min: number;
  // The token the guard changes when the pair fails. Defaults to fg.
  adjust?: Key;
}

const surfaces: Key[] = ["surface", "surfaceRaised", "surfaceOverlay", "surfaceHover", "surfaceActive", "surfaceInput"];
const fields: Key[] = ["surface", "surfaceRaised", "surfaceOverlay", "surfaceInput"];
const syntax: Key[] = ["syntaxString", "syntaxNumber", "syntaxKeyword", "syntaxProperty", "syntaxComment", "syntaxPunctuation", "syntaxBoolean"];
export const methodKeys: Key[] = ["methodGet", "methodPost", "methodPut", "methodPatch", "methodDelete", "methodHead", "methodOptions", "methodWs"];

const on = (fgs: Key[], stacks: Layer[][], min: number, adjust?: Key): ContrastPair[] =>
  fgs.flatMap((fg) => stacks.map((bg) => ({ fg, bg, min, adjust })));
const each = (keys: Key[]): Layer[][] => keys.map((k) => [k]);

export const contrastPairs: ContrastPair[] = [
  ...on(["text", "textSubtle"], each(surfaces), 4.5),
  // textSubtlest is header and hint text on panels and menus, and the placeholder in inputs and hovered rows.
  ...on(["textSubtlest"], each(["surface", "surfaceRaised", "surfaceOverlay"]), 4.5),
  ...on(["textSubtlest"], each(["surfaceInput", "surfaceHover", "surfaceActive"]), 3),
  ...on(syntax, each(["surface"]), 4.5),
  // Inputs and dropdowns are recognized by their fill, placeholder and position, as in VS Code and Postman,
  // so their outline only has to be visible. 3:1 outlines read as heavy boxes. Checkboxes use textSubtlest
  // and the focus ring keeps 3:1. border and borderSubtle are layout dividers with no minimum.
  ...on(["borderControl"], each(["surface", "surfaceRaised", "surfaceOverlay"]), 1.4),
  ...on(["borderFocus"], each([...fields, "surfaceHover", "surfaceActive"]), 3),
  ...on(["primary", "info", "success", "notice", "warning", "danger"], each(["surface", "surfaceRaised", "surfaceOverlay"]), 4.5),
  // Filled buttons keep the theme's button text. The guard changes the fill instead.
  ...on(["primaryButtonText"], each(["primaryButton"]), 4.5, "primaryButton"),
  ...on(["primaryButtonText"], each(["primaryButtonHover"]), 4.5, "primaryButtonHover"),
  // Palette match text (overlays.css mark) on hovered and active rows, which also covers the Select
  // check and the tree row's edge and dot.
  ...on(["primary"], each(["surfaceHover", "surfaceActive"]), 4.5),
  // Status badges tint their background with color-mix(in srgb, var(--x) 16%, transparent).
  ...(["success", "notice", "danger"] as Key[]).flatMap((k) => on([k], [["surface", [k, 0.16]]], 4.5)),
  // Method badges sit on the sidebar, rows, menus, and the URL bar.
  ...on(methodKeys, each(surfaces), 4.5),
  ...on(["varDefined"], [["surface", "varDefinedBg"], ["surfaceInput", "varDefinedBg"]], 4.5),
  ...on(["varUndefined"], [["surface", "varUndefinedBg"], ["surfaceInput", "varUndefinedBg"]], 4.5),
  // Selection: inputs and VarInput select on surfaceInput, CodeMirror on surface. WCAG sets no ratio
  // for a selection highlight, so it only has to be visibly different from the field.
  ...on(["selection"], each(["surfaceInput", "surface"]), 1.4),
  // Selected text. VarInput's mirror paints text and {{var}} tokens over the native selection.
  // ::selection (styles.css) and CodeMirror paint all other selected text in --text, so textSubtle
  // and syntax colors never sit on the selection.
  ...on(["text"], [["surfaceInput", "selection"], ["surface", "selection"]], 4.5),
  // A selected {{variable}} is a transient state, held to 3:1.
  ...on(["text"], [["surface", "selection", "varDefinedBg"], ["surface", "selection", "varUndefinedBg"]], 3),
  ...on(["varDefined"], [["surfaceInput", "selection", "varDefinedBg"], ["surface", "selection", "varDefinedBg"]], 3),
  ...on(["varUndefined"], [["surfaceInput", "selection", "varUndefinedBg"], ["surface", "selection", "varUndefinedBg"]], 3),
];

function tokenColor(tokens: ThemeTokens, key: Key): Rgba {
  const c = parseColor(tokens[key]);
  if (!c) throw new Error(`${key}: "${tokens[key]}" is not a color`);
  return c;
}

function backdrop(tokens: ThemeTokens, layers: Layer[]): Rgba {
  let acc = BLACK;
  for (const layer of layers) {
    const [key, alpha] = typeof layer === "string" ? [layer, 1] : layer;
    const c = tokenColor(tokens, key);
    acc = over({ ...c, a: c.a * alpha }, acc);
  }
  return acc;
}

export function pairRatio(tokens: ThemeTokens, pair: ContrastPair): number {
  const bg = backdrop(tokens, pair.bg);
  return contrast(over(tokenColor(tokens, pair.fg), bg), bg);
}

export function pairLabel(pair: ContrastPair): string {
  const layers = pair.bg.map((l) => (typeof l === "string" ? l : `${l[0]}@${l[1] * 100}%`));
  return `${pair.fg} on ${layers.join(" + ")} >= ${pair.min}`;
}

// --- guard ---

// guardContrast changes failing tokens in place, each by the smallest move toward readable, and
// returns the keys it changed. Adjustable tokens must be opaque.
export function guardContrast(tokens: ThemeTokens, base: Base): Key[] {
  const start = { ...tokens };
  const paper = base === "light" ? WHITE : BLACK;
  const groups = new Map<Key, ContrastPair[]>();
  for (const pair of contrastPairs) {
    const key = pair.adjust ?? pair.fg;
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }
  const foregrounds = [...groups.keys()].filter((k) => k !== "selection");
  const own = groups.get("selection")!;
  const selectedText = contrastPairs.filter((p) => p.bg.includes("selection"));
  const ok = (pairs: ContrastPair[]) => pairs.every((p) => pairRatio(tokens, p) >= p.min);
  const worst = (pairs: ContrastPair[]) => Math.min(...pairs.map((p) => pairRatio(tokens, p)));

  // varDefinedBg keeps the theme's own hue: tinting with a lightened variable color would lift the
  // backdrop along with the text and never converge.
  const set = (key: Key, c: Rgba) => {
    tokens[key] = toHex(c);
  };
  // fit moves key from the theme's own color toward white or black, whichever reads better, just far
  // enough that its pairs pass.
  const fit = (key: Key) => {
    const pairs = groups.get(key)!;
    const from = tokenColor(start, key);
    set(key, from);
    if (ok(pairs)) return;
    set(key, WHITE);
    const whiteWorst = worst(pairs);
    set(key, BLACK);
    const toward = whiteWorst >= worst(pairs) ? WHITE : BLACK;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      set(key, mix(from, toward, mid));
      if (ok(pairs)) hi = mid;
      else lo = mid;
    }
    set(key, mix(from, toward, hi));
  };
  // tightSelection keeps selection at its minimum from its fields but no further, leaving the most room for selected text.
  const tightSelection = () => {
    const from = tokenColor(start, "selection");
    set("selection", from);
    if (!ok(own)) return fit("selection");
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      set("selection", mix(from, paper, mid));
      if (ok(own)) lo = mid;
      else hi = mid;
    }
    set("selection", mix(from, paper, lo));
  };

  for (let round = 0; round < 24; round++) {
    fit("selection");
    for (const key of foregrounds) fit(key);
    if (!ok(selectedText)) {
      tightSelection();
      for (const key of foregrounds) fit(key);
    }
    if (ok(contrastPairs) || ok(selectedText)) break;
    // Even the extreme text color cannot sit on the selection. A {{var}} tint over the selection
    // lifts the backdrop, so the tint fades first (to a floor that stays visible). After that, the
    // field farthest from paper, which sets how far the selection must go, steps toward paper.
    const tints = (["varDefinedBg", "varUndefinedBg"] as Key[]).filter((bg) =>
      selectedText.some((p) => p.bg.includes(bg) && pairRatio(tokens, p) < p.min)
    );
    const fading = tints.filter((bg) => tokenColor(tokens, bg).a > MIN_VAR_BG_ALPHA);
    if (fading.length) {
      for (const bg of fading) {
        const c = tokenColor(tokens, bg);
        tokens[bg] = toCss(c, Math.max(MIN_VAR_BG_ALPHA, c.a - 0.02));
      }
      continue;
    }
    const field = (["surfaceInput", "surface"] as Key[]).reduce((a, b) =>
      contrast(tokenColor(tokens, a), paper) >= contrast(tokenColor(tokens, b), paper) ? a : b
    );
    tokens[field] = toHex(mix(tokenColor(tokens, field), paper, 0.1));
  }
  return (Object.keys(tokens) as Key[]).filter((k) => tokens[k] !== start[k]);
}

// --- VS Code conversion ---

export interface ConvertedTheme {
  name: string;
  base: Base;
  tokens: ThemeTokens;
  // Tokens the contrast guard changed from the theme's own colors.
  adjusted: Key[];
  warnings: string[];
}

// Absolute colors from each type's default theme (Dark Modern and Light Modern, plus VS Code's
// registry defaults for keys those files leave unset). Surface-relative colors such as hover
// and borders are blended from the theme's own background and foreground instead.
const defaults: Record<Base, Record<string, string>> = {
  dark: {
    "editor.background": "#1F1F1F",
    "editor.foreground": "#CCCCCC",
    focusBorder: "#0078D4",
    "button.background": "#0078D4",
    "button.foreground": "#FFFFFF",
    "textLink.foreground": "#4daafc",
    errorForeground: "#F85149",
    "editorWarning.foreground": "#CCA700",
    "editorInfo.foreground": "#3794FF",
    "editor.selectionBackground": "#264F78",
    "widget.shadow": "#0000005C",
    "terminal.ansiGreen": "#0DBC79",
    "terminal.ansiYellow": "#E5E510",
    "terminal.ansiBlue": "#2472C8",
    "terminal.ansiMagenta": "#BC3FBC",
    "terminal.ansiRed": "#CD3131",
    "terminal.ansiCyan": "#11A8CD",
    "scrollbarSlider.background": "#79797966",
    "scrollbarSlider.hoverBackground": "#646464B3",
  },
  light: {
    "editor.background": "#FFFFFF",
    "editor.foreground": "#3B3B3B",
    focusBorder: "#005FB8",
    "button.background": "#005FB8",
    "button.foreground": "#FFFFFF",
    "textLink.foreground": "#005FB8",
    errorForeground: "#F85149",
    "editorWarning.foreground": "#BF8803",
    "editorInfo.foreground": "#1a85ff",
    "editor.selectionBackground": "#ADD6FF",
    "widget.shadow": "#00000029",
    "terminal.ansiGreen": "#00BC00",
    "terminal.ansiYellow": "#949800",
    "terminal.ansiBlue": "#0451A5",
    "terminal.ansiMagenta": "#BC05BC",
    "terminal.ansiRed": "#CD3131",
    "terminal.ansiCyan": "#0598BC",
    "scrollbarSlider.background": "#64646466",
    "scrollbarSlider.hoverBackground": "#646464B3",
  },
};

// Representative TextMate scopes for what Restly highlights (JSON bodies, mostly).
const syntaxScopes: [Key, string[]][] = [
  ["syntaxString", ["string.quoted.double.json"]],
  ["syntaxNumber", ["constant.numeric.json"]],
  ["syntaxKeyword", ["keyword", "storage.type"]],
  ["syntaxProperty", ["support.type.property-name.json", "meta.object-literal.key", "variable.other.property"]],
  ["syntaxComment", ["comment.line.double-slash"]],
  ["syntaxPunctuation", ["punctuation.separator.dictionary.key-value.json"]],
  ["syntaxBoolean", ["constant.language.boolean.json"]],
];

type TokenRule = { scope?: unknown; settings?: { foreground?: unknown } };

// scopeColor picks, for the first target any rule matches, the rule whose selector matches the
// most scope segments; a later rule wins a tie, as in VS Code. Selectors with parent scopes
// ("source.json string") and exclusions are skipped, since Restly has no scope stack to test.
function scopeColor(rules: TokenRule[], targets: string[]): string | undefined {
  for (const target of targets) {
    let best: { depth: number; color: string } | undefined;
    for (const rule of rules) {
      const color = rule.settings?.foreground;
      if (typeof color !== "string") continue;
      const scopes = Array.isArray(rule.scope) ? rule.scope : typeof rule.scope === "string" ? [rule.scope] : [];
      for (const selector of scopes.flatMap((s) => (typeof s === "string" ? s.split(",") : [])).map((s) => s.trim())) {
        if (!selector || /\s/.test(selector)) continue;
        if (target !== selector && !target.startsWith(selector + ".")) continue;
        const depth = selector.split(".").length;
        if (!best || depth >= best.depth) best = { depth, color };
      }
    }
    if (best) return best.color;
  }
  return undefined;
}

export function convertVscodeTheme(json: unknown, fallbackName: string, bases: Record<Base, ThemeTokens>): ConvertedTheme {
  if (!isRecord(json)) throw new Error("not a VS Code color theme: the file is not a JSON object");
  const warnings: string[] = [];
  if (json.include !== undefined) {
    warnings.push(`"include": ${JSON.stringify(json.include)} is not supported, so colors from that file are missing`);
  }
  if (typeof json.tokenColors === "string") {
    warnings.push(`"tokenColors": ${JSON.stringify(json.tokenColors)} points to another file, so syntax colors use the defaults`);
  }
  const colors = isRecord(json.colors) ? json.colors : {};
  const rules = (Array.isArray(json.tokenColors) ? json.tokenColors : []).filter(isRecord) as TokenRule[];
  if (Object.keys(colors).length === 0 && rules.length === 0) {
    throw new Error("not a VS Code color theme: it has no \"colors\" or \"tokenColors\"");
  }

  const read = (key: string): Rgba | undefined => {
    const value = colors[key];
    if (value === undefined) return undefined;
    const c = typeof value === "string" ? parseColor(value) : null;
    if (!c) warnings.push(`${key}: ${JSON.stringify(value)} is not a color, so it was ignored`);
    return c ?? undefined;
  };
  const pick = (...keys: string[]) => keys.reduce<Rgba | undefined>((found, key) => found ?? read(key), undefined);

  const background = read("editor.background");
  const type = json.type;
  const base: Base =
    type === "light" || type === "hc-light"
      ? "light"
      : type === "dark" || type === "hc-black"
        ? "dark"
        : background && luminance(background) > 0.4
          ? "light"
          : "dark";
  const d = (key: string) => parseColor(defaults[base][key])!;

  const surface = over(pick("editor.background", "tab.activeBackground") ?? d("editor.background"), d("editor.background"));
  const onSurface = (c: Rgba | undefined, fallback: Rgba) => over(c ?? fallback, surface);
  const text = onSurface(pick("editor.foreground", "foreground", "input.foreground"), d("editor.foreground"));
  const blend = (t: number) => mix(surface, text, t);

  const surfaceRaised = onSurface(pick("sideBar.background", "editorGroupHeader.tabsBackground", "tab.inactiveBackground", "sideBarSectionHeader.background"), surface);
  const surfaceInput = onSurface(pick("input.background", "dropdown.background"), surface);
  // --primary is link text and accents, so the link color comes first. Filled buttons have their
  // own tokens from button.background, which only fills in for a missing link color here.
  const buttonBackground = pick("button.background");
  const button = onSurface(buttonBackground, d("button.background"));
  const primary = onSurface(
    pick("textLink.foreground") ?? buttonBackground ?? pick("tab.activeBorderTop", "tab.activeBorder"),
    d("button.background")
  );
  const selection = onSurface(pick("editor.selectionBackground"), d("editor.selectionBackground"));
  const success = onSurface(pick("terminal.ansiGreen"), d("terminal.ansiGreen"));
  const danger = onSurface(pick("errorForeground", "editorError.foreground"), d("errorForeground"));
  const red = onSurface(pick("terminal.ansiRed"), d("terminal.ansiRed"));
  const yellow = onSurface(pick("terminal.ansiYellow"), d("terminal.ansiYellow"));
  const textSubtle = onSurface(pick("descriptionForeground"), blend(0.75));
  // textSubtlest is the placeholder color when that is visibly dimmer than textSubtle. Many themes
  // set the two almost equal, so otherwise it is textSubtle dimmed one step toward the surface.
  const placeholder = onSurface(pick("input.placeholderForeground", "disabledForeground"), blend(0.6));
  const textSubtlest =
    contrast(textSubtle, surface) / contrast(placeholder, surface) >= SUBTLEST_STEP ? placeholder : dimmer(textSubtle, surface, SUBTLEST_STEP);
  const widgetBorder = pick("contrastBorder", "input.border", "dropdown.border");
  const checkboxBorder = pick("checkbox.border");
  // A line drawn away from the text color (darker on a dark theme) reads as a gap between panels, not a
  // divider. One Dark Pro sets editorGroup.border and tab.border to #181a1f on a #282c34 editor, and its
  // lighter panel.border #3e4452 is the line VS Code shows, so borders skip colors on the wrong side.
  const lineUp = (c: Rgba) => (luminance(over(c, surface)) - luminance(surface)) * (luminance(text) - luminance(surface)) > 0;
  const dividerBorder = ["sideBar.border", "editorGroup.border", "panel.border", "tab.border", "editorGroupHeader.tabsBorder"]
    .map((key) => read(key))
    .find((c): c is Rgba => c !== undefined && lineUp(c));
  // border is the widget or divider color, whichever stands out more from the surface.
  const border = [widgetBorder, dividerBorder]
    .filter((c): c is Rgba => c !== undefined && lineUp(c))
    .map((c) => over(c, surface))
    .reduce<Rgba | undefined>((best, c) => (!best || contrast(c, surface) > contrast(best, surface) ? c : best), undefined);
  const shadow = pick("widget.shadow") ?? d("widget.shadow");

  const tokens: ThemeTokens = {
    ...bases[base],
    surface: toHex(surface),
    surfaceRaised: toHex(surfaceRaised),
    surfaceOverlay: toHex(onSurface(pick("editorWidget.background", "dropdown.background"), surfaceRaised)),
    surfaceHover: toHex(onSurface(pick("list.hoverBackground"), blend(0.08))),
    surfaceActive: toHex(onSurface(pick("list.inactiveSelectionBackground", "list.activeSelectionBackground"), blend(0.14))),
    surfaceInput: toHex(surfaceInput),

    text: toHex(text),
    textSubtle: toHex(textSubtle),
    textSubtlest: toHex(textSubtlest),

    // border and borderSubtle stay the theme's own colors. borderControl starts from the widget
    // border and is the one the guard lifts until visible.
    border: toHex(border ?? blend(0.3)),
    borderSubtle: toHex(onSurface(dividerBorder, blend(0.12))),
    borderControl: toHex(onSurface(widgetBorder ?? checkboxBorder, blend(0.3))),
    borderFocus: toHex(onSurface(pick("focusBorder"), d("focusBorder"))),

    primary: toHex(primary),
    primaryButton: toHex(button),
    primaryButtonHover: toHex(onSurface(pick("button.hoverBackground"), mix(button, text, 0.15))),
    primaryButtonText: toHex(over(pick("button.foreground") ?? d("button.foreground"), button)),
    info: toHex(onSurface(pick("editorInfo.foreground", "textLink.foreground"), d("editorInfo.foreground"))),
    success: toHex(success),
    notice: toHex(yellow),
    warning: toHex(onSurface(pick("editorWarning.foreground"), d("editorWarning.foreground"))),
    danger: toHex(danger),

    methodGet: toHex(success),
    methodPost: toHex(yellow),
    methodPut: toHex(onSurface(pick("terminal.ansiBlue"), d("terminal.ansiBlue"))),
    methodPatch: toHex(onSurface(pick("terminal.ansiMagenta"), d("terminal.ansiMagenta"))),
    methodDelete: toHex(red),
    methodHead: toHex(textSubtle),
    methodOptions: toHex(mix(red, yellow, 0.5)),
    methodWs: toHex(onSurface(pick("terminal.ansiCyan"), d("terminal.ansiCyan"))),

    varDefined: toHex(success),
    varDefinedBg: toCss(success, VAR_BG_ALPHA),
    varUndefined: toHex(danger),
    varUndefinedBg: toCss(danger, VAR_BG_ALPHA),

    selection: toHex(selection),

    shadowOverlay: `0 8px 24px ${toCss(shadow)}`,
    scrollbarThumb: toCss(pick("scrollbarSlider.background") ?? d("scrollbarSlider.background")),
    scrollbarThumbHover: toCss(pick("scrollbarSlider.hoverBackground") ?? d("scrollbarSlider.hoverBackground")),
  } as ThemeTokens;

  const globalRule = rules.find((r) => r.scope === undefined && typeof r.settings?.foreground === "string");
  const fallback = typeof globalRule?.settings?.foreground === "string" ? globalRule.settings.foreground : undefined;
  for (const [key, targets] of syntaxScopes) {
    const value = scopeColor(rules, targets) ?? fallback;
    const c = value ? parseColor(value) : null;
    tokens[key] = toHex(over(c ?? text, surface));
  }

  // "restly.<token>" sets a token directly, for colors VS Code has no key for. surface goes first
  // because the opaque tokens are composited on it. The contrast guard below still applies.
  const colorKeys = Object.keys(tokens).filter((key) => !NON_COLOR_KEYS.has(key)) as Key[];
  for (const key of ["surface" as Key, ...colorKeys.filter((key) => key !== "surface")]) {
    const c = read(`restly.${key}`);
    if (!c) continue;
    if (key === "shadowOverlay") tokens.shadowOverlay = `0 8px 24px ${toCss(c)}`;
    else if (TRANSLUCENT_KEYS.has(key)) tokens[key] = toCss(c);
    else tokens[key] = toHex(over(c, parseColor(tokens.surface)!));
  }
  for (const key of Object.keys(colors)) {
    if (key.startsWith("restly.") && !colorKeys.includes(key.slice("restly.".length) as Key)) {
      warnings.push(`${key} is not a Restly color token, so it was ignored`);
    }
  }

  const adjusted = guardContrast(tokens, base);
  const name = typeof json.name === "string" && json.name.trim() ? json.name.trim() : fallbackName;
  return { name, base, tokens, adjusted, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
