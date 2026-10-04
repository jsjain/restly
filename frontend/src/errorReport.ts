import * as api from "./api";
import { state } from "./store";

const MAX_REPORTS = 20;
const sent = new Set<string>();
let version = "";

function describe(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack ?? "" };
  return { name: typeof error, message: String(error), stack: "" };
}

// Plain text for the log and the clipboard. Only the active tab's kind is read from the
// store: URLs, headers, bodies and variables can hold secrets and must never end up here.
export function formatReport(error: unknown, source: string, componentStack?: string): string {
  const { name, message, stack } = describe(error);
  let tab = "";
  try {
    tab = state.activeTab?.kind ?? "";
  } catch {
    // The store itself may be what broke.
  }
  const lines = [
    `Time: ${new Date().toISOString()}`,
    ...(version ? [`Restly: ${version}`] : []),
    `User agent: ${navigator.userAgent}`,
    `Active tab: ${tab || "none"}`,
    `Source: ${source}`,
    `Error: ${name}: ${message}`,
  ];
  if (stack) lines.push("", "Stack:", stack);
  if (componentStack) lines.push("", "Component stack:", componentStack.trim());
  return lines.join("\n");
}

// Capped and de-duplicated so a render loop cannot flood the log file.
export function reportError(error: unknown, source: string, componentStack?: string): void {
  const { message, stack } = describe(error);
  const key = `${message}\n${stack}`;
  if (sent.has(key) || sent.size >= MAX_REPORTS) return;
  sent.add(key);
  api.logFrontendError(formatReport(error, source, componentStack)).catch((err) => console.error("log frontend error", err));
}

export function installErrorReporting(): void {
  api
    .getAppInfo()
    .then((info) => (version = info.version))
    .catch(() => {});
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, "window error"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "unhandled rejection"));
}
