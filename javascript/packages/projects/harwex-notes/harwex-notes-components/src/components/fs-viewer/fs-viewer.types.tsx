import type {
  TCancelDraftAction,
  TChangeSearchAction,
  TClearSearchAction,
  TDeleteNodeAction,
  TFsNode,
  TFsNodeKind,
  TMoveNodeAction,
  TOpenNodeAction,
  TSelectNodeAction,
  TStartCreateAction,
  TStartRenameAction,
  TSubmitDraftAction,
  TToggleFolderAction,
} from "@hw/harwex-notes-protocol";

// A row the reader is typing a name into. A "create" draft with kind "file" has no kind
// yet: the extension of the typed name decides whether it becomes a note or a sketch.
type TFsDraft =
  | { mode: "create"; parentId: string | null; kind: TFsNodeKind }
  | { mode: "rename"; nodeId: string };

type TFsViewerRegistrySlice = {
  toggleFolderAction: TToggleFolderAction;
  openNodeAction: TOpenNodeAction;
  selectNodeAction: TSelectNodeAction;
  startCreateAction: TStartCreateAction;
  startRenameAction: TStartRenameAction;
  cancelDraftAction: TCancelDraftAction;
  submitDraftAction: TSubmitDraftAction;
  moveNodeAction: TMoveNodeAction;
  deleteNodeAction: TDeleteNodeAction;
  changeSearchAction: TChangeSearchAction;
  clearSearchAction: TClearSearchAction;
};

// How one entry matched the term. A name match highlights the term in the row. A content
// match carries the number of occurrences inside the file and is null when the content was
// not searched or did not match.
type TFsSearchMatch = {
  isNameMatch: boolean;
  contentCount: number | null;
};

// An active search. The host decides what matched; the viewer lists the matches under
// their real folders and keeps the whole content of a matching folder.
type TFsSearch = {
  term: string;
  matchById: ReadonlyMap<string, TFsSearchMatch>;
  // The number of files the search looked at, named when nothing matched.
  searchedFileCount: number;
  // A search that is still running is never reported as empty.
  isRunning: boolean;
};

// The viewer holds no tree state of its own. The host owns every value below and changes
// it through the registry actions; the viewer only keeps view state (open menu, drag).
type TFsViewerProps = {
  nodes: readonly TFsNode[];
  expandedIds: readonly string[];
  // The row the reader clicked last.
  selectedId: string | null;
  // The node shown in the active tab, highlighted apart from the selection.
  activeId: string | null;
  draft: TFsDraft | null;
  // The first tree read is on its way.
  isLoading?: boolean;
  // A mutation is on its way; the create buttons are disabled meanwhile.
  isBusy?: boolean;
  error?: string | null;
  // Null when the search field is empty, and the whole tree is shown. While a search is
  // active, expandedIds is the expanded set of the filtered tree, not the reader's own set.
  search?: TFsSearch | null;
  registry: TFsViewerRegistrySlice;
};

export type { TFsDraft, TFsSearch, TFsSearchMatch, TFsViewerProps, TFsViewerRegistrySlice };
