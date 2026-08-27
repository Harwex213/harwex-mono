import { ExcalidrawViewer } from "./src/components/excalidraw-viewer/excalidraw-viewer";
import { FsViewer } from "./src/components/fs-viewer/fs-viewer";
import { TabsBar } from "./src/components/tabs-bar/tabs-bar";
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
  TTab,
  TTabSaveState,
  TTabsBarProps,
  TTabsBarRegistrySlice,
} from "./src/components/tabs-bar/tabs-bar.types";

export { ExcalidrawViewer, FsViewer, TabsBar };
export type {
  TExcalidrawViewerProps,
  TExcalidrawViewerRegistrySlice,
  TFsDraft,
  TFsViewerProps,
  TFsViewerRegistrySlice,
  TTab,
  TTabSaveState,
  TTabsBarProps,
  TTabsBarRegistrySlice,
};
