// Screenshot the running app for UI review (see docs/ui-guidelines.md, section 8).
// Drives headless Chrome over the DevTools protocol: opens the URL, runs steps, saves PNGs.
// usage: PORT=9341 node cdp-shot.mjs <url> <steps.json> <outdir>
// A step: {"js": "...expression..."} and/or {"key":"Enter","code":"Enter","vk":13,"mod":4}, then
// optional "wait" (ms, default 600) and "shot" (file name without .png). mod: 1 alt, 2 ctrl, 4 meta, 8 shift.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [url, stepsFile, outDir] = process.argv.slice(2);
const PORT = process.env.PORT || "9333";
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
const steps = JSON.parse(readFileSync(stepsFile, "utf8"));
mkdirSync(outDir, { recursive: true });
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cdp-profile-${PORT}`,
  `--window-size=${W},${H}`, "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(200); }
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") console.log("page exception:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// ct(text, selector): click the first element matching selector whose text is text (or ends with it).
await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.ct=(t,sel)=>{const el=[...document.querySelectorAll(sel||'button,[role=treeitem],[role=option],[role=menuitem],[role=tab]')].find(e=>{const x=e.textContent.trim();return x===t||(x.endsWith(t)&&x.length<t.length+8)});if(!el)return 'miss '+t;el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));el.click();return 'ok '+t};1" });
await send("Page.navigate", { url });
await sleep(4000);
for (const s of steps) {
  if (s.js) {
    const r = await send("Runtime.evaluate", { expression: s.js, awaitPromise: true, returnByValue: true });
    console.log("js:", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text));
  }
  if (s.key) {
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type, key: s.key, code: s.code, modifiers: s.mod ?? 0, windowsVirtualKeyCode: s.vk });
    }
  }
  await sleep(s.wait ?? 600);
  if (s.shot) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${outDir}/${s.shot}.png`, Buffer.from(r.result.data, "base64"));
    console.log("shot:", `${outDir}/${s.shot}.png`);
  }
}
ws.close();
chrome.kill();
process.exit(0);
