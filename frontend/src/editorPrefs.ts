// Editor preferences shared by every CodeEditor. Wrapping is one global setting, like VS Code's
// word wrap; onWrapChange lets editors already on screen update without remounting.

const WRAP_KEY = "restly.editorWrap";
const wrapListeners = new Set<(wrap: boolean) => void>();

export function loadWrap(): boolean {
  try {
    const stored = localStorage.getItem(WRAP_KEY);
    if (stored === "true" || stored === "false") return stored === "true";
  } catch {
    // fall through to default
  }
  return true;
}

export function saveWrap(wrap: boolean): void {
  localStorage.setItem(WRAP_KEY, String(wrap));
  wrapListeners.forEach((cb) => cb(wrap));
}

export function onWrapChange(cb: (wrap: boolean) => void): () => void {
  wrapListeners.add(cb);
  return () => wrapListeners.delete(cb);
}
