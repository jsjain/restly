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
  radius: "6px",
  radiusSmall: "4px",
};

// The built-ins are convertVscodeTheme() output for VS Code's own theme files, so they follow the
// same mapping and WCAG guard as imported themes. A trailing comment gives the source value where
// the guard changed it.

// VS Code Dark Modern: extensions/theme-defaults/themes/dark_modern.json, which includes
// dark_plus.json and dark_vs.json. Restly's surface is #262626 instead of #1f1f1f, so every
// background and border below is Dark Modern's color 7 steps lighter before conversion:
// editor.background and tab.activeBackground #262626, sideBar.background #1f1f1f,
// editorWidget.background #272727, input.background and dropdown.background #383838,
// input.border, dropdown.border and checkbox.border #434343, panel.border and sideBar.border #323232,
// editor.lineHighlightBorder #2f2f2f.
const darkTokens: ThemeTokens = {
  ...layout,
  surface: "#262626",
  surfaceRaised: "#1f1f1f",
  surfaceOverlay: "#272727",
  surfaceHover: "#333333",
  surfaceActive: "#3d3d3d",
  surfaceInput: "#383838",

  text: "#cccccc",
  textSubtle: "#a7a7a7", // descriptionForeground #9d9d9d
  textSubtlest: "#8d8d8d", // textSubtle one step dimmer (input.placeholderForeground #989898 is too close)

  border: "#434343",
  borderSubtle: "#3e3e3e", // panel.border #323232
  borderControl: "#434343",
  borderFocus: "#258cda", // focusBorder #0078d4

  primary: "#52adfc", // textLink.foreground #4daafc
  primaryButton: "#0078d4",
  primaryButtonHover: "#026ec1",
  primaryButtonText: "#ffffff",
  info: "#4daafc",
  success: "#0dbc79",
  notice: "#e5e510",
  warning: "#cca700",
  danger: "#fa7b74", // errorForeground #f85149

  methodGet: "#16be7e", // terminal.ansiGreen #0dbc79
  methodPost: "#e5e510",
  methodPut: "#7cabde", // terminal.ansiBlue #2472c8
  methodPatch: "#d78ed7", // terminal.ansiMagenta #bc3fbc
  methodDelete: "#e49191", // terminal.ansiRed #cd3131
  methodHead: "#a7a7a7", // descriptionForeground #9d9d9d
  methodOptions: "#de993b", // ansiRed/ansiYellow mix #d98b21
  methodWs: "#33b5d4", // terminal.ansiCyan #11a8cd

  varDefined: "#44cb98", // terminal.ansiGreen #0dbc79
  varDefinedBg: "rgba(13, 188, 121, 0.16)",
  varUndefined: "#fb918b", // errorForeground #f85149
  varUndefinedBg: "rgba(248, 81, 73, 0.16)",

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

  shadowOverlay: "0 8px 24px rgba(0, 0, 0, 0.36)",
  overlayBackdrop: "rgba(0, 0, 0, 0.5)",
};

// VS Code Light Modern: light_modern.json, which includes light_plus.json and light_vs.json.
const lightTokens: ThemeTokens = {
  ...layout,
  surface: "#ffffff",
  surfaceRaised: "#f8f8f8",
  surfaceOverlay: "#f8f8f8",
  surfaceHover: "#f2f2f2",
  surfaceActive: "#e8e8e8",
  surfaceInput: "#ffffff",

  text: "#3b3b3b",
  textSubtle: "#3b3b3b",
  textSubtlest: "#727272", // input.placeholderForeground #767676

  border: "#cecece",
  borderSubtle: "#d3d3d3", // panel.border #e5e5e5
  borderControl: "#cecece",
  borderFocus: "#005fb8",

  primary: "#005fb8",
  primaryButton: "#005fb8",
  primaryButtonHover: "#0258a8",
  primaryButtonText: "#ffffff",
  info: "#005fb8",
  success: "#007700", // terminal.ansiGreen #00bc00
  notice: "#696b00", // terminal.ansiYellow #949800
  warning: "#966a02", // editorWarning.foreground #bf8803
  danger: "#b63b36", // errorForeground #f85149

  methodGet: "#007a00", // terminal.ansiGreen #00bc00
  methodPost: "#6a6d00", // terminal.ansiYellow #949800
  methodPut: "#0451a5",
  methodPatch: "#b905b9", // terminal.ansiMagenta #bc05bc
  methodDelete: "#c42f2f", // terminal.ansiRed #cd3131
  methodHead: "#3b3b3b",
  methodOptions: "#9b5816", // ansiRed/ansiYellow mix #b16519
  methodWs: "#04728e", // terminal.ansiCyan #0598bc

  varDefined: "#007d00", // terminal.ansiGreen #00bc00
  varDefinedBg: "rgba(0, 188, 0, 0.16)",
  varUndefined: "#bb3d37", // errorForeground #f85149
  varUndefinedBg: "rgba(248, 81, 73, 0.16)",

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

  shadowOverlay: "0 8px 24px rgba(0, 0, 0, 0.16)",
  overlayBackdrop: "rgba(0, 0, 0, 0.5)",
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
  warning: "#d19a66",
  danger: "#de9994", // editorError.foreground #c24038

  methodGet: "#8cc265",
  methodPost: "#d29357", // terminal.ansiYellow #d18f52
  methodPut: "#4ba6f0", // terminal.ansiBlue #4aa5f0
  methodPatch: "#ce84e5", // terminal.ansiMagenta #c162de
  methodDelete: "#e8838b", // terminal.ansiRed #e05561
  methodHead: "#abb2bf",
  methodOptions: "#df8a76", // ansiRed/ansiYellow mix #d9725a
  methodWs: "#42b3c2",

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
