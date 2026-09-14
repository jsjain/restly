// In-app replacement for native OS confirm() dialogs. Module-level store, same shape as
// store.ts's subscribe/getSnapshot pattern, consumed via useSyncExternalStore.
//
// Only one dialog is shown at a time: if confirmDialog() is called while one is already open,
// the first resolves false (as if cancelled) and the new one takes its place.

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface DialogState {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

let current: DialogState | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false);
    current = { options, resolve };
    notify();
  });
}

// Called by ConfirmDialog.tsx when the user picks an answer (or dismisses it).
export function respond(ok: boolean): void {
  if (!current) return;
  const { resolve } = current;
  current = null;
  notify();
  resolve(ok);
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getSnapshot(): DialogState | null {
  return current;
}
