import { useEffect, useRef, useSyncExternalStore } from "react";
import "../dialog.css";
import { getSnapshot, respond, subscribe } from "../dialog";

// Renders whatever confirmDialog() in dialog.ts currently has open, or nothing. Mount once
// (see Overlays.tsx) alongside the other always-on overlays.
export default function ConfirmDialog() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state) confirmRef.current?.focus();
  }, [state]);

  if (!state) return null;
  const { options } = state;

  function cancel() {
    respond(false);
  }
  function confirm() {
    respond(true);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter") {
      e.stopPropagation();
      e.preventDefault();
      confirm();
    } else if (e.key === "Tab") {
      // Only two focusable elements in the dialog, so Tab (with or without Shift) just
      // toggles between them instead of letting focus escape to whatever is behind the modal.
      e.preventDefault();
      const next = document.activeElement === confirmRef.current ? cancelRef.current : confirmRef.current;
      next?.focus();
    }
  }

  return (
    <div className="modal-overlay" onClick={cancel} onKeyDown={onKeyDown}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{options.title}</div>
        <p>{options.message}</p>
        <div className="modal-actions">
          <button ref={cancelRef} onClick={cancel}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button ref={confirmRef} className={options.danger ? "danger" : "primary"} onClick={confirm}>
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
