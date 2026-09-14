// Restly's theme tokens, each written to the CSS variable in tokenToCssVar below.
//
// Custom themes are VS Code color themes: JSON with comments, with "type", "colors", and
// "tokenColors". The token names users write are VS Code's documented color keys
// (https://code.visualstudio.com/api/references/theme-color), not the names below.
// convertVscodeTheme() in vscode.ts maps them, for example:
//   editor.background -> surface          sideBar.background -> surfaceRaised
//   input.background -> surfaceInput      input.border -> border, borderControl
//   panel.border -> borderSubtle
//   editor.foreground -> text             descriptionForeground -> textSubtle
//   focusBorder -> borderFocus            textLink.foreground (else button.background) -> primary
//   button.background / button.hoverBackground / button.foreground -> primaryButton, primaryButtonHover, primaryButtonText
//   editor.selectionBackground -> selection
//   terminal.ansiGreen / ansiYellow / ansiBlue / ansiMagenta / ansiRed / ansiCyan -> method colors
//   tokenColors scopes (string, constant.numeric, keyword, ...) -> syntax*
// A key the theme leaves out comes from its type's VS Code default theme (Dark Modern or Light
// Modern) or is blended from the theme's own background and foreground. Fonts, sizes, and radii
// are not theme colors and come from the built-in theme of the same type.
//
// The names here are Restly's internal CSS contract and stay stable. Every color is checked
// against WCAG AA by contrastPairs in vscode.ts.

export interface ThemeTokens {
  // Surfaces
  surface: string;
  surfaceRaised: string;
  surfaceOverlay: string;
  surfaceHover: string;
  surfaceActive: string;
  surfaceInput: string;
  // Text
  text: string;
  textSubtle: string;
  textSubtlest: string;
  // Borders
  border: string;
  borderSubtle: string;
  // The boundary of inputs and dropdowns (WCAG 1.4.11). border and borderSubtle are dividers.
  borderControl: string;
  borderFocus: string;
  // Accents
  // Links and accents (tab underline, dots, selected markers).
  primary: string;
  // Filled primary buttons, from button.background, button.hoverBackground, and button.foreground.
  primaryButton: string;
  primaryButtonHover: string;
  primaryButtonText: string;
  info: string;
  success: string;
  notice: string;
  warning: string;
  danger: string;
  // Methods
  methodGet: string;
  methodPost: string;
  methodPut: string;
  methodPatch: string;
  methodDelete: string;
  methodHead: string;
  methodOptions: string;
  methodWs: string;
  // Variables ({{variable}} highlighting)
  varDefined: string;
  varDefinedBg: string;
  varUndefined: string;
  varUndefinedBg: string;
  // Text selection in inputs and editors
  selection: string;
  // Syntax
  syntaxString: string;
  syntaxNumber: string;
  syntaxKeyword: string;
  syntaxProperty: string;
  syntaxComment: string;
  syntaxPunctuation: string;
  syntaxBoolean: string;
  // Other
  fontUi: string;
  fontMono: string;
  fontSizeUi: string;
  fontSizeMono: string;
  radius: string;
  radiusSmall: string;
  shadowOverlay: string;
}

export const tokenToCssVar: Record<keyof ThemeTokens, string> = {
  surface: "--surface",
  surfaceRaised: "--surface-raised",
  surfaceOverlay: "--surface-overlay",
  surfaceHover: "--surface-hover",
  surfaceActive: "--surface-active",
  surfaceInput: "--surface-input",

  text: "--text",
  textSubtle: "--text-subtle",
  textSubtlest: "--text-subtlest",

  border: "--border",
  borderSubtle: "--border-subtle",
  borderControl: "--border-control",
  borderFocus: "--border-focus",

  primary: "--primary",
  primaryButton: "--primary-button",
  primaryButtonHover: "--primary-button-hover",
  primaryButtonText: "--primary-button-text",
  info: "--info",
  success: "--success",
  notice: "--notice",
  warning: "--warning",
  danger: "--danger",

  methodGet: "--method-get",
  methodPost: "--method-post",
  methodPut: "--method-put",
  methodPatch: "--method-patch",
  methodDelete: "--method-delete",
  methodHead: "--method-head",
  methodOptions: "--method-options",
  methodWs: "--method-ws",

  varDefined: "--var-defined",
  varDefinedBg: "--var-defined-bg",
  varUndefined: "--var-undefined",
  varUndefinedBg: "--var-undefined-bg",

  selection: "--selection",

  syntaxString: "--syntax-string",
  syntaxNumber: "--syntax-number",
  syntaxKeyword: "--syntax-keyword",
  syntaxProperty: "--syntax-property",
  syntaxComment: "--syntax-comment",
  syntaxPunctuation: "--syntax-punctuation",
  syntaxBoolean: "--syntax-boolean",

  fontUi: "--font-ui",
  fontMono: "--font-mono",
  fontSizeUi: "--font-size-ui",
  fontSizeMono: "--font-size-mono",
  radius: "--radius",
  radiusSmall: "--radius-small",
  shadowOverlay: "--shadow-overlay",
};
