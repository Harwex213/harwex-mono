import type {
  TCancelDraftAction,
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
  registry: TFsViewerRegistrySlice;
};

export type { TFsDraft, TFsViewerProps, TFsViewerRegistrySlice };
