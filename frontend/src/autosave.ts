// Auto-save scheduler for dirty collection/environment files. The core (startAutosave) takes
// injected dependencies so it runs without Wails or a browser (see checks/autosave.check.ts).
// localStorage/window-backed settings below are for real callers (App.tsx, AppSettingsTab.tsx).

export interface AutosaveSettings {
  enabled: boolean;
  seconds: number;
}

export interface DirtyFile {
  file: string;
  save: () => Promise<void>;
}

export interface Clock {
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
}

export interface AutosaveDeps {
  listDirty: () => DirtyFile[];
  getSettings: () => AutosaveSettings;
  toast: (text: string, kind: "error") => void;
  clock: Clock;
  // Notified when the setting changes, so the interval can be rescheduled without a restart.
  onSettingsChanged?: (cb: () => void) => () => void;
}

// startAutosave runs getSettings().seconds apart, saving whatever listDirty() reports as dirty
// at that moment. Returns a cleanup function that stops the timer.
export function startAutosave(deps: AutosaveDeps): () => void {
  const inFlight = new Set<string>();
  // Files that already toasted a failure; skip re-toasting until they save successfully.
  const failed = new Set<string>();
  let timerId: number | null = null;
  let scheduledSeconds = 0;

  function tick(): void {
    if (!deps.getSettings().enabled) return;
    for (const { file, save } of deps.listDirty()) {
      if (inFlight.has(file)) continue;
      inFlight.add(file);
      save()
        .then(() => failed.delete(file))
        .catch((err) => {
          if (!failed.has(file)) {
            failed.add(file);
            deps.toast(`Auto-save failed for ${file}: ${String(err)}`, "error");
          }
        })
        .finally(() => inFlight.delete(file));
    }
  }

  function reschedule(): void {
    if (timerId !== null) deps.clock.clearInterval(timerId);
    scheduledSeconds = deps.getSettings().seconds;
    timerId = deps.clock.setInterval(tick, scheduledSeconds * 1000);
  }

  reschedule();
  const unsubscribe = deps.onSettingsChanged?.(() => {
    if (deps.getSettings().seconds !== scheduledSeconds) reschedule();
  });

  return () => {
    if (timerId !== null) deps.clock.clearInterval(timerId);
    unsubscribe?.();
  };
}

// --- real (browser) settings storage, used by App.tsx and AppSettingsTab.tsx only ---

const STORAGE_KEY = "restly.autosave";
export const AUTOSAVE_CHANGED_EVENT = "restly-autosave-changed";
const DEFAULT_SETTINGS: AutosaveSettings = { enabled: true, seconds: 5 };

function clampSeconds(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.seconds;
  return Math.min(600, Math.max(1, Math.round(n)));
}

export function loadAutosaveSettings(): AutosaveSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (parsed && typeof parsed === "object" && typeof parsed.enabled === "boolean" && typeof parsed.seconds === "number") {
      return { enabled: parsed.enabled, seconds: clampSeconds(parsed.seconds) };
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveAutosaveSettings(next: AutosaveSettings): void {
  const settings: AutosaveSettings = { enabled: next.enabled, seconds: clampSeconds(next.seconds) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(AUTOSAVE_CHANGED_EVENT));
}

export function watchAutosaveSettings(cb: () => void): () => void {
  window.addEventListener(AUTOSAVE_CHANGED_EVENT, cb);
  return () => window.removeEventListener(AUTOSAVE_CHANGED_EVENT, cb);
}

export const realClock: Clock = {
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
};
