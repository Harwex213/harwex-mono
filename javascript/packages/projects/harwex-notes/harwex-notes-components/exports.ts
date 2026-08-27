import { ConflictModal } from "./src/components/conflict-modal/conflict-modal";
import { ExcalidrawViewer } from "./src/components/excalidraw-viewer/excalidraw-viewer";
import { FsViewer } from "./src/components/fs-viewer/fs-viewer";
import { MarkdownViewer } from "./src/components/markdown-viewer/markdown-viewer";
import { TabsBar } from "./src/components/tabs-bar/tabs-bar";
import type {
  TConflict,
  TConflictModalProps,
  TConflictModalRegistrySlice,
} from "./src/components/conflict-modal/conflict-modal.types";
import type {
  TExcalidrawViewerProps,
  TExcalidrawViewerRegistrySlice,
} from "./src/components/excalidraw-viewer/excalidraw-viewer.types";
import type {
  TFsDraft,
  TFsViewerProps,
  TFsViewerRegistrySlice,
} from "./src/components/fs-viewer/fs-viewer.types";
import type {
  TMarkdownViewerLayout,
  TMarkdownViewerProps,
  TMarkdownViewerRegistrySlice,
} from "./src/components/markdown-viewer/markdown-viewer.types";
import type {
  TTab,
  TTabSaveState,
  TTabsBarProps,
  TTabsBarRegistrySlice,
} from "./src/components/tabs-bar/tabs-bar.types";

export { ConflictModal, ExcalidrawViewer, FsViewer, MarkdownViewer, TabsBar };
export type {
  TConflict,
  TConflictModalProps,
  TConflictModalRegistrySlice,
  TExcalidrawViewerProps,
  TExcalidrawViewerRegistrySlice,
  TFsDraft,
  TFsViewerProps,
  TFsViewerRegistrySlice,
  TMarkdownViewerLayout,
  TMarkdownViewerProps,
  TMarkdownViewerRegistrySlice,
  TTab,
  TTabSaveState,
  TTabsBarProps,
  TTabsBarRegistrySlice,
};
