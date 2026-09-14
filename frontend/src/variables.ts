// Resolves {{name}} references against the scopes the UI can see, mirroring the
// precedence internal/vars/vars.go applies at send time (Local/Data only exist mid-run,
// so the UI has environment -> collection -> globals).
import { state, ensureEnvironment, selectedEnv } from "./store";

// Stateful (global flag): callers that need a fresh scan build `new RegExp(VARIABLE_PATTERN.source, "g")`
// rather than reusing this instance's lastIndex.
export const VARIABLE_PATTERN = /\{\{([^{}]+)\}\}/g;

const DYNAMIC_NAMES = new Set(["$guid", "$randomUUID", "$timestamp", "$isoTimestamp", "$randomInt"]);
const MAX_DEPTH = 10; // matches maxDepth in internal/vars/vars.go

export type VarScope = "environment" | "collection" | "globals" | "dynamic" | "undefined";

export interface ResolvedVariable {
  name: string;
  value: string;
  resolved: string;
  scope: VarScope;
  scopeLabel: string;
  secret: boolean;
}

interface Lookup {
  value: string;
  scope: "environment" | "collection" | "globals";
  scopeLabel: string;
  secret: boolean;
}

// Narrowest to widest: selected environment, then the active tab's collection, then globals.
function lookupDefined(name: string): Lookup | undefined {
  const env = state.environments.get(selectedEnv());
  const envValue = env?.values.find((v) => v.key === name && v.enabled !== false);
  if (env && envValue) {
    return { value: envValue.value ?? "", scope: "environment", scopeLabel: env.name, secret: envValue.type === "secret" };
  }

  const collFile = state.activeTab?.file;
  const coll = collFile ? state.collections.get(collFile) : undefined;
  const collValue = coll?.variable?.find((v) => v.key === name && !v.disabled);
  if (coll && collValue) {
    return { value: collValue.value ?? "", scope: "collection", scopeLabel: `Collection: ${coll.info.name}`, secret: false };
  }

  const globalsFile = state.workspace?.globals;
  const globals = globalsFile ? state.environments.get(globalsFile) : undefined;
  const globalsValue = globals?.values.find((v) => v.key === name && v.enabled !== false);
  if (globals && globalsValue) {
    return { value: globalsValue.value ?? "", scope: "globals", scopeLabel: "Globals", secret: globalsValue.type === "secret" };
  }

  return undefined;
}

// Expands nested {{x}} references the way Scope.Replace does in Go: repeated passes, up to
// MAX_DEPTH, so a self-referencing variable can't loop forever. Dynamic names are shown as
// the fixed placeholder text since the UI can't know the value a real send would generate.
function expand(text: string): string {
  for (let i = 0; i < MAX_DEPTH; i++) {
    if (!text.includes("{{")) return text;
    let changed = false;
    text = text.replace(new RegExp(VARIABLE_PATTERN.source, "g"), (match, name: string) => {
      const found = lookupDefined(name);
      if (found) {
        changed = true;
        return found.value;
      }
      if (DYNAMIC_NAMES.has(name)) {
        changed = true;
        return "generated when sent";
      }
      return match;
    });
    if (!changed) return text;
  }
  return text;
}

export function resolveVariable(name: string): ResolvedVariable {
  const found = lookupDefined(name);
  if (found) {
    return { name, value: found.value, resolved: expand(found.value), scope: found.scope, scopeLabel: found.scopeLabel, secret: found.secret };
  }
  if (DYNAMIC_NAMES.has(name)) {
    return { name, value: "generated when sent", resolved: "generated when sent", scope: "dynamic", scopeLabel: "Dynamic", secret: false };
  }
  return { name, value: "", resolved: "", scope: "undefined", scopeLabel: "Undefined", secret: false };
}

// Entries for autocomplete, deduped by the same precedence resolveVariable uses.
export function listVariables(): ResolvedVariable[] {
  const seen = new Set<string>();
  const out: ResolvedVariable[] = [];

  const env = state.environments.get(selectedEnv());
  for (const v of env?.values ?? []) {
    if (v.enabled === false || seen.has(v.key)) continue;
    seen.add(v.key);
    out.push({
      name: v.key,
      value: v.value ?? "",
      resolved: expand(v.value ?? ""),
      scope: "environment",
      scopeLabel: env!.name,
      secret: v.type === "secret",
    });
  }

  const collFile = state.activeTab?.file;
  const coll = collFile ? state.collections.get(collFile) : undefined;
  for (const v of coll?.variable ?? []) {
    if (v.disabled || seen.has(v.key)) continue;
    seen.add(v.key);
    out.push({
      name: v.key,
      value: v.value ?? "",
      resolved: expand(v.value ?? ""),
      scope: "collection",
      scopeLabel: `Collection: ${coll!.info.name}`,
      secret: false,
    });
  }

  const globalsFile = state.workspace?.globals;
  const globals = globalsFile ? state.environments.get(globalsFile) : undefined;
  for (const v of globals?.values ?? []) {
    if (v.enabled === false || seen.has(v.key)) continue;
    seen.add(v.key);
    out.push({
      name: v.key,
      value: v.value ?? "",
      resolved: expand(v.value ?? ""),
      scope: "globals",
      scopeLabel: "Globals",
      secret: v.type === "secret",
    });
  }

  return out;
}

let globalsRequested = false;

// Loads the globals environment once so it appears in state.environments for resolution
// and autocomplete. Safe to call from every VarInput mount: ensureEnvironment dedupes.
export function ensureGlobalsLoaded(): void {
  if (globalsRequested) return;
  const file = state.workspace?.globals;
  if (!file) return; // workspace not loaded yet; a later mount will retry
  globalsRequested = true;
  ensureEnvironment(file).catch(() => {
    globalsRequested = false;
  });
}
