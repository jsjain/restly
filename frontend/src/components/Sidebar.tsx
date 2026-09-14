import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Plus, Import as ImportIconGlyph, Search, ChevronRight, Folder, FolderOpen, X, MoreHorizontal, Globe } from "lucide-react";
import * as api from "../api";
import {
  state,
  ensureCollection,
  ensureEnvironment,
  getCollection,
  getEnvironment,
  toggleCollectionExpanded,
  toggleItemExpanded,
  markCollectionDirty,
  isCollectionDirty,
  openRequestTab,
  openFolderTab,
  openCollectionTab,
  openEnvironmentTab,
  openRunnerTab,
  openDraftTab,
  onItemDeleted,
  closeTabsForFile,
  refreshWorkspace,
  notifyChange,
  saveCollectionFile,
  saveEnvironmentFile,
  isEnvironmentDirty,
  remapTabsAfter,
  usableEnvs,
  deleteEnvironmentFile,
  confirmDelete,
  toast,
} from "../store";
import { itemAt } from "../tree";
import { methodClass } from "../method";
import type { FileRef, Item } from "../types";
import { isWebSocket, newWebSocketItem } from "../websocket";
import {
  duplicateItem,
  isDescendant,
  dropPosition,
  subtreeMatches,
  listMatches,
  matchesQuery,
  siblingList,
  type DropPos,
} from "../treeEdit";
import HistoryList from "./HistoryList";
import { FOCUS_SIDEBAR, FOCUS_SIDEBAR_SEARCH, FOCUS_URL, IMPORT_CURL, REVEAL_IN_SIDEBAR, TOGGLE_SIDEBAR } from "../commands";
import "../sidebarTree.css";

const PlusIcon = () => <Plus size={15} strokeWidth={1.75} aria-hidden="true" />;

const ImportIcon = () => <ImportIconGlyph size={15} strokeWidth={1.75} aria-hidden="true" />;

const SearchIcon = () => <Search size={14} strokeWidth={1.75} aria-hidden="true" />;

const ChevronRightIcon = ({ className }: { className?: string }) => (
  <ChevronRight size={12} strokeWidth={1.75} className={className} aria-hidden="true" />
);

const FolderIcon = ({ open }: { open?: boolean }) =>
  open ? <FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" /> : <Folder size={14} strokeWidth={1.75} aria-hidden="true" />;

function newRequestItem(): Item {
  return { name: "New Request", request: { method: "GET", header: [], url: { raw: "" } } };
}

function newFolderItem(): Item {
  return { name: "New Folder", item: [] };
}

interface DragTarget {
  file: string;
  path: number[]; // [] means "collection root"
}

function findName(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

// Focusing an element the frame right after un-hiding the sidebar (a state change owned by
// a different component, App) can still land before that re-render commits, while the
// sidebar is still display:none -- .focus() on a non-rendered element is a silent no-op.
// Retry across a few frames until the element is actually laid out.
function focusWhenVisible(el: HTMLInputElement | null, attempts = 10): void {
  if (!el) return;
  if (el.offsetParent !== null) {
    el.focus();
    el.select();
    return;
  }
  if (attempts <= 0) return;
  requestAnimationFrame(() => focusWhenVisible(el, attempts - 1));
}

export default function Sidebar() {
  const [view, setView] = useState<"collections" | "history">("collections");
  const [search, setSearch] = useState("");
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addingCollection, setAddingCollection] = useState(false);
  const [addingEnvironment, setAddingEnvironment] = useState(false);
  const [envSectionOpen, setEnvSectionOpen] = useState(true);
  const [newName, setNewName] = useState("");
  const [showImportCurl, setShowImportCurl] = useState(false);
  const [curlText, setCurlText] = useState("");
  const [curlError, setCurlError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [dropHint, setDropHint] = useState<{ key: string; pos: DropPos } | null>(null);
  const dragSrcRef = useRef<DragTarget | null>(null);
  const loadedForSearch = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const typeaheadRef = useRef<{ text: string; timer: number | null }>({ text: "", timer: null });

  function closeMenu() {
    setMenuKey(null);
  }

  // Menu content stops propagation on click, so any other click in the document closes it.
  useEffect(() => {
    if (!menuKey) return;
    const close = () => setMenuKey(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuKey]);

  // Commands from commands.ts: focus the search box, and reveal a request by expanding down to it.
  useEffect(() => {
    function focusSearch() {
      if (document.getElementById("app")?.classList.contains("sidebar-hidden")) {
        window.dispatchEvent(new CustomEvent(TOGGLE_SIDEBAR));
      }
      setView("collections");
      // TOGGLE_SIDEBAR's own re-render (in App, a different component) can land a frame
      // later than this one, so a single rAF can still see the sidebar as display:none --
      // in which case .focus() silently no-ops. Retry across a few frames until it's
      // actually visible.
      focusWhenVisible(searchInputRef.current);
    }
    function reveal(event: Event) {
      const { file, path } = (event as CustomEvent<{ file: string; path: number[] }>).detail;
      const coll = state.collections.get(file);
      if (!coll) return;
      setView("collections");
      setSearch("");
      state.expandedCollections.add(file);
      for (let depth = 1; depth < path.length; depth++) {
        const folder = itemAt(coll, path.slice(0, depth));
        if (folder) state.expandedItems.add(folder);
      }
      notifyChange();
      const rowKey = CSS.escape(`item:${file}:${path.join(",")}`);
      requestAnimationFrame(() => document.querySelector(`[data-row-key="${rowKey}"]`)?.scrollIntoView({ block: "center" }));
    }
    function importCurl() {
      setCurlText("");
      setCurlError("");
      setShowImportCurl(true);
    }
    window.addEventListener(FOCUS_SIDEBAR_SEARCH, focusSearch);
    window.addEventListener(REVEAL_IN_SIDEBAR, reveal);
    window.addEventListener(IMPORT_CURL, importCurl);
    return () => {
      window.removeEventListener(FOCUS_SIDEBAR_SEARCH, focusSearch);
      window.removeEventListener(REVEAL_IN_SIDEBAR, reveal);
      window.removeEventListener(IMPORT_CURL, importCurl);
    };
  }, []);

  // FOCUS_SIDEBAR (bound to Cmd+Shift+E / Cmd+0 elsewhere): reveal the sidebar if hidden,
  // switch to Collections, and move keyboard focus to the active request's row, or the first
  // row if the active request isn't visible (e.g. its collection is collapsed).
  useEffect(() => {
    function onFocusSidebar() {
      if (document.getElementById("app")?.classList.contains("sidebar-hidden")) {
        window.dispatchEvent(new CustomEvent(TOGGLE_SIDEBAR));
      }
      setView("collections");
      requestAnimationFrame(() => {
        const rows = treeRows();
        if (rows.length === 0) return;
        const tab = state.activeTab;
        const activeKey = tab?.kind === "request" ? `item:${tab.file}:${tab.path.join(",")}` : null;
        const target = (activeKey && rows.find((r) => r.dataset.rowKey === activeKey)) || rows[0];
        focusRowEl(target);
      });
    }
    window.addEventListener(FOCUS_SIDEBAR, onFocusSidebar);
    return () => window.removeEventListener(FOCUS_SIDEBAR, onFocusSidebar);
  }, []);

  // Roving tabindex needs exactly one row reachable by Tab even before any arrow key is
  // pressed; give that stop to the first row once the workspace has actually loaded (before
  // that, the tree only contains the Environments header, which would otherwise "win" the
  // default focus permanently).
  useEffect(() => {
    if (focusedKey !== null || !state.workspace) return;
    const id = requestAnimationFrame(() => {
      const first = treeRows()[0];
      if (first) setFocusedKey(first.dataset.rowKey ?? null);
    });
    return () => cancelAnimationFrame(id);
  });

  // The first time the search box becomes non-empty, load every collection so matches can
  // be found even in collections that were never expanded.
  useEffect(() => {
    const empty = search.trim() === "";
    if (empty) {
      loadedForSearch.current = false;
      return;
    }
    if (loadedForSearch.current) return;
    loadedForSearch.current = true;
    for (const ref of state.workspace?.collections ?? []) {
      ensureCollection(ref.file).catch((err) => toast(String(err), "error"));
    }
  }, [search]);

  function startRename(key: string, initial: string) {
    setRenameKey(key);
    setRenameValue(initial);
    setMenuKey(null);
  }

  async function submitNewCollection() {
    const name = newName.trim();
    setAddingCollection(false);
    setNewName("");
    if (!name) return;
    try {
      await api.newCollection(name);
      await refreshWorkspace();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function submitNewEnvironment() {
    const name = newName.trim();
    setAddingEnvironment(false);
    setNewName("");
    if (!name) return;
    try {
      await api.newEnvironment(name);
      await refreshWorkspace();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function handleImport() {
    closeMenu();
    try {
      await api.importFiles();
    } catch (err) {
      toast(String(err), "error");
    } finally {
      await refreshWorkspace();
    }
  }

  useEffect(() => {
    if (!showImportCurl) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowImportCurl(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showImportCurl]);

  async function handleImportCurl() {
    try {
      const item = await api.parseCurl(curlText);
      // Go names it "GET /path", which repeats the tab's method badge. Unnamed, it is called host and path.
      item.name = "";
      // The draft only exists in memory: without draftDirty, closing the tab would silently
      // discard the imported request instead of asking to save it.
      const tab = openDraftTab(item);
      tab.draftDirty = true;
      notifyChange();
      setShowImportCurl(false);
      setCurlText("");
      setCurlError("");
    } catch (err) {
      setCurlError(String(err));
    }
  }

  async function handleDeleteCollection(file: string) {
    closeMenu();
    if (!(await confirmDelete(getCollection(file)?.info.name ?? findName(file)))) return;
    try {
      await api.deleteFile(file);
      state.collections.delete(file);
      state.dirtyCollections.delete(file);
      closeTabsForFile(file, "request");
      closeTabsForFile(file, "collection");
      closeTabsForFile(file, "folder");
      closeTabsForFile(file, "runner");
      await refreshWorkspace();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function handleDeleteEnvironment(file: string) {
    closeMenu();
    if (!(await confirmDelete(getEnvironment(file)?.name ?? findName(file)))) return;
    try {
      await deleteEnvironmentFile(file);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function handleExportCollection(file: string) {
    closeMenu();
    try {
      if (isCollectionDirty(file)) await saveCollectionFile(file);
      const path = await api.exportFile(file);
      if (path) toast(`Exported to ${path}`);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function handleDuplicateCollection(file: string) {
    closeMenu();
    try {
      if (isCollectionDirty(file)) await saveCollectionFile(file);
      const ref = await api.duplicateCollection(file);
      await refreshWorkspace();
      toast(`Cloned to ${ref.name}`);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function handleExportEnvironment(file: string) {
    closeMenu();
    try {
      if (isEnvironmentDirty(file)) await saveEnvironmentFile(file);
      const path = await api.exportFile(file);
      if (path) toast(`Exported to ${path}`);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function addChild(file: string, path: number[], child: Item) {
    closeMenu();
    try {
      const coll = await ensureCollection(file);
      const parent = path.length === 0 ? coll : itemAt(coll, path);
      if (!parent) return;
      parent.item ??= [];
      parent.item.push(child);
      markCollectionDirty(file);
      if (path.length === 0) state.expandedCollections.add(file);
      else state.expandedItems.add(parent as Item);
      notifyChange();
    } catch (err) {
      toast(String(err), "error");
    }
  }

  function deleteItem(file: string, path: number[]) {
    closeMenu();
    const coll = getCollection(file);
    if (!coll) return;
    const list = siblingList(coll, path);
    list?.splice(path[path.length - 1], 1);
    markCollectionDirty(file);
    onItemDeleted(file, path);
  }

  // Requests and folders confirm before deleting (collections already confirm inside
  // handleDeleteCollection); used from both the row menu and the keyboard Delete key.
  async function requestDeleteItem(file: string, path: number[], name: string) {
    closeMenu();
    if (!(await confirmDelete(name))) return;
    deleteItem(file, path);
  }

  function duplicateRow(file: string, path: number[]) {
    closeMenu();
    const coll = getCollection(file);
    if (!coll) return;
    const list = siblingList(coll, path);
    if (!list) return;
    const idx = path[path.length - 1];
    const copy = duplicateItem(list[idx]);
    remapTabsAfter(() => {
      list.splice(idx + 1, 0, copy);
    });
    markCollectionDirty(file);
  }

  // --- drag and drop ---

  function handleDragStart(e: DragEvent<HTMLDivElement>, file: string, path: number[]) {
    // WebKit refuses to start a drag unless data is set, even though we read the source
    // back from the ref below rather than from dataTransfer.
    e.dataTransfer.setData("text/plain", JSON.stringify({ file, path }));
    e.dataTransfer.effectAllowed = "move";
    dragSrcRef.current = { file, path };
    setDragActive(true);
  }

  function handleDragEnd() {
    dragSrcRef.current = null;
    setDragActive(false);
    setDropHint(null);
  }

  function updateDropHint(key: string, pos: DropPos) {
    setDropHint((h) => (h?.key === key && h.pos === pos ? h : { key, pos }));
  }

  async function handleDropOn(target: DragTarget, pos: DropPos) {
    const src = dragSrcRef.current;
    dragSrcRef.current = null;
    setDragActive(false);
    setDropHint(null);
    if (!src) return;

    const srcColl = getCollection(src.file);
    if (!srcColl) return;
    const srcItem = itemAt(srcColl, src.path);
    if (!srcItem) return;

    let dstColl;
    try {
      dstColl = await ensureCollection(target.file);
    } catch (err) {
      toast(String(err), "error");
      return;
    }

    const targetItem = target.path.length ? itemAt(dstColl, target.path) : undefined;
    // Covers both: forbid dropping a folder into itself/its own descendants, and no-op a
    // drop directly onto the dragged row itself (isDescendant(x, x) is true).
    if (targetItem && isDescendant(srcItem, targetItem)) return;

    let targetParentList: Item[] | undefined;
    let targetIndexInParent = -1;
    let targetParentItem: Item | undefined;
    if (pos !== "into") {
      targetParentList = siblingList(dstColl, target.path);
      if (!targetParentList) return;
      targetIndexInParent = target.path[target.path.length - 1];
      targetParentItem = target.path.length > 1 ? itemAt(dstColl, target.path.slice(0, -1)) : undefined;
    }

    remapTabsAfter(() => {
      const srcList = siblingList(srcColl, src.path);
      if (!srcList) return;
      const srcIndex = src.path[src.path.length - 1];
      srcList.splice(srcIndex, 1);

      if (pos === "into") {
        const dstList = targetItem ? (targetItem.item ??= []) : dstColl.item;
        dstList.push(srcItem);
      } else {
        const dstList = targetParentList!;
        const sameList = dstList === srcList;
        let idx = targetIndexInParent;
        if (sameList && srcIndex < idx) idx -= 1;
        dstList.splice(pos === "before" ? idx : idx + 1, 0, srcItem);
      }
    });

    markCollectionDirty(src.file);
    if (target.file !== src.file) markCollectionDirty(target.file);

    const container = pos === "into" ? targetItem : targetParentItem;
    if (container) state.expandedItems.add(container);
    else state.expandedCollections.add(target.file);
    notifyChange();
  }

  // --- keyboard navigation (VS Code style tree) ---
  // Delegated on the tree container: every row carries data-row-key/data-kind/data-file/
  // data-path/data-name/data-expanded, which is enough to move focus and act without
  // threading per-row callbacks through every level of the recursive tree.

  function treeRows(): HTMLElement[] {
    return Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
  }

  function focusRowEl(el: HTMLElement | null | undefined) {
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "nearest" });
  }

  function focusRowByKey(key: string) {
    focusRowEl(treeRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`));
  }

  function pathOf(el: HTMLElement): number[] {
    const p = el.dataset.path ?? "";
    return p ? p.split(",").map(Number) : [];
  }

  function folderItem(el: HTMLElement): Item | undefined {
    const file = el.dataset.file;
    const coll = file ? getCollection(file) : undefined;
    return coll ? itemAt(coll, pathOf(el)) : undefined;
  }

  // The parent of a request/folder is its containing folder row, or the collection row if
  // it's top-level; the parent of an environment/globals row is the Environments header.
  function parentKeyOf(el: HTMLElement): string | null {
    const kind = el.dataset.kind;
    if (kind === "env" || kind === "globals") return "env-header";
    const file = el.dataset.file;
    if (!file) return null;
    const path = pathOf(el);
    return path.length <= 1 ? `coll:${file}` : `item:${file}:${path.slice(0, -1).join(",")}`;
  }

  // Enter: opens the row (request tab, collection overview, folder toggle) -- unlike arrow
  // expand/collapse below, this intentionally also opens the collection's overview tab, to
  // match the existing mouse-click behavior in CollectionNode.handleToggle.
  function activateRow(el: HTMLElement) {
    const kind = el.dataset.kind;
    const file = el.dataset.file ?? "";
    if (kind === "collection") {
      toggleCollectionExpanded(file);
      openCollectionTab(file);
      if (state.expandedCollections.has(file)) ensureCollection(file).catch((err) => toast(String(err), "error"));
      notifyChange();
    } else if (kind === "folder") {
      const item = folderItem(el);
      if (item) {
        toggleItemExpanded(item);
        notifyChange();
      }
    } else if (kind === "request") {
      openRequestTab(file, pathOf(el));
    } else if (kind === "env-header") {
      setEnvSectionOpen((o) => !o);
    } else if (kind === "globals" || kind === "env") {
      ensureEnvironment(file).catch((err) => toast(String(err), "error"));
      openEnvironmentTab(file);
    }
  }

  // Right arrow: expands a collapsed collection/folder/section without opening any tab, or
  // moves to the first child if already expanded (which, in DOM order, is always the next row).
  function expandRow(el: HTMLElement, rows: HTMLElement[], idx: number) {
    const kind = el.dataset.kind;
    const file = el.dataset.file ?? "";
    if (kind === "collection") {
      if (el.dataset.expanded !== "true") {
        state.expandedCollections.add(file);
        ensureCollection(file).catch((err) => toast(String(err), "error"));
        notifyChange();
      } else if ((getCollection(file)?.item.length ?? 0) > 0) {
        focusRowEl(rows[idx + 1]);
      }
    } else if (kind === "folder") {
      const item = folderItem(el);
      if (!item) return;
      if (!state.expandedItems.has(item)) {
        state.expandedItems.add(item);
        notifyChange();
      } else if ((item.item?.length ?? 0) > 0) {
        focusRowEl(rows[idx + 1]);
      }
    } else if (kind === "env-header") {
      if (!envSectionOpen) setEnvSectionOpen(true);
      else focusRowEl(rows[idx + 1]);
    }
  }

  // Left arrow: collapses an expanded collection/folder/section in place, otherwise moves to
  // the parent row.
  function collapseRow(el: HTMLElement) {
    const kind = el.dataset.kind;
    const file = el.dataset.file ?? "";
    if (kind === "collection") {
      if (el.dataset.expanded === "true") {
        state.expandedCollections.delete(file);
        notifyChange();
      }
    } else if (kind === "folder") {
      const item = folderItem(el);
      if (item && state.expandedItems.has(item)) {
        state.expandedItems.delete(item);
        notifyChange();
      } else {
        const pk = parentKeyOf(el);
        if (pk) focusRowByKey(pk);
      }
    } else if (kind === "env-header") {
      if (envSectionOpen) setEnvSectionOpen(false);
    } else {
      const pk = parentKeyOf(el);
      if (pk) focusRowByKey(pk);
    }
  }

  async function deleteRow(el: HTMLElement) {
    const kind = el.dataset.kind;
    const file = el.dataset.file ?? "";
    if (kind === "collection") {
      await handleDeleteCollection(file);
    } else if (kind === "env") {
      await handleDeleteEnvironment(file);
    } else if (kind === "folder" || kind === "request") {
      await requestDeleteItem(file, pathOf(el), el.dataset.name ?? "");
    }
  }

  // Type-ahead: buffers typed characters for 500ms and jumps to the next row (wrapping)
  // whose name starts with the buffer, like VS Code's tree.
  function handleTreeTypeahead(char: string, rows: HTMLElement[], idx: number) {
    const buf = typeaheadRef.current;
    if (buf.timer) window.clearTimeout(buf.timer);
    buf.text += char.toLowerCase();
    buf.timer = window.setTimeout(() => {
      buf.text = "";
      buf.timer = null;
    }, 500);
    for (let step = 1; step <= rows.length; step++) {
      const candidate = rows[(idx + step) % rows.length];
      if ((candidate.dataset.name ?? "").toLowerCase().startsWith(buf.text)) {
        focusRowEl(candidate);
        return;
      }
    }
  }

  function handleTreeKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const targetEl = e.target as HTMLElement;
    if (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA") return; // renaming, let the input handle its own keys
    const row = targetEl.closest<HTMLElement>('[role="treeitem"]');
    // Keys on the row's own ⋯ button or its open menu belong to those controls, or Enter would open the row instead.
    if (!row || row !== targetEl) return;
    const rows = treeRows();
    const idx = rows.indexOf(row);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRowEl(rows[idx + 1]);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (idx === 0) searchInputRef.current?.focus();
        else focusRowEl(rows[idx - 1]);
        break;
      case "Home":
        e.preventDefault();
        focusRowEl(rows[0]);
        break;
      case "End":
        e.preventDefault();
        focusRowEl(rows[rows.length - 1]);
        break;
      case "PageDown":
        e.preventDefault();
        focusRowEl(rows[Math.min(rows.length - 1, idx + 10)]);
        break;
      case "PageUp":
        e.preventDefault();
        focusRowEl(rows[Math.max(0, idx - 10)]);
        break;
      case "ArrowRight":
        e.preventDefault();
        expandRow(row, rows, idx);
        break;
      case "ArrowLeft":
        e.preventDefault();
        collapseRow(row);
        break;
      case "Enter":
        e.preventDefault();
        activateRow(row);
        break;
      case " ":
        if (row.dataset.kind === "request") {
          e.preventDefault();
          activateRow(row);
        }
        break;
      case "F2": {
        const kind = row.dataset.kind;
        if (kind === "collection" || kind === "folder" || kind === "request") {
          e.preventDefault();
          startRename(row.dataset.rowKey!, row.dataset.name ?? "");
        }
        break;
      }
      case "Delete":
        e.preventDefault();
        void deleteRow(row);
        break;
      case "Backspace":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          void deleteRow(row);
        }
        break;
      case "Escape":
        e.preventDefault();
        if (state.activeTab?.kind === "request") window.dispatchEvent(new CustomEvent(FOCUS_URL));
        else row.blur();
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          handleTreeTypeahead(e.key, rows, idx);
        }
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-actions">
        <div className="menu-anchor">
          <button
            className="icon"
            title="New"
            aria-label="New"
            onClick={(e) => {
              e.stopPropagation();
              setMenuKey(menuKey === "new" ? null : "new");
            }}
          >
            <PlusIcon />
          </button>
          {menuKey === "new" ? (
            <div className="menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { closeMenu(); openDraftTab(); }}>HTTP Request</button>
              <button onClick={() => { closeMenu(); openDraftTab(newWebSocketItem()); }}>WebSocket Request</button>
              <button onClick={() => { closeMenu(); setAddingCollection(true); }}>Collection</button>
            </div>
          ) : null}
        </div>
        <div className="menu-anchor">
          <button
            className="icon"
            title="Import"
            aria-label="Import"
            onClick={(e) => {
              e.stopPropagation();
              setMenuKey(menuKey === "import" ? null : "import");
            }}
          >
            <ImportIcon />
          </button>
          {menuKey === "import" ? (
            <div className="menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={handleImport}>Postman files</button>
              <button
                onClick={() => {
                  closeMenu();
                  setCurlText("");
                  setCurlError("");
                  setShowImportCurl(true);
                }}
              >
                cURL
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="sidebar-view-switch">
        <div className="segmented">
          <button className={view === "collections" ? "active" : ""} onClick={() => setView("collections")}>
            Collections
          </button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
            History
          </button>
        </div>
      </div>
      <div className="sidebar-search">
        <span className="sidebar-search-icon">
          <SearchIcon />
        </span>
        <input
          ref={searchInputRef}
          type="text"
          placeholder={view === "history" ? "Search history" : "Search collections"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearch("");
            if (e.key === "ArrowDown" && view === "collections") {
              e.preventDefault();
              // While searching, skip the collection headers and land on the first matching request.
              const rows = treeRows();
              focusRowEl((search.trim() ? rows.find((r) => r.dataset.kind === "request") : undefined) ?? rows[0]);
            }
            if (e.key === "Enter" && view === "collections" && search.trim()) {
              e.preventDefault();
              const firstRequest = treeRows().find((r) => r.dataset.kind === "request");
              if (firstRequest) openRequestTab(firstRequest.dataset.file ?? "", pathOf(firstRequest));
            }
          }}
        />
        {search ? (
          <button className="icon" title="Clear search" onClick={() => setSearch("")}>
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {/* Portaled so Cmd+O still shows it while the sidebar is hidden with display: none. */}
      {showImportCurl ? createPortal(
        <div className="modal-overlay" onClick={() => setShowImportCurl(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Import cURL</div>
            <textarea
              autoFocus
              className="mono curl-textarea"
              placeholder="curl https://example.com"
              value={curlText}
              onChange={(e) => setCurlText(e.target.value)}
            />
            {curlError ? <div className="hint" style={{ color: "var(--danger)" }}>{curlError}</div> : null}
            <div className="modal-actions">
              <button onClick={() => setShowImportCurl(false)}>Cancel</button>
              <button className="primary" onClick={handleImportCurl}>
                Import
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
      <div className="sidebar-scroll">
        {view === "history" ? (
          <HistoryList search={search} menuKey={menuKey} setMenuKey={setMenuKey} />
        ) : (
          <div className="sidebar-tree" role="tree" aria-label="Collections" ref={treeRef} onKeyDown={handleTreeKeyDown}>
           <div className="sidebar-collections">
            {addingCollection ? (
              <div className="inline-input">
                <input
                  autoFocus
                  type="text"
                  placeholder="Collection name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewCollection();
                    if (e.key === "Escape") setAddingCollection(false);
                  }}
                />
              </div>
            ) : null}

            {(state.workspace?.collections ?? []).map((ref) => (
              <CollectionNode
                key={ref.file}
                fileRef={ref}
                menuKey={menuKey}
                setMenuKey={setMenuKey}
                renameKey={renameKey}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                startRename={startRename}
                closeMenu={closeMenu}
                setRenameKey={setRenameKey}
                addChild={addChild}
                deleteItem={requestDeleteItem}
                duplicateRow={duplicateRow}
                search={search}
                dragActive={dragActive}
                dropHint={dropHint}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                updateDropHint={updateDropHint}
                onDropRow={handleDropOn}
                onExport={handleExportCollection}
                onDuplicate={handleDuplicateCollection}
                onDelete={handleDeleteCollection}
                focusedKey={focusedKey}
                onRowFocus={setFocusedKey}
              />
            ))}
           </div>

           <div className="sidebar-env-section">
            <div
              className="sidebar-collapsible-header"
              role="treeitem"
              aria-level={1}
              aria-expanded={envSectionOpen}
              data-row-key="env-header"
              data-kind="env-header"
              data-name="Environments"
              tabIndex={focusedKey === "env-header" ? 0 : -1}
              onFocus={() => setFocusedKey("env-header")}
              onClick={() => setEnvSectionOpen((o) => !o)}
            >
              <span className={`chevron${envSectionOpen ? " expanded" : ""}`}>
                <ChevronRightIcon />
              </span>
              <span className="label">Environments</span>
              <button
                className="icon"
                title="New environment"
                aria-label="New environment"
                onClick={(e) => {
                  e.stopPropagation();
                  setEnvSectionOpen(true);
                  setAddingEnvironment(true);
                }}
              >
                <PlusIcon />
              </button>
            </div>
            {envSectionOpen ? (
              <div className="sidebar-env-list">
                {state.workspace?.globals ? (
                  <div
                    className="tree-row"
                    role="treeitem"
                    aria-level={2}
                    data-row-key="globals"
                    data-kind="globals"
                    data-file={state.workspace.globals}
                    data-name="Globals"
                    tabIndex={focusedKey === "globals" ? 0 : -1}
                    onFocus={() => setFocusedKey("globals")}
                    onClick={() => {
                      const globals = state.workspace!.globals;
                      ensureEnvironment(globals).catch((e) => toast(String(e), "error"));
                      openEnvironmentTab(globals);
                    }}
                  >
                    <span className="caret" />
                    <span className="row-icon">
                      <Globe size={14} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className="name">Globals</span>
                  </div>
                ) : null}
                {addingEnvironment ? (
                  <div className="inline-input">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Environment name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitNewEnvironment();
                        if (e.key === "Escape") setAddingEnvironment(false);
                      }}
                    />
                  </div>
                ) : null}
                {usableEnvs("")
                  .filter((ref) => {
                    const q = search.trim().toLowerCase();
                    if (!q) return true;
                    return (getEnvironment(ref.file)?.name ?? ref.name).toLowerCase().includes(q);
                  })
                  .map((ref) => {
                    const key = `env:${ref.file}`;
                    return (
                      <div
                        className="tree-row"
                        key={ref.file}
                        role="treeitem"
                        aria-level={2}
                        data-row-key={key}
                        data-kind="env"
                        data-file={ref.file}
                        data-name={getEnvironment(ref.file)?.name ?? ref.name}
                        tabIndex={focusedKey === key ? 0 : -1}
                        onFocus={() => setFocusedKey(key)}
                        onClick={() => { ensureEnvironment(ref.file).catch((e) => toast(String(e), "error")); openEnvironmentTab(ref.file); }}
                      >
                        <span className="caret" />
                        <span className="row-icon">
                          <Globe size={14} strokeWidth={1.75} aria-hidden="true" />
                        </span>
                        <span className="name">{getEnvironment(ref.file)?.name ?? ref.name}</span>
                        <button
                          className={`icon menu-btn${menuKey === key ? " menu-open" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuKey(menuKey === key ? null : key);
                          }}
                        >
                          <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        {menuKey === key ? (
                          <div className="menu" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => handleExportEnvironment(ref.file)}>Export</button>
                            <button onClick={() => handleDeleteEnvironment(ref.file)}>Delete</button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            ) : null}
           </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface NodeShared {
  menuKey: string | null;
  setMenuKey: (k: string | null) => void;
  renameKey: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  startRename: (key: string, initial: string) => void;
  closeMenu: () => void;
  setRenameKey: (k: string | null) => void;
  addChild: (file: string, path: number[], child: Item) => void;
  deleteItem: (file: string, path: number[], name: string) => void;
  duplicateRow: (file: string, path: number[]) => void;
  search: string;
  dragActive: boolean;
  dropHint: { key: string; pos: DropPos } | null;
  onDragStart: (e: DragEvent<HTMLDivElement>, file: string, path: number[]) => void;
  onDragEnd: () => void;
  updateDropHint: (key: string, pos: DropPos) => void;
  onDropRow: (target: DragTarget, pos: DropPos) => void;
  focusedKey: string | null;
  onRowFocus: (key: string) => void;
}

function CollectionNode(
  props: NodeShared & {
    fileRef: FileRef;
    onExport: (file: string) => void;
    onDuplicate: (file: string) => void;
    onDelete: (file: string) => void;
  }
) {
  const {
    fileRef,
    menuKey,
    setMenuKey,
    renameKey,
    renameValue,
    setRenameValue,
    startRename,
    closeMenu,
    setRenameKey,
    addChild,
    deleteItem,
    duplicateRow,
    search,
    dragActive,
    dropHint,
    onDragStart,
    onDragEnd,
    updateDropHint,
    onDropRow,
    onExport,
    onDuplicate,
    onDelete,
    focusedKey,
    onRowFocus,
  } = props;
  const shared: NodeShared = {
    menuKey,
    setMenuKey,
    renameKey,
    renameValue,
    setRenameValue,
    startRename,
    closeMenu,
    setRenameKey,
    addChild,
    deleteItem,
    duplicateRow,
    search,
    dragActive,
    dropHint,
    onDragStart,
    onDragEnd,
    updateDropHint,
    onDropRow,
    focusedKey,
    onRowFocus,
  };
  const file = fileRef.file;
  const key = `coll:${file}`;
  const expanded = state.expandedCollections.has(file);
  const coll = getCollection(file);
  const dirty = isCollectionDirty(file);
  const renaming = renameKey === key;
  const query = search.trim().toLowerCase();
  const searching = query !== "";
  const isActiveRow = state.activeTab?.kind === "collection" && state.activeTab.file === file;
  // A collection whose own name matches shows all of its requests.
  const nameMatches = searching && matchesQuery(query, coll?.info.name ?? fileRef.name);

  if (searching && !nameMatches && !listMatches(coll?.item, query)) return null;

  // Like Postman, clicking a collection also opens its overview.
  async function handleToggle() {
    toggleCollectionExpanded(file);
    openCollectionTab(file);
    if (!expanded) {
      try {
        await ensureCollection(file);
      } catch (err) {
        toast(String(err), "error");
      }
    }
  }

  function commitRename() {
    setRenameKey(null);
    const name = renameValue.trim();
    if (!name) return;
    ensureCollection(file).then((c) => {
      c.info.name = name;
      markCollectionDirty(file);
    });
  }

  const dropClass = dragActive && dropHint?.key === key && dropHint.pos === "into" ? " drop-into" : "";

  return (
    <>
      <div
        className={`tree-row${dropClass}`}
        role="treeitem"
        aria-level={1}
        aria-expanded={expanded || searching}
        aria-selected={isActiveRow}
        data-row-key={key}
        data-kind="collection"
        data-file={file}
        data-name={coll?.info.name ?? fileRef.name}
        data-expanded={expanded || searching}
        tabIndex={focusedKey === key ? 0 : -1}
        onFocus={() => onRowFocus(key)}
        onClick={renaming ? undefined : handleToggle}
        onDragOver={(e) => {
          if (!dragActive) return;
          e.preventDefault();
          updateDropHint(key, "into");
        }}
        onDrop={(e) => {
          if (!dragActive) return;
          e.preventDefault();
          onDropRow({ file, path: [] }, "into");
        }}
      >
        <span className={`caret${expanded || searching ? " expanded" : ""}`}>
          <ChevronRightIcon />
        </span>
        <span className="row-icon">
          <FolderIcon open={expanded || searching} />
        </span>
        {renaming ? (
          <input
            autoFocus
            className="name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenameKey(null);
            }}
          />
        ) : (
          <span className="name">{coll?.info.name ?? fileRef.name}</span>
        )}
        {dirty ? <span className="dot" /> : null}
        <button
          className={`icon menu-btn${menuKey === key ? " menu-open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuKey(menuKey === key ? null : key);
          }}
        >
          <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {menuKey === key ? (
          <div className="menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => addChild(file, [], newRequestItem())}>Add Request</button>
            <button onClick={() => addChild(file, [], newWebSocketItem())}>Add WebSocket</button>
            <button onClick={() => addChild(file, [], newFolderItem())}>Add Folder</button>
            <button onClick={() => startRename(key, coll?.info.name ?? fileRef.name)}>Rename</button>
            <button
              onClick={() => {
                closeMenu();
                openRunnerTab(file, []);
              }}
            >
              Run
            </button>
            <button
              onClick={() => {
                closeMenu();
                openCollectionTab(file);
              }}
            >
              Overview
            </button>
            <button
              onClick={() => {
                closeMenu();
                openCollectionTab(file, "environments");
              }}
            >
              Environments
            </button>
            <button onClick={() => onDuplicate(file)}>Clone</button>
            <button onClick={() => onExport(file)}>Export</button>
            <button onClick={() => onDelete(file)}>Delete</button>
          </div>
        ) : null}
      </div>
      {(expanded || searching) && coll
        ? coll.item.map((child, i) =>
            searching && !nameMatches && !subtreeMatches(child, query) ? null : (
              <ItemRow key={i} file={file} path={[i]} item={child} depth={1} {...shared} />
            )
          )
        : null}
    </>
  );
}

function ItemRow(props: NodeShared & { file: string; path: number[]; item: Item; depth: number }) {
  const {
    file,
    path,
    item,
    depth,
    menuKey,
    setMenuKey,
    renameKey,
    renameValue,
    setRenameValue,
    startRename,
    closeMenu,
    setRenameKey,
    addChild,
    deleteItem,
    duplicateRow,
    search,
    dragActive,
    dropHint,
    onDragStart,
    onDragEnd,
    updateDropHint,
    onDropRow,
    focusedKey,
    onRowFocus,
  } = props;
  const shared: NodeShared = {
    menuKey,
    setMenuKey,
    renameKey,
    renameValue,
    setRenameValue,
    startRename,
    closeMenu,
    setRenameKey,
    addChild,
    deleteItem,
    duplicateRow,
    search,
    dragActive,
    dropHint,
    onDragStart,
    onDragEnd,
    updateDropHint,
    onDropRow,
    focusedKey,
    onRowFocus,
  };
  const isFolder = item.request == null;
  const key = `item:${file}:${path.join(",")}`;
  const query = search.trim().toLowerCase();
  const searching = query !== "";
  const expanded = searching ? true : state.expandedItems.has(item);
  const renaming = renameKey === key;
  const activeTab = state.activeTab;
  const isActiveRow = activeTab?.kind === "request" && activeTab.file === file && activeTab.path.join(",") === path.join(",");

  function commitRename() {
    setRenameKey(null);
    const name = renameValue.trim();
    if (!name) return;
    item.name = name;
    markCollectionDirty(file);
  }

  function handleClick() {
    if (renaming) return;
    if (isFolder) toggleItemExpanded(item);
    else openRequestTab(file, path);
  }

  const dropClass = dragActive && dropHint?.key === key ? ` drop-${dropHint.pos}` : "";

  return (
    <>
      <div
        className={`tree-row${dropClass}${isActiveRow ? " active" : ""}`}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isFolder ? expanded : undefined}
        aria-selected={isActiveRow}
        data-row-key={key}
        data-kind={isFolder ? "folder" : "request"}
        data-file={file}
        data-path={path.join(",")}
        data-name={item.name}
        data-expanded={isFolder ? expanded : undefined}
        tabIndex={focusedKey === key ? 0 : -1}
        onFocus={() => onRowFocus(key)}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
        draggable={!renaming}
        onDragStart={(e) => onDragStart(e, file, path)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (!dragActive) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          updateDropHint(key, dropPosition(e.clientY, rect, isFolder));
        }}
        onDrop={(e) => {
          if (!dragActive) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          onDropRow({ file, path }, dropPosition(e.clientY, rect, isFolder));
        }}
      >
        {isFolder ? (
          <>
            <span className={`caret${expanded ? " expanded" : ""}`}>
              <ChevronRightIcon />
            </span>
            <span className="row-icon">
              <FolderIcon open={expanded} />
            </span>
          </>
        ) : (
          <span className="caret" />
        )}
        {!isFolder ? (
          isWebSocket(item) ? (
            <span className="method-badge method-ws">WS</span>
          ) : (
            <span className={`method-badge method-${methodClass(item.request!.method)}`}>{item.request!.method}</span>
          )
        ) : null}
        {renaming ? (
          <input
            autoFocus
            className="name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenameKey(null);
            }}
          />
        ) : (
          <span className="name">{item.name}</span>
        )}
        <button
          className={`icon menu-btn${menuKey === key ? " menu-open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuKey(menuKey === key ? null : key);
          }}
        >
          <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {menuKey === key ? (
          <div className="menu" onClick={(e) => e.stopPropagation()}>
            {isFolder ? <button onClick={() => addChild(file, path, newRequestItem())}>Add Request</button> : null}
            {isFolder ? <button onClick={() => addChild(file, path, newWebSocketItem())}>Add WebSocket</button> : null}
            {isFolder ? <button onClick={() => addChild(file, path, newFolderItem())}>Add Folder</button> : null}
            <button onClick={() => startRename(key, item.name)}>Rename</button>
            <button onClick={() => duplicateRow(file, path)}>Duplicate</button>
            {isFolder ? (
              <button
                onClick={() => {
                  closeMenu();
                  openRunnerTab(file, path);
                }}
              >
                Run
              </button>
            ) : null}
            {isFolder ? (
              <button
                onClick={() => {
                  closeMenu();
                  openFolderTab(file, path);
                }}
              >
                Settings
              </button>
            ) : null}
            <button onClick={() => deleteItem(file, path, item.name)}>Delete</button>
          </div>
        ) : null}
      </div>
      {isFolder && expanded
        ? (item.item ?? []).map((child, i) =>
            searching && !subtreeMatches(child, query) ? null : (
              <ItemRow key={i} file={file} path={[...path, i]} item={child} depth={depth + 1} {...shared} />
            )
          )
        : null}
    </>
  );
}
