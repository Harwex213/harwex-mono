import { computed, signal, type ReadonlySignal } from "@preact/signals-react";
import type { FileKind } from "../../shared/contract.ts";
import { api, describeError, errorCode } from "../api/client.ts";

type DocStatus = "loading" | "ready" | "error";

type Doc = {
  status: DocStatus;
  fileKind: FileKind;
  savedText: string;
  draftText: string;
  baseMtimeMs: number;
  /** Bumped on every reload, so editors keyed by it rebuild from disk. */
  revision: number;
  saving: boolean;
  conflict: boolean;
  error: string | null;
};

const docsByPath = signal<Readonly<Record<string, Doc>>>({});

function patchDoc(path: string, patch: Partial<Doc>): void {
  const current = docsByPath.value[path];
  if (current === undefined) {
    return;
  }
  docsByPath.value = { ...docsByPath.value, [path]: { ...current, ...patch } };
}

async function fetchInto(path: string, revision: number): Promise<void> {
  try {
    const result = await api.file.read.query({ path });
    docsByPath.value = {
      ...docsByPath.value,
      [path]: {
        status: "ready",
        fileKind: result.fileKind,
        savedText: result.text,
        draftText: result.text,
        baseMtimeMs: result.mtimeMs,
        revision,
        saving: false,
        conflict: false,
        error: null,
      },
    };
  } catch (error) {
    docsByPath.value = {
      ...docsByPath.value,
      [path]: {
        status: "error",
        fileKind: "text",
        savedText: "",
        draftText: "",
        baseMtimeMs: 0,
        revision,
        saving: false,
        conflict: false,
        error: describeError(error),
      },
    };
  }
}

async function loadDoc(path: string): Promise<void> {
  if (docsByPath.value[path] !== undefined) {
    return;
  }
  docsByPath.value = {
    ...docsByPath.value,
    [path]: {
      status: "loading",
      fileKind: "text",
      savedText: "",
      draftText: "",
      baseMtimeMs: 0,
      revision: 0,
      saving: false,
      conflict: false,
      error: null,
    },
  };
  await fetchInto(path, 0);
}

/** Throws away the draft and takes what is on disk now. */
async function reloadDoc(path: string): Promise<void> {
  const current = docsByPath.value[path];
  const revision = (current?.revision ?? 0) + 1;
  patchDoc(path, { status: "loading", conflict: false, error: null });
  await fetchInto(path, revision);
}

function dropDoc(path: string): void {
  const next: Record<string, Doc> = {};
  for (const [key, doc] of Object.entries(docsByPath.value)) {
    if (key !== path) {
      next[key] = doc;
    }
  }
  docsByPath.value = next;
  dirtyByPath.delete(path);
}

function setDraft(path: string, text: string): void {
  const current = docsByPath.value[path];
  if (current === undefined || current.status !== "ready" || current.draftText === text) {
    return;
  }
  patchDoc(path, { draftText: text });
}

async function saveDoc(path: string): Promise<void> {
  const doc = docsByPath.value[path];
  if (doc === undefined || doc.status !== "ready" || doc.saving) {
    return;
  }
  if (doc.draftText === doc.savedText && !doc.conflict) {
    return;
  }
  const text = doc.draftText;
  patchDoc(path, { saving: true, error: null });
  try {
    const result = await api.file.write.mutate({
      path,
      text,
      baseMtimeMs: doc.baseMtimeMs,
    });
    patchDoc(path, {
      saving: false,
      savedText: text,
      baseMtimeMs: result.mtimeMs,
      conflict: false,
      error: null,
    });
  } catch (error) {
    patchDoc(path, {
      saving: false,
      conflict: errorCode(error) === "CONFLICT",
      error: describeError(error),
    });
  }
}

/**
 * Overwrites whatever is on disk with the current draft, which is the only way
 * out of a conflict other than throwing the draft away.
 */
async function forceSaveDoc(path: string): Promise<void> {
  const doc = docsByPath.value[path];
  if (doc === undefined || doc.status !== "ready") {
    return;
  }
  try {
    const fresh = await api.file.read.query({ path });
    patchDoc(path, { baseMtimeMs: fresh.mtimeMs });
  } catch (error) {
    patchDoc(path, { error: describeError(error) });
    return;
  }
  await saveDoc(path);
}

// Dirty is derived, never stored. One computed per path, cached so the tab bar
// subscribes to the same signal on every render.
const dirtyByPath = new Map<string, ReadonlySignal<boolean>>();

function dirtySignal(path: string): ReadonlySignal<boolean> {
  const existing = dirtyByPath.get(path);
  if (existing !== undefined) {
    return existing;
  }
  const created = computed<boolean>(() => {
    const doc = docsByPath.value[path];
    if (doc === undefined || doc.status !== "ready") {
      return false;
    }
    return doc.draftText !== doc.savedText;
  });
  dirtyByPath.set(path, created);
  return created;
}

export {
  dirtySignal,
  docsByPath,
  dropDoc,
  forceSaveDoc,
  loadDoc,
  reloadDoc,
  saveDoc,
  setDraft,
};
export type { Doc, DocStatus };
