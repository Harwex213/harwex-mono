import { computed } from "@preact/signals-react";
import {
  MIN_CONTENT_SEARCH_TERM_LENGTH,
  countTermOccurrences,
  readExcalidrawSearchText,
} from "@hw/harwex-notes-protocol";
import type { TFsSearch, TFsSearchMatch, TTab, TTabSaveState } from "@hw/harwex-notes-components";
import type { TDocument, TFsNode } from "@hw/harwex-notes-protocol";
import type { TDocumentEntry, TDocumentsSlice } from "./documents-slice";
import type { TFsSlice } from "./fs-slice";
import type { TContentSearch, TSearchSlice } from "./search-slice";
import type { TTabsSlice } from "./tabs-slice";

const readSaveState = (entry: TDocumentEntry | undefined): TTabSaveState => {
  if (entry === undefined || entry.status === "loading") {
    return "loading";
  }

  if (entry.status === "error") {
    return "failed";
  }

  return entry.save.state;
};

type TAppSaveState = "saved" | "saving" | "failed";

const readAppSaveState = (entryById: Readonly<Record<string, TDocumentEntry>>): TAppSaveState => {
  let appState: TAppSaveState = "saved";

  for (const entry of Object.values(entryById)) {
    if (entry.status !== "ready") {
      continue;
    }

    // A conflict and a file deleted on disk both hold changes that are not on disk and
    // will not get there by themselves.
    if (entry.save.state === "failed" || entry.save.state === "conflict" || entry.save.state === "deleted") {
      return "failed";
    }

    if (entry.save.state === "saving" || entry.save.state === "unsaved") {
      appState = "saving";
    }
  }

  return appState;
};

// Every entry matches on its name, folders included, ignoring case and taking the term as
// plain text (SRCH-4, SRCH-9).
const readNameMatchById = (
  nodes: readonly TFsNode[],
  term: string
): Map<string, TFsSearchMatch> => {
  const lowerTerm = term.toLowerCase();
  const matchById = new Map<string, TFsSearchMatch>();

  for (const node of nodes) {
    if (node.name.toLowerCase().includes(lowerTerm)) {
      matchById.set(node.id, { isNameMatch: true, contentCount: null });
    }
  }

  return matchById;
};

// Counts the term in a document the way the backend counts it in the file (SRCH-6). Null
// for a kind the app never edits, whose disk content is what the user has.
const readDocumentContentCount = (document: TDocument, term: string): number | null => {
  if (document.kind === "markdown" || document.kind === "text") {
    return countTermOccurrences(document.text, term);
  }

  if (document.kind === "excalidraw") {
    return countTermOccurrences(readExcalidrawSearchText(document.scene.elements), term);
  }

  return null;
};

// The content counts for the term: the backend's counts from disk, with every loaded
// document counted again as the user has it. A file with unsaved changes is searched as
// it stands in the editor (SRCH-12). A saved document equals its file, so counting it
// here also keeps its count right after a save, before the next search reads the disk.
const readContentCountById = (
  content: TContentSearch,
  entryById: Readonly<Record<string, TDocumentEntry>>,
  term: string
): ReadonlyMap<string, number> => {
  const isCurrent = content.status !== "idle" && content.term === term;
  const countById = new Map(isCurrent ? content.countById : []);

  for (const [nodeId, entry] of Object.entries(entryById)) {
    if (entry.status !== "ready") {
      continue;
    }

    const count = readDocumentContentCount(entry.document, term);
    if (count !== null) {
      countById.set(nodeId, count);
    }
  }

  return countById;
};

// The folders on the path to every match open by themselves, so each match is visible
// under its real folders (SRCH-2).
const readMatchAncestorIds = (
  nodeById: ReadonlyMap<string, TFsNode>,
  matchIds: Iterable<string>
): ReadonlySet<string> => {
  const ancestorIds = new Set<string>();

  for (const matchId of matchIds) {
    let parentId = nodeById.get(matchId)?.parentId ?? null;

    while (parentId !== null && !ancestorIds.has(parentId)) {
      ancestorIds.add(parentId);
      parentId = nodeById.get(parentId)?.parentId ?? null;
    }
  }

  return ancestorIds;
};

// A file deleted on disk while its tab held unsaved changes is gone from the tree, but its
// tab stays (SYNC-5). The tab and the viewer read its old name from the document entry.
const readDeletedNode = (id: string, entry: TDocumentEntry | undefined): TFsNode | null => {
  if (entry === undefined || entry.status !== "ready" || entry.save.state !== "deleted") {
    return null;
  }

  return { id, parentId: null, name: entry.save.name, kind: entry.document.kind };
};

const createDerivedState = (
  fs: TFsSlice,
  tabs: TTabsSlice,
  documents: TDocumentsSlice,
  search: TSearchSlice
) => {
  const nodeById = computed(() => new Map(fs.nodes.value.map((node) => [node.id, node])));

  const openTabs = computed(() => {
    const byId = nodeById.value;
    const entryById = documents.entryById.value;

    return tabs.openIds.value.reduce((openTabs: TTab[], id) => {
      const node = byId.get(id) ?? readDeletedNode(id, entryById[id]) ?? undefined;

      // Only files are ever opened, so a folder among the open ids would be stale state.
      if (node === undefined || node.kind === "folder") {
        return openTabs;
      }

      openTabs.push({
        id: node.id,
        name: node.name,
        kind: node.kind,
        saveState: readSaveState(entryById[id]),
      });

      return openTabs;
    }, []);
  });

  const activeNode = computed(() => {
    const activeId = tabs.activeId.value;
    if (activeId === null) {
      return null;
    }

    return nodeById.value.get(activeId) ?? readDeletedNode(activeId, documents.entryById.value[activeId]);
  });

  const activeEntry = computed(() => {
    const activeId = tabs.activeId.value;
    if (activeId === null) {
      return null;
    }

    return documents.entryById.value[activeId] ?? null;
  });

  const appSaveState = computed(() => readAppSaveState(documents.entryById.value));

  // Null while the field is empty. Content matches (SRCH-5 and on) merge into matchById
  // next to the name matches; a node that matched both ways keeps one entry.
  const fsSearch = computed((): TFsSearch | null => {
    const term = search.term.value;
    if (term.length === 0) {
      return null;
    }

    const nodes = fs.nodes.value;
    const matchById = readNameMatchById(nodes, term);
    const searchedFileCount = nodes.filter((node) => node.kind !== "folder").length;

    // A term of one character filters on names only (SRCH-10).
    if (term.length < MIN_CONTENT_SEARCH_TERM_LENGTH) {
      return { term, matchById, searchedFileCount, isRunning: false };
    }

    const content = search.content.value;
    const byId = nodeById.value;

    for (const [nodeId, count] of readContentCountById(content, documents.entryById.value, term)) {
      // A file deleted since the search read it drops out (SRCH-15).
      if (count === 0 || !byId.has(nodeId)) {
        continue;
      }

      matchById.set(nodeId, { isNameMatch: matchById.get(nodeId)?.isNameMatch ?? false, contentCount: count });
    }

    // Until the content search for this term has finished, including the pause before it
    // starts, the panel says it is still working instead of reporting nothing (SRCH-16).
    const isContentCurrent = content.status !== "idle" && content.term === term;
    const isRunning = !isContentCurrent || content.status === "running";

    return { term, matchById, searchedFileCount, isRunning };
  });

  // The expanded set the tree shows. Outside a search it is the reader's own set; during a
  // search it is the path to every match plus the reader's toggles in the filtered tree.
  const treeExpandedIds = computed((): readonly string[] => {
    const activeSearch = fsSearch.value;
    if (activeSearch === null) {
      return fs.expandedIds.value;
    }

    const collapsedIds = new Set(search.collapsedIds.value);
    const ids = new Set([
      ...readMatchAncestorIds(nodeById.value, activeSearch.matchById.keys()),
      ...search.expandedIds.value,
    ]);

    return [...ids].filter((id) => !collapsedIds.has(id));
  });

  return {
    nodeById,
    openTabs,
    activeNode,
    activeEntry,
    appSaveState,
    fsSearch,
    treeExpandedIds,
  };
};

type TDerivedState = ReturnType<typeof createDerivedState>;

export type { TAppSaveState, TDerivedState };
export { createDerivedState };
