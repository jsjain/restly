// Single cast boundary between the generated Wails bindings (which return typed model
// classes we must not use, see types.ts) and our own plain-JSON types. Every function
// here is a thin wrapper: call the binding, cast the result, normalize Go nils to [].
import * as Backend from "../wailsjs/go/main/App";
import { EventsOn, EventsOff, ClipboardSetText, WindowSetBackgroundColour } from "../wailsjs/runtime/runtime";
import type {
  Workspace,
  Collection,
  Environment,
  FileRef,
  Item,
  SendInput,
  SendResult,
  RunInput,
  RunResult,
  RunSummary,
  Cookie,
  HistoryEntry,
  Settings,
  TextFile,
  WsEvent,
  AppInfo,
} from "./types";

export { EventsOn, EventsOff, ClipboardSetText };

// The native window paints this color behind the webview, visible while resizing.
export function setWindowBackground(r: number, g: number, b: number): void {
  WindowSetBackgroundColour(Math.round(r), Math.round(g), Math.round(b), 255);
}

export function getWorkspace(): Promise<Workspace> {
  return Backend.GetWorkspace() as unknown as Promise<Workspace>;
}

export function openCollection(file: string): Promise<Collection> {
  return Backend.OpenCollection(file) as unknown as Promise<Collection>;
}

export function saveCollection(file: string, coll: Collection): Promise<void> {
  return Backend.SaveCollection(file, coll as unknown as Parameters<typeof Backend.SaveCollection>[1]);
}

export function newCollection(name: string): Promise<FileRef> {
  return Backend.NewCollection(name) as unknown as Promise<FileRef>;
}

export function openEnvironment(file: string): Promise<Environment> {
  return Backend.OpenEnvironment(file) as unknown as Promise<Environment>;
}

export function saveEnvironment(file: string, env: Environment): Promise<void> {
  return Backend.SaveEnvironment(file, env as unknown as Parameters<typeof Backend.SaveEnvironment>[1]);
}

// collection is the owning collection file, "" for an environment every request can use.
export function newEnvironment(name: string, collection = ""): Promise<FileRef> {
  return Backend.NewEnvironment(name, collection) as unknown as Promise<FileRef>;
}

// Deletes without asking. Callers confirm with confirmDialog first.
export function deleteFile(file: string): Promise<void> {
  return Backend.DeleteFile(file);
}

// VS Code color themes imported into the per-machine themes folder, as raw JSON-with-comments text.
export async function listThemes(): Promise<TextFile[]> {
  return ((await Backend.ListThemes()) as unknown as TextFile[] | null) ?? [];
}

// Resolves null when the file picker is cancelled.
export function importTheme(): Promise<TextFile | null> {
  return Backend.ImportTheme() as unknown as Promise<TextFile | null>;
}

export function deleteTheme(file: string): Promise<void> {
  return Backend.DeleteTheme(file);
}

// keybindings.json from the per-machine data folder, created with a commented template when missing.
export function getKeybindings(): Promise<TextFile> {
  return Backend.GetKeybindings() as unknown as Promise<TextFile>;
}

// Opens keybindings.json in the system's default text editor.
export function openKeybindings(): Promise<void> {
  return Backend.OpenKeybindings();
}

export function quitApp(): Promise<void> {
  return Backend.QuitApp();
}

// Fires when the user tries to quit with unsaved changes. Go has already cancelled that quit.
export function onQuitRequested(cb: () => void): () => void {
  return EventsOn("app:quit-requested", cb);
}

export function importFiles(): Promise<FileRef[]> {
  return Backend.Import() as unknown as Promise<FileRef[]>;
}

export function exportFile(file: string): Promise<string> {
  return Backend.Export(file);
}

export async function send(input: SendInput): Promise<SendResult> {
  const result = (await Backend.Send(
    input as unknown as Parameters<typeof Backend.Send>[0]
  )) as unknown as SendResult;
  result.tests ??= [];
  result.console ??= [];
  result.variables ??= [];
  if (result.response) {
    result.response.header ??= [];
    result.response.cookies ??= [];
  }
  return result;
}

export function snippet(input: SendInput, lang: string): Promise<string> {
  return Backend.Snippet(input as unknown as Parameters<typeof Backend.Send>[0], lang);
}

// ParseCurl is implemented in Go concurrently with this change; until then it rejects
// with "cURL import is not implemented yet". Callers show that rejection to the user.
export async function parseCurl(command: string): Promise<Item> {
  const item = (await Backend.ParseCurl(command)) as unknown as Item;
  if (item.request) item.request.header ??= [];
  return item;
}

export function snippetLangs(): Promise<string[]> {
  return Backend.SnippetLangs();
}

export function run(input: RunInput): Promise<void> {
  return Backend.Run(input as unknown as Parameters<typeof Backend.Run>[0]);
}

export function stopRun(): Promise<void> {
  return Backend.StopRun();
}

export function saveLastBody(): Promise<string> {
  return Backend.SaveLastBody();
}

export function onRunResult(cb: (result: RunResult) => void): () => void {
  return EventsOn("run:result", (result: RunResult) => {
    result.tests ??= [];
    result.console ??= [];
    cb(result);
  });
}

export function onRunDone(cb: (summary: RunSummary) => void): () => void {
  return EventsOn("run:done", cb);
}

// The copy is made from the saved file, so save unsaved edits first.
export function duplicateCollection(file: string): Promise<FileRef> {
  return Backend.DuplicateCollection(file) as unknown as Promise<FileRef>;
}

export function setUnsaved(unsaved: boolean): Promise<void> {
  return Backend.SetUnsaved(unsaved);
}

export async function getSettings(): Promise<Settings> {
  const settings = (await Backend.GetSettings()) as unknown as Settings;
  settings.network.clientCerts ??= [];
  return settings;
}

export function saveSettings(settings: Settings): Promise<void> {
  return Backend.SaveSettings(settings as unknown as Parameters<typeof Backend.SaveSettings>[0]);
}

export function getAppInfo(): Promise<AppInfo> {
  return Backend.GetAppInfo() as unknown as Promise<AppInfo>;
}

export function pickFile(title: string): Promise<string> {
  return Backend.PickFile(title);
}

export async function listCookies(): Promise<Cookie[]> {
  return ((await Backend.ListCookies()) as unknown as Cookie[] | null) ?? [];
}

export function saveCookie(cookie: Cookie): Promise<void> {
  return Backend.SaveCookie(cookie as unknown as Parameters<typeof Backend.SaveCookie>[0]);
}

export function deleteCookie(domain: string, path: string, name: string): Promise<void> {
  return Backend.DeleteCookie(domain, path, name);
}

export function clearCookies(): Promise<void> {
  return Backend.ClearCookies();
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return ((await Backend.GetHistory()) as unknown as HistoryEntry[] | null) ?? [];
}

export function deleteHistory(id: string): Promise<void> {
  return Backend.DeleteHistory(id);
}

export function clearHistory(): Promise<void> {
  return Backend.ClearHistory();
}

// The caller picks id before connecting, so events that arrive during the handshake find their tab.
export function wsConnect(id: string, input: SendInput): Promise<void> {
  return Backend.WSConnect(id, input as unknown as Parameters<typeof Backend.WSConnect>[1]);
}

export function wsSend(id: string, message: string): Promise<void> {
  return Backend.WSSend(id, message);
}

export function wsClose(id: string): Promise<void> {
  return Backend.WSClose(id);
}

export function onWsEvent(cb: (event: WsEvent) => void): () => void {
  return EventsOn("ws:event", (event: WsEvent) => {
    event.header ??= [];
    cb(event);
  });
}

export function onHistoryAdded(cb: (entry: HistoryEntry) => void): () => void {
  return EventsOn("history:added", cb);
}
