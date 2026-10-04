// Run with: node frontend/checks/ui-guidelines.check.ts
// Enforces the mechanical rules in docs/ui-guidelines.md:
//   - border-radius uses the radius tokens (--radius-xs, --radius-small, --radius, --radius-large),
//     or 0, 50%, 999px, inherit;
//   - font-size uses the type scale (--fs-*, --font-size-*), inherit, or em/% units;
//   - shortcut hints are rendered by components/Kbd.tsx, never as a hand-written <kbd className="kbd">.
import fs from "node:fs";
import path from "node:path";

const src = path.join(import.meta.dirname, "../src");

const radiusPart = /^(?:0|50%|999px|inherit|var\(--radius(?:-xs|-small|-large)?\))$/;
const fontSizeValue = /^(?:inherit|var\(--(?:fs-[a-z]+|font-size-(?:ui|mono))\)|calc\(.*var\(--(?:fs-[a-z]+|font-size-(?:ui|mono))\).*\)|[0-9.]+(?:em|%))$/;

function stripComments(text: string): string {
  // Blank out comments but keep line breaks, so line numbers stay right. "//" after ":" is a URL.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Splits a CSS value on top-level spaces, keeping var(...) and calc(...) whole.
function parts(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === " " && depth === 0) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const failures: string[] = [];
for (const entry of fs.readdirSync(src, { recursive: true }) as string[]) {
  const file = entry.split(path.sep).join("/");
  if (!/\.(css|tsx)$/.test(file)) continue;
  const lines = stripComments(fs.readFileSync(path.join(src, entry), "utf8")).split("\n");
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}: ${line.trim()}`;
    if (file.endsWith(".css")) {
      const radius = /(?:^|[\s;{])border(?:-[a-z]+)?-radius:\s*([^;!]+)/.exec(line);
      if (radius && !parts(radius[1].trim()).every((p) => radiusPart.test(p))) failures.push(`radius not a token: ${where}`);
      const size = /(?:^|[\s;{])font-size:\s*([^;!]+)/.exec(line);
      if (size && !fontSizeValue.test(size[1].trim())) failures.push(`font-size not on the type scale: ${where}`);
    } else if (file !== "components/Kbd.tsx" && /<kbd\b[^>]*className=["{]?["']?kbd/.test(line)) {
      failures.push(`hand-written keycap (use <Kbd>): ${where}`);
    }
  });
}

if (failures.length) {
  console.error(`UI guideline violations (docs/ui-guidelines.md):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("ui guidelines ok: radii and font sizes use tokens, keycaps use <Kbd>");
