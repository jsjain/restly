import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { File, Globe, Info, Keyboard, Palette, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as api from "../api";
import { toast, setHistoryLimit } from "../store";
import type { AppInfo, ClientCert, Settings } from "../types";
import { listCommands, SETTINGS_SAVED } from "../commands";
import { effectiveKeys, isCustomized } from "../shortcuts";
import { fuzzyFilter, highlight } from "../fuzzy";
import { type AutosaveSettings, loadAutosaveSettings, saveAutosaveSettings } from "../autosave";
import { loadWrap, saveWrap } from "../editorPrefs";
import ThemePicker from "../theme/ThemePicker";
import FontPicker from "../theme/FontPicker";
import { type Density, getDensity, setDensity } from "../theme/theme";
import Select from "./Select";
import { Kbd } from "./Kbd";
import { ShortcutRow } from "./ShortcutsHelp";
import logo from "../assets/logo.png";
import "../overview.css";
import "../about.css";
import "../settings.css";

const SECTIONS = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "network", label: "Network", icon: Globe },
  { id: "keyboard", label: "Keyboard", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

type SectionId = (typeof SECTIONS)[number]["id"];

const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "comfortable", label: "Comfortable" },
];

const PROXY_MODES = [
  { mode: "none", label: "None" },
  { mode: "environment", label: "Environment variables" },
  { mode: "custom", label: "Custom" },
] as const;

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

// A switch is a checkbox underneath, so it keeps its keyboard and screen reader behavior.
function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
    </label>
  );
}

// One setting: label and help on the left, the control on the right.
function Row({ title, help, children, stack }: { title: string; help?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={`srow${stack ? " stack" : ""}`}>
      <div className="lbl">
        <b>{title}</b>
        {help ? <span>{help}</span> : null}
      </div>
      <div className="ctl">{children}</div>
    </div>
  );
}

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
  const [density, setDensityChoice] = useState<Density>(getDensity);

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
      window.dispatchEvent(new Event(SETTINGS_SAVED));
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
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="settings-shell">
      <nav className="settings-rail" aria-label="Settings sections">
        <div className="rail-label">Settings</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="settings-rail-item"
            aria-current={section === s.id ? "true" : undefined}
            onClick={() => setSection(s.id)}
          >
            <s.icon size={15} aria-hidden="true" />
            {s.label}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        <div className="set-col">
          <h1 className="set-title">{current.label}</h1>

          {section === "appearance" ? (
            <>
              <section className="sset">
                <h2>Theme</h2>
                <p className="sub">Any VS Code color theme file can be imported. Changes apply immediately.</p>
                <ThemePicker />
              </section>
              <section className="sset">
                <h2>Fonts</h2>
                <FontPicker />
              </section>
              <section className="sset">
                <h2>Layout</h2>
                <Row title="Density" help="Row height in the sidebar, tables and menus">
                  <div className="segmented" role="group" aria-label="Density">
                    {DENSITIES.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        className={density === d.value ? "active" : ""}
                        aria-pressed={density === d.value}
                        onClick={() => {
                          setDensity(d.value);
                          setDensityChoice(d.value);
                        }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </Row>
              </section>
            </>
          ) : null}

          {section === "general" ? (
            <>
              <section className="sset">
                <h2>Auto-save</h2>
                <Row
                  title="Auto-save"
                  help="Writes every collection and environment file with unsaved changes on a timer. Drafts that were never saved are not auto-saved."
                >
                  <Switch label="Auto-save" checked={autosave.enabled} onChange={(enabled) => commitAutosave({ ...autosave, enabled })} />
                </Row>
                <Row title="Every" help="From 1 to 600 seconds">
                  <input
                    type="number"
                    className="mono num-in"
                    aria-label="Auto-save interval in seconds"
                    min={1}
                    max={600}
                    disabled={!autosave.enabled}
                    value={secondsText}
                    onChange={(e) => handleSecondsChange(e.target.value)}
                    onBlur={() => setSecondsText(String(autosave.seconds))}
                  />
                  <span className="unit">seconds</span>
                </Row>
              </section>
              <section className="sset">
                <h2>Editor</h2>
                <Row title="Wrap long lines" help="In the request body, response and scripts">
                  <Switch
                    label="Wrap long lines"
                    checked={wrap}
                    onChange={(v) => {
                      setWrap(v);
                      saveWrap(v);
                    }}
                  />
                </Row>
              </section>
              <section className="sset">
                <h2>History</h2>
                <Row title="Keep the last" help="Lowering it deletes the oldest entries">
                  <input
                    type="number"
                    className="mono num-in"
                    aria-label="History limit"
                    min={1}
                    max={10000}
                    value={historyText}
                    onChange={(e) => setHistoryText(e.target.value)}
                    onBlur={commitHistoryLimit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitHistoryLimit();
                    }}
                  />
                  <span className="unit">requests</span>
                </Row>
              </section>
            </>
          ) : null}

          {section === "network" ? (
            <>
              <section className="sset">
                <h2>Proxy</h2>
                <Row title="Proxy" help="Where requests leave this machine">
                  <div className="radios" role="radiogroup" aria-label="Proxy">
                    {PROXY_MODES.map(({ mode, label }) => (
                      <label key={mode} className="rd">
                        <input type="radio" name="proxyMode" checked={net.proxyMode === mode} onChange={() => update((s) => (s.network.proxyMode = mode))} />
                        {label}
                      </label>
                    ))}
                  </div>
                </Row>
                {net.proxyMode === "environment" ? (
                  <p className="sub reveal-note">Uses HTTP_PROXY, HTTPS_PROXY and NO_PROXY. The macOS system proxy setting is not read.</p>
                ) : null}
                {net.proxyMode === "custom" ? (
                  <div className="reveal">
                    <div className="field">
                      <label htmlFor="proxy-url">Proxy URL</label>
                      <input
                        id="proxy-url"
                        type="text"
                        className="mono"
                        placeholder="http://user:pass@proxy.local:8080"
                        value={net.proxyUrl}
                        onChange={(e) => update((s) => (s.network.proxyUrl = e.target.value))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="proxy-bypass">Bypass</label>
                      <input
                        id="proxy-bypass"
                        type="text"
                        className="mono"
                        placeholder="localhost, *.internal"
                        value={net.proxyBypass}
                        onChange={(e) => update((s) => (s.network.proxyBypass = e.target.value))}
                      />
                      <span className="help">Comma separated hosts that skip the proxy.</span>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="sset">
                <h2>User-Agent</h2>
                <Row
                  stack
                  title="User-Agent"
                  help="Sent when a request has no User-Agent header of its own. Used by sends, collection runs, WebSockets, and code snippets."
                >
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
                </Row>
              </section>

              <section className="sset">
                <h2>Security</h2>
                <Row title="Verify TLS certificates" help="Turn off only for local servers with self-signed certificates">
                  <Switch label="Verify TLS certificates" checked={net.verifyTls} onChange={(v) => update((s) => (s.network.verifyTls = v))} />
                </Row>
                <Row title="CA bundle" help="Extra trusted certificate authorities, PEM format">
                  {net.caFile ? (
                    <>
                      <span className="filechip" title={net.caFile}>
                        <File size={13} aria-hidden="true" />
                        {baseName(net.caFile)}
                      </span>
                      <button onClick={chooseCaFile}>Change</button>
                      <button className="ghost" onClick={() => update((s) => (s.network.caFile = ""))}>
                        Remove
                      </button>
                    </>
                  ) : (
                    <button onClick={chooseCaFile}>Choose file…</button>
                  )}
                </Row>
              </section>

              <section className="sset">
                <h2>Client certificates</h2>
                <p className="sub">PEM files only. .pfx and passphrase-protected keys are not supported.</p>
                <div className="pg-wrap">
                  <table className="pg-table cert-table">
                    <thead>
                      <tr>
                        <th className="w-var">Host</th>
                        <th>Certificate</th>
                        <th>Key</th>
                        <th className="acts" />
                      </tr>
                    </thead>
                    <tbody>
                      {net.clientCerts.map((cert, i) => (
                        <tr key={i}>
                          <td className="in">
                            <input
                              type="text"
                              className="mono"
                              aria-label="Host"
                              placeholder="api.example.com"
                              value={cert.host}
                              onChange={(e) => updateCert(i, "host", e.target.value)}
                            />
                          </td>
                          {(["certFile", "keyFile"] as const).map((field) => (
                            <td key={field} className="file">
                              <button
                                className="ghost mono"
                                title={cert[field] || undefined}
                                onClick={() => chooseCertFile(i, field)}
                              >
                                {cert[field] ? baseName(cert[field]) : <span className="subtlest">Choose file…</span>}
                              </button>
                            </td>
                          ))}
                          <td className="acts">
                            <button className="icon pg-del" onClick={() => removeCert(i)} title="Remove" aria-label="Remove certificate">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="pg-ghost" onClick={addCert}>
                        <td>
                          <button className="pg-add" aria-label="Add certificate">
                            <Plus size={13} /> Host
                          </button>
                        </td>
                        <td>Choose file…</td>
                        <td>Choose file…</td>
                        <td className="acts" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="set-foot">
                <button className="primary" disabled={saving} onClick={handleSave}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <span>Saving reconnects open connections</span>
                {error ? <span className="settings-error">{error}</span> : null}
              </div>
            </>
          ) : null}

          {section === "keyboard" ? <KeyboardSection onOpenFile={openKeybindingsFile} /> : null}

          {section === "about" ? (
            <section className="sset">
              <h2>Restly</h2>
              <p className="sub">Version and build details.</p>
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
                <Row title="Log file" help={logPath}>
                  <button onClick={showLogFile}>Show log file</button>
                </Row>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Every command grouped as in the shortcuts overlay, so settings is a second place to read them.
function KeyboardSection({ onOpenFile }: { onOpenFile: () => void }) {
  const [query, setQuery] = useState("");
  const matches = fuzzyFilter(listCommands(), query, (c) => c.title);
  const groups = new Map<string, typeof matches>();
  for (const m of matches) groups.set(m.item.group, [...(groups.get(m.item.group) ?? []), m]);
  return (
    <>
      <section className="sset">
        <h2>Customize</h2>
        <Row title="Keybindings file" help="Change any shortcut in keybindings.json. Edits apply when the window regains focus.">
          <button onClick={onOpenFile}>Open keybindings file</button>
        </Row>
        <Row title="Shortcuts overlay" help="Shows this list from anywhere in the app.">
          <Kbd command="keyboard-shortcuts" />
        </Row>
      </section>
      <section className="sset">
        <div className="skeys-head">
          <h2>Shortcuts</h2>
          <input
            type="text"
            className="skeys-filter"
            placeholder="Filter shortcuts"
            aria-label="Filter shortcuts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {groups.size === 0 ? <p className="sub">No matching shortcuts</p> : null}
        {[...groups].map(([group, list]) => (
          <div key={group} className="skeys">
            <h3>{group}</h3>
            {list.map((m) => (
              <ShortcutRow key={m.item.id} id={m.item.id} keys={effectiveKeys(m.item)} custom={isCustomized(m.item)}>
                {highlight(m.item.title, m.indices)}
              </ShortcutRow>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}
