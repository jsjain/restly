import { useEffect, useState } from "react";
import { Folder, Layers } from "lucide-react";
import { requestTitle } from "../requestName";
import * as api from "../api";
import {
  state,
  closeSaveDraftModal,
  closeTab,
  ensureCollection,
  refreshWorkspace,
  saveCollectionFile,
  toast,
  notifyChange,
} from "../store";
import type { RequestTab } from "../store";
import { itemAt } from "../tree";
import { isFolder } from "../types";
import type { Item } from "../types";
import { closeAfterSave } from "./ConfirmCloseModal";
import Select from "./Select";
import { Kbd } from "./Kbd";

interface Props {
  tab: RequestTab;
}

interface FolderOption {
  path: number[];
  name: string;
  depth: number;
}

// Every folder in the collection, at any depth, in display order.
function collectFolders(items: Item[], path: number[], depth: number, out: FolderOption[]): void {
  items.forEach((it, i) => {
    if (isFolder(it)) {
      const p = [...path, i];
      out.push({ path: p, name: it.name, depth });
      collectFolders(it.item ?? [], p, depth + 1, out);
    }
  });
}

const NEW_COLLECTION = "__new__";

export default function SaveRequestModal({ tab }: Props) {
  const [name, setName] = useState(requestTitle(tab.draft));
  const [collectionFile, setCollectionFile] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [newCollName, setNewCollName] = useState("");
  const [folderPath, setFolderPath] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const collections = state.workspace?.collections ?? [];
  const coll = collectionFile ? state.collections.get(collectionFile) : undefined;
  const folders: FolderOption[] = [];
  if (coll) collectFolders(coll.item, [], 0, folders);

  function cancel() {
    closeAfterSave.delete(tab);
    closeSaveDraftModal();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectCollection(value: string) {
    if (value === NEW_COLLECTION) {
      setCreatingNew(true);
      setCollectionFile("");
      setFolderPath([]);
      return;
    }
    setCreatingNew(false);
    setCollectionFile(value);
    setFolderPath([]);
    ensureCollection(value).catch((err) => toast(String(err), "error"));
  }

  async function createCollection() {
    const cname = newCollName.trim();
    if (!cname) return;
    try {
      const ref = await api.newCollection(cname);
      await refreshWorkspace();
      await ensureCollection(ref.file);
      setCreatingNew(false);
      setCollectionFile(ref.file);
      setNewCollName("");
    } catch (err) {
      toast(String(err), "error");
    }
  }

  async function handleSave() {
    if (!collectionFile || !tab.draft || saving) return;
    setSaving(true);
    try {
      const coll = await ensureCollection(collectionFile);
      const parent = folderPath.length === 0 ? coll : itemAt(coll, folderPath);
      if (!parent) {
        toast("Folder not found", "error");
        return;
      }
      parent.item ??= [];
      const list = parent.item;
      const prevName = tab.draft.name;
      const finalName = name.trim() || "Untitled Request";
      tab.draft.name = finalName;
      const index = list.length;
      list.push(tab.draft);
      try {
        await saveCollectionFile(collectionFile);
      } catch (err) {
        list.splice(index, 1);
        tab.draft.name = prevName;
        toast(String(err), "error");
        return;
      }
      tab.file = collectionFile;
      tab.path = [...folderPath, index];
      delete tab.draft;
      delete tab.draftDirty;
      state.expandedCollections.add(collectionFile);
      for (let i = 0; i < folderPath.length; i++) {
        const ancestor = itemAt(coll, folderPath.slice(0, i + 1));
        if (ancestor) state.expandedItems.add(ancestor);
      }
      closeSaveDraftModal();
      toast(`Saved to ${coll.info.name}`);
      if (closeAfterSave.has(tab)) {
        closeAfterSave.delete(tab);
        closeTab(tab);
      }
      notifyChange();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={cancel}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Save request"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave();
          }
        }}
      >
        <div className="modal-title">Save request</div>

        <div className="modal-field">
          <label htmlFor="save-request-name">Name</label>
          <input
            id="save-request-name"
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && collectionFile) handleSave();
            }}
          />
        </div>

        <div className="modal-field">
          <label>Collection</label>
          <Select
            value={creatingNew ? NEW_COLLECTION : collectionFile}
            onChange={selectCollection}
            placeholder="Choose a collection…"
            ariaLabel="Collection"
            options={[
              ...collections.map((ref) => ({ value: ref.file, label: ref.name })),
              { value: NEW_COLLECTION, label: "New collection…" },
            ]}
          />
        </div>

        {creatingNew ? (
          <div className="modal-field">
            <label htmlFor="save-request-new-collection">New collection name</label>
            <div className="modal-field-inline">
              <input
                id="save-request-new-collection"
                autoFocus
                type="text"
                value={newCollName}
                onChange={(e) => setNewCollName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createCollection();
                }}
              />
              <button onClick={createCollection}>Create</button>
            </div>
          </div>
        ) : null}

        {collectionFile ? (
          <div className="modal-field">
            <label>Folder</label>
            <Select
              value={folderPath.join(",")}
              onChange={(v) => setFolderPath(v ? v.split(",").map(Number) : [])}
              ariaLabel="Folder"
              options={[
                { value: "", label: "Collection root", icon: <Layers size={14} strokeWidth={1.75} /> },
                ...folders.map((f) => ({
                  value: f.path.join(","),
                  label: f.name,
                  indent: f.depth + 1,
                  icon: <Folder size={14} strokeWidth={1.75} />,
                })),
              ]}
            />
          </div>
        ) : null}

        <div className="modal-actions">
          <button onClick={cancel}>Cancel</button>
          <button className="primary" disabled={!collectionFile || saving} onClick={handleSave}>
            Save
            <Kbd keys="mod+enter" />
          </button>
        </div>
      </div>
    </div>
  );
}
