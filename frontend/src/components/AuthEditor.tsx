import { useState } from "react";
import { CornerLeftUp, Eye, EyeOff, Info, ShieldOff } from "lucide-react";
import Select from "./Select";
import VarInput from "./VarInput";
import type { AuthValue, KV } from "../types";

interface Target {
  auth?: AuthValue;
}

interface Props {
  target: Target;
  onChange: () => void;
  // A draft has no parent to inherit auth from, so callers hide the option there.
  hideInherit?: boolean;
  // Where "inherit" resolves to; null when nothing above sets auth. Omitted where unknown.
  inherited?: { source: string; type: string } | null;
}

const KNOWN_TYPES = ["inherit", "noauth", "basic", "bearer", "apikey"] as const;

function findKV(list: KV[] | undefined, key: string): string {
  return list?.find((kv) => kv.key === key)?.value ?? "";
}

function setKV(list: KV[], key: string, value: string): KV[] {
  const existing = list.find((kv) => kv.key === key);
  if (existing) existing.value = value;
  else list.push({ key, value, type: "string" });
  return list;
}

export default function AuthEditor({ target, onChange, hideInherit, inherited }: Props) {
  const [reveal, setReveal] = useState(false);
  const type = target.auth?.type ?? (hideInherit ? "noauth" : "inherit");
  const known = (KNOWN_TYPES as readonly string[]).includes(type);

  function setType(next: string) {
    if (next === "inherit") {
      delete target.auth;
    } else if (next === "noauth") {
      target.auth = { type: "noauth" };
    } else if (next === "basic") {
      target.auth = {
        type: "basic",
        basic: [
          { key: "username", value: "", type: "string" },
          { key: "password", value: "", type: "string" },
        ],
      };
    } else if (next === "bearer") {
      target.auth = { type: "bearer", bearer: [{ key: "token", value: "", type: "string" }] };
    } else if (next === "apikey") {
      target.auth = {
        type: "apikey",
        apikey: [
          { key: "key", value: "", type: "string" },
          { key: "value", value: "", type: "string" },
          { key: "in", value: "header", type: "string" },
        ],
      };
    }
    onChange();
  }

  const description: Record<string, string> = {
    inherit: inherited
      ? `Uses the auth from ${inherited.source}: ${inherited.type}.`
      : inherited === null
        ? "No parent folder or collection sets auth, so none is sent."
        : "Uses the auth set on the parent folder or collection.",
    noauth: "No Authorization header is sent.",
    basic: "Sends the username and password as a Base64 Authorization header.",
    bearer: "Sends Authorization: Bearer <token>.",
    apikey: "Sends a key and value as a header or query parameter.",
  };
  const card = type === "inherit" || type === "noauth" || !known;
  const text = known ? description[type] : "Restly stores this auth type but does not apply it.";

  function field(label: string, list: "basic" | "bearer" | "apikey", key: string, opts: { mono?: boolean; secret?: boolean } = {}) {
    const value = findKV(target.auth?.[list], key);
    const set = (v: string) => {
      setKV((target.auth![list] ??= []), key, v);
      onChange();
    };
    return (
      <label className="auth-field">
        <span>{label}</span>
        <div className="auth-input">
          {opts.secret && !reveal ? (
            <input type="password" aria-label={label} value={value} autoComplete="off" onChange={(e) => set(e.target.value)} />
          ) : (
            <VarInput value={value} onChange={set} mono={opts.mono ?? false} />
          )}
          {opts.secret ? <RevealToggle shown={reveal} onClick={() => setReveal(!reveal)} /> : null}
        </div>
      </label>
    );
  }

  return (
    <div className="auth-editor">
      <div className="auth-side">
        <div className="auth-field">
          <span>Auth type</span>
          <Select
            value={type}
            onChange={setType}
            ariaLabel="Auth type"
            options={[
              ...(!hideInherit ? [{ value: "inherit", label: "Inherit from parent" }] : []),
              { value: "noauth", label: "No auth" },
              { value: "basic", label: "Basic auth" },
              { value: "bearer", label: "Bearer token" },
              { value: "apikey", label: "API key" },
              ...(!known ? [{ value: type, label: `${type} (unsupported)` }] : []),
            ]}
          />
        </div>
        {/* inherit, no auth and unknown types say this in the card instead */}
        {card ? null : <p className="auth-desc">{text}</p>}
      </div>

      <div className="auth-main">
        {type === "basic" ? (
          <>
            {field("Username", "basic", "username")}
            {field("Password", "basic", "password", { secret: true })}
          </>
        ) : null}

        {type === "bearer" ? field("Token", "bearer", "token", { mono: true }) : null}

        {type === "apikey" ? (
          <>
            {field("Key", "apikey", "key")}
            {field("Value", "apikey", "value", { mono: true })}
            <div className="auth-field">
              <span>Add to</span>
              <div className="segmented" role="radiogroup" aria-label="Add to">
                {(["header", "query"] as const).map((where) => (
                  <button
                    key={where}
                    type="button"
                    role="radio"
                    aria-checked={(findKV(target.auth?.apikey, "in") || "header") === where}
                    className={(findKV(target.auth?.apikey, "in") || "header") === where ? "active" : ""}
                    onClick={() => {
                      setKV((target.auth!.apikey ??= []), "in", where);
                      onChange();
                    }}
                  >
                    {where === "header" ? "Header" : "Query params"}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {card ? (
          <div className="auth-card">
            {type === "inherit" ? <CornerLeftUp size={15} strokeWidth={1.75} aria-hidden="true" /> : type === "noauth" ? <ShieldOff size={15} strokeWidth={1.75} aria-hidden="true" /> : <Info size={15} strokeWidth={1.75} aria-hidden="true" />}
            <span>{text}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RevealToggle({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button type="button" className="icon auth-reveal" title={shown ? "Hide" : "Show"} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown} onClick={onClick}>
      {shown ? <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={14} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}
