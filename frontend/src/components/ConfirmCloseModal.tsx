import { useEffect } from "react";
import { state, closeTab, openSaveDraftModal, notifyChange } from "../store";
import type { RequestTab } from "../store";
import { requestTitle } from "../requestName";

// Tabs added here by ConfirmCloseModal's Save… button are removed by SaveRequestModal
// once the save succeeds (or is cancelled), which then closes the tab.
export const closeAfterSave = new WeakSet<RequestTab>();

interface Props {
  tab: RequestTab;
}

function cancel() {
  state.confirmClose = null;
  notifyChange();
}

export default function ConfirmCloseModal({ tab }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const name = requestTitle(tab.draft);

  return (
    <div className="modal-overlay" onClick={cancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Save changes to “{name}”?</div>
        <p>Your changes will be lost if you don't save them.</p>
        <div className="modal-actions">
          <button
            onClick={() => {
              state.confirmClose = null;
              closeTab(tab);
            }}
          >
            Don't Save
          </button>
          <button onClick={cancel}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              closeAfterSave.add(tab);
              state.confirmClose = null;
              openSaveDraftModal(tab);
            }}
          >
            Save…
          </button>
        </div>
      </div>
    </div>
  );
}
