import { useEffect, useState } from "react";
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
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Save request</div>

        <div className="field-row">
          <label>Name</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && collectionFile) handleSave();
            }}
          />
        </div>

        <div className="field-row">
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
          <div className="field-row">
            <label>New name</label>
            <input
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
        ) : null}

        {collectionFile ? (
          <div className="field-row">
            <label>Folder</label>
            <Select
              value={folderPath.join(",")}
              onChange={(v) => setFolderPath(v ? v.split(",").map(Number) : [])}
              ariaLabel="Folder"
              options={[
                { value: "", label: "Collection root" },
                ...folders.map((f) => ({ value: f.path.join(","), label: "  ".repeat(f.depth) + f.name })),
              ]}
            />
          </div>
        ) : null}

        <div className="modal-actions">
          <button onClick={cancel}>Cancel</button>
          <button className="primary" disabled={!collectionFile || saving} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
