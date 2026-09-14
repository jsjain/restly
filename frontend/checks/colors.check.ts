// Run with: node frontend/checks/colors.check.ts
// Fails when a stylesheet or component holds a literal color. Every color must come from a theme token
// (src/theme/tokens.ts), so a theme can change it. Only the built-in themes and the VS Code converter
// may spell out colors.
import fs from "node:fs";
import path from "node:path";

const src = path.join(import.meta.dirname, "../src");
const allowed = new Set(["theme/themes.ts", "theme/vscode.ts"]);
const colorFunction = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const namedColor = /:\s*(?:white|black|red|green|blue|gray|grey)\s*(?:;|!)/i;

const failures: string[] = [];
for (const entry of fs.readdirSync(src, { recursive: true }) as string[]) {
  const file = entry.split(path.sep).join("/");
  if (!/\.(css|tsx?)$/.test(file) || allowed.has(file)) continue;
  // Blank out comments but keep line breaks, so line numbers stay right. "//" after ":" is a URL.
  const text = fs
    .readFileSync(path.join(src, entry), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  text.split("\n").forEach((line, i) => {
    if (colorFunction.test(line) || (file.endsWith(".css") && namedColor.test(line))) {
      failures.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (failures.length) {
  console.error(`literal colors outside theme tokens:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("colors ok: no literal colors outside the theme files");
