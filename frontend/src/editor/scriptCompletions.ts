// Autocomplete for the pre-request/post-response script editors. The tree below mirrors
// internal/script/pm.js member-for-member: only what that shim actually defines shows up here.
import type { Extension } from "@codemirror/state";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { javascriptLanguage } from "@codemirror/lang-javascript";

interface Member {
  type: "function" | "property" | "variable" | "namespace";
  detail?: string;
  info?: string;
  children?: Record<string, Member>;
}

// pm.environment / pm.collectionVariables / pm.globals: __makeScope(map, readonly=false).
const scope: Record<string, Member> = {
  get: { type: "function", detail: "(key: string)", info: "Read a stored value." },
  set: { type: "function", detail: "(key: string, value: unknown)" },
  unset: { type: "function", detail: "(key: string)" },
  has: { type: "function", detail: "(key: string)" },
  clear: { type: "function", detail: "()" },
  toObject: { type: "function", detail: "()" },
  replaceIn: { type: "function", detail: "(text: string)", info: "Substitute {{vars}} in a string." },
};

// __makeKVList: headers/cookies/query. cookies key off "name" instead of "key", everything
// else about the shape is the same.
function kvList(keyLabel = "key"): Record<string, Member> {
  return {
    get: { type: "function", detail: `(${keyLabel}: string)` },
    has: { type: "function", detail: `(${keyLabel}: string)` },
    add: { type: "function", detail: "(item: { key, value, disabled? })" },
    upsert: { type: "function", detail: "(item: { key, value, disabled? })" },
    remove: { type: "function", detail: `(${keyLabel}: string)` },
    toObject: { type: "function", detail: "()" },
    each: { type: "function", detail: "(fn: (item) => void)" },
    all: { type: "function", detail: "()" },
  };
}

const responseAssertions: Record<string, Member> = {
  have: {
    type: "namespace",
    children: {
      status: { type: "function", detail: "(codeOrReason: number | string)" },
      header: { type: "function", detail: "(key: string, value?: string)" },
      body: { type: "function", detail: "(text: string)" },
      jsonBody: { type: "function", detail: "()" },
    },
  },
  be: {
    type: "namespace",
    children: {
      ok: { type: "property", info: "Asserts status 200." },
      success: { type: "property", info: "Asserts a 2xx status." },
      error: { type: "property", info: "Asserts a 4xx or 5xx status." },
      clientError: { type: "property", info: "Asserts a 4xx status." },
      serverError: { type: "property", info: "Asserts a 5xx status." },
      json: { type: "property", info: "Asserts the Content-Type includes json." },
    },
  },
  not: {
    type: "namespace",
    children: {
      have: {
        type: "namespace",
        children: {
          status: { type: "function", detail: "(codeOrReason: number | string)" },
          header: { type: "function", detail: "(key: string, value?: string)" },
          body: { type: "function", detail: "(text: string)" },
        },
      },
    },
  },
};

// Children shared by pm and its restly alias (`var restly = pm;` in pm.js).
const pmMembers: Record<string, Member> = {
  environment: { type: "namespace", children: scope },
  collectionVariables: { type: "namespace", children: scope },
  globals: { type: "namespace", children: scope },
  variables: {
    type: "namespace",
    children: {
      get: { type: "function", detail: "(key: string)", info: "Reads local, then data, environment, collection, globals." },
      set: { type: "function", detail: "(key: string, value: unknown)", info: "Always writes to the local layer." },
      has: { type: "function", detail: "(key: string)" },
      toObject: { type: "function", detail: "()" },
      replaceIn: { type: "function", detail: "(text: string)" },
    },
  },
  iterationData: {
    type: "namespace",
    children: {
      get: { type: "function", detail: "(key: string)" },
      has: { type: "function", detail: "(key: string)" },
      toObject: { type: "function", detail: "()" },
    },
  },
  request: {
    type: "namespace",
    children: {
      headers: { type: "namespace", children: kvList() },
      body: { type: "property" },
      auth: { type: "property" },
      method: { type: "property", detail: "string" },
      url: {
        type: "namespace",
        children: {
          raw: { type: "property", detail: "string" },
          // Cast needed: TS contextually types an object literal's "toString" key against
          // Object.prototype.toString, which widens the "type" literal below to plain string.
          toString: { type: "function", detail: "()" } as Member,
          getHost: { type: "function", detail: "()" },
          getPath: { type: "function", detail: "()" },
          query: { type: "namespace", children: kvList() },
          toJSON: { type: "function", detail: "()" },
        },
      },
      toJSON: { type: "function", detail: "()" },
    },
  },
  response: {
    type: "namespace",
    children: {
      code: { type: "property", detail: "number" },
      status: { type: "property", detail: "string" },
      responseTime: { type: "property", detail: "number" },
      responseSize: { type: "property", detail: "number" },
      headers: { type: "namespace", children: kvList() },
      cookies: { type: "namespace", children: kvList("name") },
      text: { type: "function", detail: "()" },
      json: { type: "function", detail: "()", info: "Throws if the body isn't valid JSON." },
      to: { type: "namespace", children: responseAssertions },
    },
  },
  info: {
    type: "namespace",
    children: {
      eventName: { type: "property", detail: "string" },
      iteration: { type: "property", detail: "number" },
      iterationCount: { type: "property", detail: "number" },
      requestName: { type: "property", detail: "string" },
      requestId: { type: "property", detail: "string" },
    },
  },
  execution: {
    type: "namespace",
    children: {
      setNextRequest: { type: "function", detail: "(nameOrNull: string | null)" },
      skipRequest: { type: "function", detail: "()", info: "Only honored in pre-request scripts." },
    },
  },
  expect: { type: "function", detail: "(value: unknown, message?: string)", info: "Chai assertion, loaded lazily." },
  sendRequest: { type: "function", detail: "(request, callback?: (err, response) => void)" },
  test: { type: "function", detail: "(name: string, fn: Function)" },
};

const topLevel: Record<string, Member> = {
  restly: { type: "namespace", children: pmMembers },
  pm: { type: "namespace", children: pmMembers },
  console: { type: "namespace" },
};

function toCompletion(label: string, member: Member): Completion {
  return { label, type: member.type, detail: member.detail, info: member.info };
}

// Matches `pm.` / `restly.` followed by any number of `.member` segments and a trailing
// partial word, e.g. "restly.response.to.have.st".
const pathPattern = /(?:pm|restly)(?:\.\w+)*\.\w*$/;

function resolvePath(pathPart: string): Record<string, Member> | null {
  const segments = pathPart.split(".");
  let node: Record<string, Member> = pmMembers;
  for (let i = 1; i < segments.length; i++) {
    const member = node[segments[i]];
    if (!member?.children) return null;
    node = member.children;
  }
  return node;
}

export function scriptCompletionSource(context: CompletionContext): CompletionResult | null {
  const pathMatch = context.matchBefore(pathPattern);
  if (pathMatch) {
    const dot = pathMatch.text.lastIndexOf(".");
    const node = resolvePath(pathMatch.text.slice(0, dot));
    if (!node) return null;
    const options = Object.entries(node).map(([label, member]) => toCompletion(label, member));
    if (!options.length) return null;
    return { from: pathMatch.from + dot + 1, options };
  }

  const identMatch = context.matchBefore(/\w*$/);
  if (!identMatch || (identMatch.from === identMatch.to && !context.explicit)) return null;
  return {
    from: identMatch.from,
    options: Object.entries(topLevel).map(([label, member]) => toCompletion(label, member)),
  };
}

export const scriptCompletions: Extension[] = [javascriptLanguage.data.of({ autocomplete: scriptCompletionSource })];
