import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { toast, setHistoryLimit } from "../store";
import type { AppInfo, ClientCert, Settings } from "../types";
import { type AutosaveSettings, loadAutosaveSettings, saveAutosaveSettings } from "../autosave";
import { loadWrap, saveWrap } from "../editorPrefs";
import ThemePicker from "../theme/ThemePicker";
import FontPicker from "../theme/FontPicker";
import Select from "./Select";
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

const USER_AGENT_PRESETS = [
  { label: "Restly (default)", value: "" },
  {
    label: "Chrome (Windows)",
    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  },
  {
    label: "Chrome (macOS)",
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  },
  {
    label: "Chrome (Android)",
    value: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  },
  { label: "Firefox (Windows)", value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0" },
  { label: "Firefox (Android)", value: "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0" },
  {
    label: "Safari (macOS)",
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  },
  {
    label: "Safari (iPhone)",
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  },
];

// Select values are the UA strings themselves, which are never this.
const CUSTOM_UA = "custom";

export default function AppSettingsTab() {
  const [section, setSection] = useState<SectionId>("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [autosave, setAutosave] = useState<AutosaveSettings>(() => loadAutosaveSettings());
  const [wrap, setWrap] = useState(() => loadWrap());
  const [secondsText, setSecondsText] = useState(() => String(autosave.seconds));
  const [historyText, setHistoryText] = useState("");
  const [logPath, setLogPath] = useState("");
  const uaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setHistoryText(String(s.historyLimit));
      })
      .catch((err) => toast(String(err), "error"));
    api
      .logFilePath()
      .then(setLogPath)
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

  // Lowering the limit deletes entries, so it commits on blur/Enter, not per keystroke. A blank
  // or non-numeric value reverts. The applied (clamped) value goes into settings too, or a
  // later Network Save would send the stale one back.
  async function commitHistoryLimit() {
    const n = Number(historyText);
    if (historyText.trim() === "" || !Number.isFinite(n)) {
      setHistoryText(String(settings?.historyLimit ?? ""));
      return;
    }
    try {
      const applied = await setHistoryLimit(Math.round(n));
      update((s) => (s.historyLimit = applied));
      setHistoryText(String(applied));
    } catch (err) {
      setHistoryText(String(settings?.historyLimit ?? ""));
      toast(String(err), "error");
    }
  }

  async function showLogFile() {
    try {
      await api.revealLogFile();
    } catch (err) {
      toast(String(err), "error");
    }
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
            <>
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
              <div className="settings-section">
                <div className="settings-section-head">
                  <h3>Editor</h3>
                  <p>Long lines in the request body, response, and scripts. Applies immediately.</p>
                </div>
                <label className="settings-checkbox-row">
                  <input
                    type="checkbox"
                    checked={wrap}
                    onChange={(e) => {
                      setWrap(e.target.checked);
                      saveWrap(e.target.checked);
                    }}
                  />
                  Wrap long lines
                </label>
              </div>
              <div className="settings-section">
                <div className="settings-section-head">
                  <h3>History</h3>
                  <p>
                    How many sent requests the History list keeps. Lowering it deletes the oldest entries. Applies
                    immediately.
                  </p>
                </div>
                <div className="settings-row">
                  <label>Keep the last</label>
                  <div className="settings-control-group">
                    <input
                      type="number"
                      className="mono settings-seconds-input"
                      min={1}
                      max={10000}
                      value={historyText}
                      onChange={(e) => setHistoryText(e.target.value)}
                      onBlur={commitHistoryLimit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitHistoryLimit();
                      }}
                    />
                    requests
                  </div>
                </div>
              </div>
            </>
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
                  <h3>User-Agent</h3>
                  <p>
                    Sent when a request has no User-Agent header of its own. Used by sends, collection runs,
                    WebSockets, and code snippets.
                  </p>
                </div>
                <Select
                  value={USER_AGENT_PRESETS.some((p) => p.value === net.userAgent) ? net.userAgent : CUSTOM_UA}
                  options={[...USER_AGENT_PRESETS, { label: "Custom", value: CUSTOM_UA }]}
                  ariaLabel="User-Agent preset"
                  onChange={(v) => {
                    if (v === CUSTOM_UA) uaInputRef.current?.focus();
                    else update((s) => (s.network.userAgent = v));
                  }}
                />
                <input
                  type="text"
                  className="mono"
                  ref={uaInputRef}
                  placeholder="Restly/0.1"
                  aria-label="User-Agent"
                  value={net.userAgent}
                  onChange={(e) => update((s) => (s.network.userAgent = e.target.value))}
                />
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
              {logPath ? (
                <div className="about-row">
                  <div className="about-text">
                    <div className="about-version">Log file</div>
                    <div className="mono about-version">{logPath}</div>
                  </div>
                  <button onClick={showLogFile}>Show log file</button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
