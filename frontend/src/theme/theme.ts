import "@fontsource-variable/inter";
import * as api from "../api";
import { parseJsonc } from "../jsonc";
import { toast } from "../store";
import type { TextFile } from "../types";
import { tokenToCssVar, type ThemeTokens } from "./tokens";
import { builtinThemes, dark, light, type Theme } from "./themes";
import { convertVscodeTheme } from "./vscode";

const STORAGE_KEY = "restly.theme";
// The active imported theme, already converted, so initTheme() can apply it before api.listThemes() resolves.
const IMPORTED_CACHE_KEY = "restly.theme.imported";
const FONTS_KEY = "restly.fonts";
const IMPORTED_PREFIX = "vscode:";

const registry = new Map<string, Theme>(builtinThemes.map((t) => [t.id, t]));
let appliedId = dark.id;

// LEGACY ALIASES: styles.css (and any sibling *.css) still reference the old flat
// variable names below instead of the new tokens. This map lets applyTheme() set
// both, so the existing UI re-themes correctly while styles.css is mid-rewrite.
// Delete this map (and its use in applyTheme) once styles.css only reads --token
// names from tokens.ts directly.
export const legacyAliasMap: Record<string, keyof ThemeTokens> = {
  "--bg": "surface",
  "--bg-elevated": "surfaceRaised",
  "--bg-hover": "surfaceHover",
  "--bg-active": "surfaceActive",
  "--border": "border",
  "--text": "text",
  "--text-dim": "textSubtle",
  "--text-bright": "text",
  "--accent": "primary",
  "--error": "danger",
  "--ok": "success",
  "--method-get": "methodGet",
  "--method-post": "methodPost",
  "--method-put": "methodPut",
  "--method-patch": "methodPatch",
  "--method-delete": "methodDelete",
  "--method-other": "methodHead",
  "--font-ui": "fontUi",
  "--font-mono": "fontMono",
};

type Listener = (id: string) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener(appliedId);
}

// listThemes returns the built-ins, then imported themes by name.
export function listThemes(): Theme[] {
  const imported = [...registry.values()].filter((t) => t.file).sort((a, b) => a.name.localeCompare(b.name));
  return [...builtinThemes, ...imported];
}

// getThemeId returns the saved choice, which can name an imported theme that has not loaded yet.
export function getThemeId(): string {
  return localStorage.getItem(STORAGE_KEY) ?? dark.id;
}

export function getActiveThemeId(): string {
  return appliedId;
}

export function registerTheme(theme: Theme): void {
  registry.set(theme.id, theme);
  notify();
}

function fileName(file: string): string {
  return (file.split(/[\\/]/).pop() ?? file).replace(/\.json$/i, "");
}

// The Go side keeps the file name on import, so the name identifies the theme across restarts.
export function importedThemeId(file: string): string {
  return IMPORTED_PREFIX + fileName(file);
}

// addImportedTheme converts a VS Code color theme file and registers it. It throws when the file
// is not a color theme.
export function addImportedTheme({ file, data }: TextFile): Theme {
  const converted = convertVscodeTheme(parseJsonc(data), fileName(file), { dark: dark.tokens, light: light.tokens });
  const theme: Theme = {
    id: importedThemeId(file),
    name: converted.name,
    base: converted.base,
    tokens: converted.tokens,
    file,
    adjusted: converted.adjusted,
    warnings: converted.warnings,
  };
  registerTheme(theme);
  return theme;
}

export async function removeImportedTheme(theme: Theme): Promise<void> {
  if (!theme.file) return;
  await api.deleteTheme(theme.file);
  registry.delete(theme.id);
  if (getThemeId() === theme.id) setThemeId(theme.base === "light" ? light.id : dark.id);
  else notify();
}

export function applyTheme(id: string): void {
  const theme = registry.get(id) ?? dark;
  const tokens = { ...theme.tokens, ...fontOverrides() };
  const root = document.documentElement;

  for (const key of Object.keys(tokenToCssVar) as (keyof ThemeTokens)[]) {
    root.style.setProperty(tokenToCssVar[key], tokens[key]);
  }
  for (const [cssVar, tokenKey] of Object.entries(legacyAliasMap)) {
    root.style.setProperty(cssVar, tokens[tokenKey]);
  }

  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.base;
  appliedId = theme.id;
  if (theme.file) localStorage.setItem(IMPORTED_CACHE_KEY, JSON.stringify(theme));
  notify();
}

export function setThemeId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
  applyTheme(id);
}

export function onThemeChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function readCachedTheme(): Theme | null {
  try {
    const theme = JSON.parse(localStorage.getItem(IMPORTED_CACHE_KEY) ?? "null") as Theme | null;
    if (!theme?.id || !theme.tokens) return null;
    // Tokens added since the cache was written come from the built-in base.
    return { ...theme, tokens: { ...(theme.base === "light" ? light : dark).tokens, ...theme.tokens } };
  } catch {
    return null;
  }
}

export function initTheme(): void {
  const id = getThemeId();
  if (!registry.has(id)) {
    const cached = readCachedTheme();
    if (cached?.id === id) registry.set(id, cached);
  }
  applyTheme(id);
  loadImportedThemes().catch((err) => console.error("Failed to load imported themes:", err));
}

async function loadImportedThemes(): Promise<void> {
  const files = await api.listThemes();
  const failures: string[] = [];
  for (const [id, theme] of registry) {
    if (theme.file && !files.some((f) => f.file === theme.file)) registry.delete(id);
  }
  for (const file of files) {
    try {
      addImportedTheme(file);
    } catch (err) {
      failures.push(`${fileName(file.file)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const id = getThemeId();
  if (id.startsWith(IMPORTED_PREFIX)) {
    if (registry.has(id)) {
      applyTheme(id); // the file may have changed since the cache was written
    } else {
      const base = readCachedTheme()?.base;
      localStorage.removeItem(IMPORTED_CACHE_KEY);
      setThemeId(base === "light" ? light.id : dark.id);
    }
  }
  notify();
  if (failures.length) toast(`Skipped VS Code themes that failed to convert. ${failures.join(". ")}`, "error");
}

// --- fonts ---

// Font choices override the active theme's font tokens. Unset fields keep the theme's values.
export interface FontSettings {
  ui?: string;
  mono?: string;
  uiSize?: number;
  monoSize?: number;
}

export function getFontSettings(): FontSettings {
  try {
    const fonts = JSON.parse(localStorage.getItem(FONTS_KEY) ?? "{}") as FontSettings | null;
    return fonts && typeof fonts === "object" ? fonts : {};
  } catch {
    return {};
  }
}

export function setFontSettings(fonts: FontSettings): void {
  localStorage.setItem(FONTS_KEY, JSON.stringify(fonts));
  applyTheme(appliedId);
}

function fontOverrides(): Partial<ThemeTokens> {
  const fonts = getFontSettings();
  const out: Partial<ThemeTokens> = {};
  if (fonts.ui?.trim()) out.fontUi = fonts.ui;
  if (fonts.mono?.trim()) out.fontMono = fonts.mono;
  if (fonts.uiSize) out.fontSizeUi = `${fonts.uiSize}px`;
  if (fonts.monoSize) out.fontSizeMono = `${fonts.monoSize}px`;
  return out;
}
