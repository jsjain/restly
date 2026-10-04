import { useSyncExternalStore } from "react";
import { Info, TriangleAlert, X } from "lucide-react";
import { state, subscribe, getVersion, dismissToast } from "../store";

export default function Toasts() {
  useSyncExternalStore(subscribe, getVersion);
  if (state.toasts.length === 0) return null;
  return (
    <div className="toasts">
      {state.toasts.map((t) => {
        const Icon = t.kind === "error" ? TriangleAlert : Info;
        return (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"} onClick={() => dismissToast(t.id)}>
            <Icon className="toast-icon" size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="toast-text">{t.text}</span>
            <button className="icon" aria-label="Dismiss" title="Dismiss" onClick={() => dismissToast(t.id)}>
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
