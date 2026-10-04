import type { ThemeTokens } from "./tokens";

export interface Theme {
  id: string;
  name: string;
  base: "dark" | "light";
  tokens: ThemeTokens;
  // Imported VS Code themes only: the file in the themes folder, the tokens the contrast guard
  // changed, and conversion warnings.
  file?: string;
  adjusted?: string[];
  warnings?: string[];
}

export const fontUi = '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const fontMono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const layout = {
  fontUi,
  fontMono,
  fontSizeUi: "13px",
  fontSizeMono: "12.5px",
  radiusXs: "3px",
  radiusSmall: "5px",
  radius: "7px",
  radiusLarge: "10px",
};

// Dark and Light take their chrome (surfaces, text, accents, status and method colors, tints,
// shadow) from the approved redesign in docs/design/mockups/tokens.css, marked "Restly redesign" where
// it matters. Their editor values (selection, scrollbars, line highlight, syntax) and the border
// strengths stay VS Code's Dark Modern and Light Modern, which the guard in vscode.ts checks like any
// imported theme.

// Dark editor values follow VS Code Dark Modern: extensions/theme-defaults/themes/dark_modern.json,
// which includes dark_plus.json and dark_vs.json. Restly's surface is #262626 instead of #1f1f1f, so
// input.border, dropdown.border and checkbox.border #434343 and editor.lineHighlightBorder #2f2f2f
// are Dark Modern's colors lifted to match.
const darkTokens: ThemeTokens = {
  ...layout,
  surface: "#262626",
  surfaceRaised: "#1e1e1e", // Restly redesign
  surfaceOverlay: "#2b2b2b",
  surfaceHover: "#2f2f2f",
  surfaceActive: "#383838",
  surfaceInput: "#2c2c2c",

  text: "#e3e3e3",
  textSubtle: "#a6a6a6",
  textSubtlest: "#929292", // Restly redesign #8d8d8d, lifted to 4.5:1 on surfaceOverlay

  border: "#434343", // Restly redesign #3d3d3d, kept so table grids stay visible
  borderSubtle: "#3e3e3e", // Restly redesign #333333, kept for the same reason
  borderControl: "#434343",
  borderFocus: "#4d8ef7",

  primary: "#6aa3ff",
  primaryButton: "#2d6fdb",
  primaryButtonHover: "#2862c4",
  primaryButtonText: "#ffffff",
  primaryTint: "rgba(77, 142, 247, 0.14)",
  info: "#6aa3ff",
  success: "#4cc38a",
  successTint: "rgba(76, 195, 138, 0.13)",
  notice: "#e0b25c",
  warning: "#e0b25c",
  warningTint: "rgba(224, 178, 92, 0.13)",
  danger: "#f18181", // Restly redesign #f07a7a
  dangerTint: "rgba(240, 122, 122, 0.13)",

  // Muted set: similar lightness, saturation held low, POST amber instead of yellow
  methodGet: "#5fbf8f",
  methodPost: "#e0b25c",
  methodPut: "#6ba4e8", // Restly redesign #6aa3e8
  methodPatch: "#b99be8",
  methodDelete: "#e98484", // Restly redesign #e88080
  methodHead: "#9ca1a7", // Restly redesign #9aa0a6
  methodOptions: "#d99a6c",
  methodWs: "#5cc0d0",

  varDefined: "#5fbf8f",
  varDefinedBg: "rgba(95, 191, 143, 0.14)",
  varUndefined: "#f18787", // Restly redesign #f07a7a
  varUndefinedBg: "rgba(240, 122, 122, 0.14)",

  selection: "#275079", // editor.selectionBackground #264f78
  scrollbarThumb: "rgba(121, 121, 121, 0.4)", // scrollbarSlider.background #79797966
  scrollbarThumbHover: "rgba(100, 100, 100, 0.7)",
  lineHighlight: "rgba(0, 0, 0, 0)", // VS Code has no default editor.lineHighlightBackground
  lineHighlightBorder: "#2f2f2f",

  syntaxString: "#ce9178",
  syntaxNumber: "#b5cea8",
  syntaxKeyword: "#569cd6",
  syntaxProperty: "#9cdcfe",
  syntaxComment: "#6a9955",
  syntaxPunctuation: "#cccccc",
  syntaxBoolean: "#569cd6",

  shadowOverlay: "0 0 0 1px rgba(0, 0, 0, 0.35), 0 12px 32px rgba(0, 0, 0, 0.45)", // Restly redesign
  overlayBackdrop: "rgba(0, 0, 0, 0.42)",
};

// Light editor values follow VS Code Light Modern: light_modern.json, which includes light_plus.json
// and light_vs.json.
const lightTokens: ThemeTokens = {
  ...layout,
  surface: "#ffffff",
  surfaceRaised: "#f6f6f7", // Restly redesign
  surfaceOverlay: "#ffffff",
  surfaceHover: "#efeff1",
  surfaceActive: "#e6e6e9",
  surfaceInput: "#ffffff",

  text: "#1d1d1f",
  textSubtle: "#5a5a60",
  textSubtlest: "#6e6e74",

  border: "#d1d1d5", // Restly redesign #d6d6da, 1.4:1 on surfaceRaised
  borderSubtle: "#d1d1d5", // Restly redesign #e4e4e7, too faint: #d9d9dd is 1.30:1 on surfaceRaised
  borderControl: "#d1d1d5", // Restly redesign #d6d6da, 1.4:1 on surfaceRaised
  borderFocus: "#1f63d1",

  primary: "#1f62d0", // Restly redesign #1f63d1
  primaryButton: "#1f63d1",
  primaryButtonHover: "#1b57b8",
  primaryButtonText: "#ffffff",
  primaryTint: "rgba(31, 99, 209, 0.1)",
  info: "#1f63d1",
  success: "#157647", // Restly redesign #17804d
  successTint: "rgba(23, 128, 77, 0.1)",
  notice: "#8d5d00", // Restly redesign #8f5f00
  warning: "#8f5f00",
  warningTint: "rgba(143, 95, 0, 0.1)",
  danger: "#b73838", // Restly redesign #c23b3b
  dangerTint: "rgba(194, 59, 59, 0.09)",

  methodGet: "#157647", // Restly redesign #17804d
  methodPost: "#8d5e00", // Restly redesign #8f5f00
  methodPut: "#1f5fbf",
  methodPatch: "#7447bd",
  methodDelete: "#ba3939", // Restly redesign #c23b3b
  methodHead: "#5a5a60",
  methodOptions: "#a24f17",
  methodWs: "#0f7183", // Restly redesign #0f7385

  varDefined: "#177d4b", // Restly redesign #17804d
  varDefinedBg: "rgba(23, 128, 77, 0.1)",
  varUndefined: "#c23b3b",
  varUndefinedBg: "rgba(194, 59, 59, 0.09)",

  selection: "#add6ff",
  scrollbarThumb: "rgba(100, 100, 100, 0.4)", // scrollbarSlider.background #64646466
  scrollbarThumbHover: "rgba(100, 100, 100, 0.7)",
  lineHighlight: "rgba(0, 0, 0, 0)",
  lineHighlightBorder: "#eeeeee", // VS Code default editor.lineHighlightBorder

  syntaxString: "#a31515",
  syntaxNumber: "#098658",
  syntaxKeyword: "#0000ff",
  syntaxProperty: "#0451a5",
  syntaxComment: "#008000",
  syntaxPunctuation: "#3b3b3b",
  syntaxBoolean: "#0000ff",

  shadowOverlay: "0 0 0 1px rgba(0, 0, 0, 0.08), 0 12px 32px rgba(0, 0, 0, 0.14)", // Restly redesign
  overlayBackdrop: "rgba(0, 0, 0, 0.18)",
};

// One Dark Pro (github.com/Binaryify/OneDark-Pro, themes/OneDark-Pro.json).
const oneDarkTokens: ThemeTokens = {
  ...layout,
  surface: "#282c34",
  surfaceRaised: "#21252b",
  surfaceOverlay: "#21252b",
  surfaceHover: "#2c313a",
  surfaceActive: "#323842",
  surfaceInput: "#1d1f23",

  text: "#b0b6c2", // editor.foreground #abb2bf
  textSubtle: "#abb2bf",
  textSubtlest: "#8e939c", // textSubtle one step dimmer #777c87

  border: "#3e4452", // panel.border
  borderSubtle: "#3e4452",
  borderControl: "#3f4348", // dropdown.border #21252b
  borderFocus: "#7c818a", // focusBorder #3e4452

  primary: "#61afef",
  primaryButton: "#404754",
  primaryButtonHover: "#505764",
  primaryButtonText: "#ffffff",
  info: "#61afef",
  success: "#8cc265",
  notice: "#d79f6a", // terminal.ansiYellow #d18f52
  warning: "#d29b68", // #d19a66
  danger: "#de9994", // editorError.foreground #c24038
  primaryTint: "rgba(97, 175, 239, 0.14)",
  successTint: "rgba(140, 194, 101, 0.14)",
  warningTint: "rgba(209, 154, 102, 0.14)",
  dangerTint: "rgba(222, 153, 148, 0.14)",

  // Restly redesign method set, shared with Dark
  methodGet: "#5fbf8f",
  methodPost: "#e0b25c",
  methodPut: "#6aa3e8",
  methodPatch: "#b99be8",
  methodDelete: "#e98383", // Restly redesign #e88080
  methodHead: "#9ba1a6", // Restly redesign #9aa0a6
  methodOptions: "#d99a6c",
  methodWs: "#5cc0d0",

  varDefined: "#8cc265",
  varDefinedBg: "rgba(140, 194, 101, 0.16)",
  varUndefined: "#d8857f", // editorError.foreground #c24038
  varUndefinedBg: "rgba(194, 64, 56, 0.16)",

  selection: "#404859", // editor.selectionBackground #67769660
  scrollbarThumb: "rgba(78, 86, 102, 0.376)", // scrollbarSlider.background #4e566660
  scrollbarThumbHover: "rgba(90, 99, 117, 0.502)",
  lineHighlight: "#2c313c", // editor.lineHighlightBackground
  lineHighlightBorder: "rgba(0, 0, 0, 0)", // VS Code drops the default border when a theme sets a fill

  syntaxString: "#98c379",
  syntaxNumber: "#d19a66",
  syntaxKeyword: "#c678dd",
  syntaxProperty: "#e17078", // #e06c75
  syntaxComment: "#8e939b", // #7f848e
  syntaxPunctuation: "#abb2bf",
  syntaxBoolean: "#d19a66",

  shadowOverlay: "0 8px 24px rgba(0, 0, 0, 0.36)",
  overlayBackdrop: "rgba(0, 0, 0, 0.5)",
};

export const dark: Theme = { id: "dark", name: "Dark", base: "dark", tokens: darkTokens };
export const light: Theme = { id: "light", name: "Light", base: "light", tokens: lightTokens };
export const oneDark: Theme = { id: "oneDark", name: "One Dark", base: "dark", tokens: oneDarkTokens };

export const builtinThemes: Theme[] = [dark, light, oneDark];
