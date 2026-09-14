import Select from "./Select";
import type { AuthValue, KV } from "../types";

interface Target {
  auth?: AuthValue;
}

interface Props {
  target: Target;
  onChange: () => void;
  // A draft has no parent to inherit auth from, so callers hide the option there.
  hideInherit?: boolean;
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

export default function AuthEditor({ target, onChange, hideInherit }: Props) {
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

  return (
    <div>
      <div className="field-row">
        <label>Type</label>
        <Select
          value={type}
          onChange={setType}
          ariaLabel="Auth type"
          options={[
            ...(!hideInherit ? [{ value: "inherit", label: "Inherit from parent" }] : []),
            { value: "noauth", label: "No Auth" },
            { value: "basic", label: "Basic Auth" },
            { value: "bearer", label: "Bearer Token" },
            { value: "apikey", label: "API Key" },
            ...(!known ? [{ value: type, label: `${type} (unsupported)` }] : []),
          ]}
        />
      </div>

      {!known ? (
        <div className="hint">Auth type "{type}" is kept in the file but not applied by Restly.</div>
      ) : null}

      {type === "basic" ? (
        <>
          <div className="field-row">
            <label>Username</label>
            <input
              type="text"
              value={findKV(target.auth?.basic, "username")}
              onChange={(e) => {
                setKV((target.auth!.basic ??= []), "username", e.target.value);
                onChange();
              }}
            />
          </div>
          <div className="field-row">
            <label>Password</label>
            <input
              type="password"
              value={findKV(target.auth?.basic, "password")}
              onChange={(e) => {
                setKV((target.auth!.basic ??= []), "password", e.target.value);
                onChange();
              }}
            />
          </div>
        </>
      ) : null}

      {type === "bearer" ? (
        <div className="field-row">
          <label>Token</label>
          <input
            type="text"
            className="mono"
            value={findKV(target.auth?.bearer, "token")}
            onChange={(e) => {
              setKV((target.auth!.bearer ??= []), "token", e.target.value);
              onChange();
            }}
          />
        </div>
      ) : null}

      {type === "apikey" ? (
        <>
          <div className="field-row">
            <label>Key</label>
            <input
              type="text"
              value={findKV(target.auth?.apikey, "key")}
              onChange={(e) => {
                setKV((target.auth!.apikey ??= []), "key", e.target.value);
                onChange();
              }}
            />
          </div>
          <div className="field-row">
            <label>Value</label>
            <input
              type="text"
              value={findKV(target.auth?.apikey, "value")}
              onChange={(e) => {
                setKV((target.auth!.apikey ??= []), "value", e.target.value);
                onChange();
              }}
            />
          </div>
          <div className="field-row">
            <label>Add to</label>
            <Select
              value={findKV(target.auth?.apikey, "in") || "header"}
              onChange={(v) => {
                setKV((target.auth!.apikey ??= []), "in", v);
                onChange();
              }}
              ariaLabel="Add to"
              options={[
                { value: "header", label: "Header" },
                { value: "query", label: "Query Params" },
              ]}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
