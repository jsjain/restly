import { useSyncExternalStore } from "react";
import { state, subscribe, getVersion, dismissToast } from "../store";

export default function Toasts() {
  useSyncExternalStore(subscribe, getVersion);
  if (state.toasts.length === 0) return null;
  return (
    <div className="toasts">
      {state.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
