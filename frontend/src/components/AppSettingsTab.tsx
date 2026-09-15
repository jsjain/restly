import { useEffect, useState } from "react";
import * as api from "../api";
import { toast } from "../store";
import type { AppInfo, ClientCert, Settings } from "../types";
import { type AutosaveSettings, loadAutosaveSettings, saveAutosaveSettings } from "../autosave";
import ThemePicker from "../theme/ThemePicker";
import FontPicker from "../theme/FontPicker";
import logo from "../assets/logo.png";
import "../about.css";
import "../settings.css";

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "network", label: "Network" },
  { id: "keyboard", label: "Keyboard" },
  { id: "about", label: "About" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function AppSettingsTab() {
  const [section, setSection] = useState<SectionId>("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [autosave, setAutosave] = useState<AutosaveSettings>(() => loadAutosaveSettings());
  const [secondsText, setSecondsText] = useState(() => String(autosave.seconds));

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err) => toast(String(err), "error"));
    api
      .getAppInfo()
      .then(setAppInfo)
      .catch((err) => toast(String(err), "error"));
  }, []);

  async function copyVersion() {
    if (!appInfo) return;
    const text = `Restly ${appInfo.version}${appInfo.commit ? ` (${appInfo.commit})` : ""}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("Version copied");
    } catch (err) {
      toast(String(err), "error");
    }
  }

  function update(fn: (s: Settings) => void) {
    setSettings((prev) => {
      if (!prev) return prev;
      const next: Settings = { ...prev, network: { ...prev.network, clientCerts: [...prev.network.clientCerts] } };
      fn(next);
      return next;
    });
  }

  async function chooseCaFile() {
    try {
      const path = await api.pickFile("Choose CA certificate (PEM)");
      if (path) update((s) => (s.network.caFile = path));
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function chooseCertFile(index: number, field: "certFile" | "keyFile") {
    const title = field === "certFile" ? "Choose client certificate (PEM)" : "Choose private key (PEM)";
    try {
      const path = await api.pickFile(title);
      if (path) update((s) => (s.network.clientCerts[index][field] = path));
    } catch (err) {
      toast(String(err), "error");
    }
  }

  function addCert() {
    update((s) => s.network.clientCerts.push({ host: "", certFile: "", keyFile: "" }));
  }

  function removeCert(index: number) {
    update((s) => s.network.clientCerts.splice(index, 1));
  }

  function updateCert(index: number, field: keyof ClientCert, value: string) {
    update((s) => (s.network.clientCerts[index][field] = value));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await api.saveSettings(settings!);
      toast("Settings saved");
    } catch (err) {
      setError(String(err));
      toast(String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  // Auto-save changes apply immediately (no Save button): write through and re-read the
  // clamped value back so the checkbox/number field reflect what actually got stored.
  function commitAutosave(next: AutosaveSettings) {
    saveAutosaveSettings(next);
    const stored = loadAutosaveSettings();
    setAutosave(stored);
    setSecondsText(String(stored.seconds));
  }

  function handleSecondsChange(raw: string) {
    setSecondsText(raw);
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) commitAutosave({ ...autosave, seconds: n });
  }

  async function openKeybindingsFile() {
    try {
      await api.openKeybindings();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  if (!settings) return <div className="empty-state">Loading…</div>;
  const net = settings.network;

  return (
    <div className="settings-shell">
      <nav className="settings-rail" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="settings-rail-item"
            aria-current={section === s.id ? "true" : undefined}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        <div className="settings-page">
          {section === "appearance" ? (
            <div className="settings-section">
              <div className="settings-section-head">
                <h3>Appearance</h3>
                <p>Choose a theme and fonts. Any VS Code color theme file can be imported. Changes apply immediately.</p>
              </div>
              <ThemePicker />
              <FontPicker />
            </div>
          ) : null}

          {section === "general" ? (
            <div className="settings-section">
              <div className="settings-section-head">
                <h3>General</h3>
                <p>
                  Auto-save writes every collection and environment file with unsaved changes on a timer. Applies
                  immediately. Drafts that were never saved are not auto-saved.
                </p>
              </div>
              <label className="settings-checkbox-row">
                <input
                  type="checkbox"
                  checked={autosave.enabled}
                  onChange={(e) => commitAutosave({ ...autosave, enabled: e.target.checked })}
                />
                Auto-save
              </label>
              <div className="settings-row">
                <label>Every</label>
                <div className="settings-control-group">
                  <input
                    type="number"
                    className="mono settings-seconds-input"
                    min={1}
                    max={600}
                    disabled={!autosave.enabled}
                    value={secondsText}
                    onChange={(e) => handleSecondsChange(e.target.value)}
                    onBlur={() => setSecondsText(String(autosave.seconds))}
                  />
                  seconds
                </div>
              </div>
            </div>
          ) : null}

          {section === "network" ? (
            <>
              <div className="settings-section">
                <div className="settings-section-head">
                  <h3>Network</h3>
                  <p>Proxy, SSL, and client certificates for outgoing requests. Requires Save below to take effect.</p>
                </div>
                <div className="settings-section-head">
                  <h3>Proxy</h3>
                  <p>Route outgoing requests through a proxy.</p>
                </div>
                <div className="settings-radio-group">
                  {(["none", "environment", "custom"] as const).map((mode) => (
                    <label key={mode} className="settings-radio-row">
                      <input
                        type="radio"
                        name="proxyMode"
                        checked={net.proxyMode === mode}
                        onChange={() => update((s) => (s.network.proxyMode = mode))}
                      />
                      {mode === "none" ? "No proxy" : mode === "environment" ? "Environment" : "Custom"}
                    </label>
                  ))}
                </div>
                {net.proxyMode === "environment" ? (
                  <div className="hint">Uses HTTP_PROXY, HTTPS_PROXY and NO_PROXY. The macOS system proxy setting is not read.</div>
                ) : null}
                {net.proxyMode === "custom" ? (
                  <>
                    <div className="settings-row">
                      <label>Proxy URL</label>
                      <input
                        type="text"
                        className="mono"
                        placeholder="http://user:pass@proxy.local:8080"
                        value={net.proxyUrl}
                        onChange={(e) => update((s) => (s.network.proxyUrl = e.target.value))}
                      />
                    </div>
                    <div className="settings-row">
                      <label>Bypass</label>
                      <input
                        type="text"
                        className="mono"
                        placeholder="localhost, *.internal"
                        value={net.proxyBypass}
                        onChange={(e) => update((s) => (s.network.proxyBypass = e.target.value))}
                      />
                    </div>
                  </>
                ) : null}
              </div>

              <div className="settings-section">
                <div className="settings-section-head">
                  <h3>SSL</h3>
                  <p>Control certificate verification and client identity for HTTPS requests.</p>
                </div>
                <label className="settings-checkbox-row">
                  <input
                    type="checkbox"
                    checked={net.verifyTls}
                    onChange={(e) => update((s) => (s.network.verifyTls = e.target.checked))}
                  />
                  Verify SSL certificates
                </label>
                <div className="settings-row">
                  <label>CA bundle</label>
                  <div className="settings-control-group">
                    <input type="text" className="mono" readOnly placeholder="No CA bundle selected" value={net.caFile} />
                    <button onClick={chooseCaFile}>Choose…</button>
                    <button className="ghost" onClick={() => update((s) => (s.network.caFile = ""))}>
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-head">
                  <h3>Client certificates</h3>
                  <p>PEM files only. .pfx and passphrase-protected keys are not supported.</p>
                </div>
                <table className="kv-table cert-table">
                  <thead>
                    <tr>
                      <th>Host</th>
                      <th>Certificate</th>
                      <th>Key</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {net.clientCerts.map((cert, i) => (
                      <tr key={i}>
                        <td>
                          <input
                            type="text"
                            className="mono"
                            placeholder="api.example.com or api.example.com:8443"
                            value={cert.host}
                            onChange={(e) => updateCert(i, "host", e.target.value)}
                          />
                        </td>
                        <td>
                          <div className="cert-cell">
                            <input type="text" className="mono" readOnly placeholder="Not set" value={cert.certFile} />
                            <button onClick={() => chooseCertFile(i, "certFile")}>Choose…</button>
                          </div>
                        </td>
                        <td>
                          <div className="cert-cell">
                            <input type="text" className="mono" readOnly placeholder="Not set" value={cert.keyFile} />
                            <button onClick={() => chooseCertFile(i, "keyFile")}>Choose…</button>
                          </div>
                        </td>
                        <td>
                          <button className="icon" onClick={() => removeCert(i)} title="Remove">
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="ghost" onClick={addCert}>
                  Add certificate
                </button>
              </div>

              <div className="settings-footer">
                {error ? <div className="settings-error">{error}</div> : null}
                <button className="primary" disabled={saving} onClick={handleSave}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          ) : null}

          {section === "keyboard" ? (
            <div className="settings-section">
              <div className="settings-section-head">
                <h3>Keyboard</h3>
                <p>⌘/ (Ctrl+/ on Windows/Linux) lists every keyboard shortcut.</p>
              </div>
              <button onClick={openKeybindingsFile}>Open Keybindings File</button>
            </div>
          ) : null}

          {section === "about" ? (
            <div className="settings-section">
              <div className="settings-section-head">
                <h3>About</h3>
                <p>Version and build details.</p>
              </div>
              <div className="about-row">
                <img className="about-logo" src={logo} alt="Restly" width={48} height={48} />
                <div className="about-text">
                  <div className="about-name">Restly</div>
                  {appInfo ? (
                    <>
                      <div className="about-version">Version {appInfo.version}</div>
                      {appInfo.commit || appInfo.buildTime ? (
                        <div className="about-build">
                          {appInfo.commit}
                          {appInfo.commit && appInfo.buildTime ? " · " : ""}
                          {appInfo.buildTime ? new Date(appInfo.buildTime).toLocaleDateString() : ""}
                        </div>
                      ) : null}
                      {appInfo.goVersion ? <div className="about-go">{appInfo.goVersion}</div> : null}
                    </>
                  ) : null}
                </div>
                <button className="ghost" onClick={copyVersion} disabled={!appInfo}>
                  Copy
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
