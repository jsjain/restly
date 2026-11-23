import { useEffect, useState } from "react";
import { X } from "lucide-react";
import * as api from "../api";
import { toast } from "../store";
import { SETTINGS_SAVED } from "../commands";
import type { UpdateStatus } from "../types";
import "../updateBanner.css";

// A slim row above the tabs: a new version is available, downloading, or ready to install.
export default function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [auto, setAuto] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    // The event may land before the first read resolves, so only a missing status takes the read.
    api.getUpdateStatus().then((s) => setStatus((prev) => prev ?? s)).catch(() => {});
    return api.onUpdateStatus(setStatus);
  }, []);

  useEffect(() => {
    const read = () => api.getSettings().then((s) => setAuto(s.update.mode === "auto")).catch(() => {});
    read();
    window.addEventListener(SETTINGS_SAVED, read);
    return () => window.removeEventListener(SETTINGS_SAVED, read);
  }, []);

  if (!status || (status.state !== "available" && status.state !== "downloading" && status.state !== "ready")) return null;

  async function download() {
    setStarting(true);
    try {
      await api.downloadUpdate();
    } catch (err) {
      toast(String(err), "error");
    } finally {
      setStarting(false);
    }
  }

  async function dismiss() {
    try {
      await api.skipUpdate(status!.version);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  const whatsNew = status.pageUrl ? (
    <button type="button" className="ghost" onClick={() => api.openUrl(status.pageUrl)}>
      What's new
    </button>
  ) : null;

  return (
    <div className="update-banner" role="status">
      {status.state === "available" ? (
        <>
          <span className="update-text">Restly {status.version} is available.</span>
          {whatsNew}
          {status.canInstall ? (
            <button type="button" disabled={starting} onClick={download}>
              Update
            </button>
          ) : null}
          <button type="button" className="icon" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
            <X size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </>
      ) : null}
      {status.state === "downloading" ? <span className="update-text">Downloading Restly {status.version}…</span> : null}
      {status.state === "ready" ? (
        <>
          <span className="update-text">Restly {status.version} is ready.{auto ? " It installs when you quit." : ""}</span>
          <button type="button" className="primary" onClick={() => api.restartToUpdate().catch((err) => toast(String(err), "error"))}>
            Restart to update
          </button>
        </>
      ) : null}
    </div>
  );
}
