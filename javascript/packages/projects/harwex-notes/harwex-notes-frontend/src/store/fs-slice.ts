import { signal } from "@preact/signals-react";
import type { TFsNode, TFsNodeKind } from "@hw/harwex-notes-protocol";

// A "file" draft is started without a kind: the extension the reader types decides
// whether the new file is a note or a sketch.
type TFsDraftKind = TFsNodeKind | "file";

type TFsDraft =
  | { mode: "create"; parentId: string | null; kind: TFsDraftKind }
  | { mode: "rename"; nodeId: string };

const createFsState = () => ({
  nodes: signal<readonly TFsNode[]>([]),
  expandedIds: signal<readonly string[]>([]),
  selectedId: signal<string | null>(null),
  draft: signal<TFsDraft | null>(null),
  isLoading: signal(false),
  isBusy: signal(false),
  error: signal<string | null>(null),
});

type TFsSlice = ReturnType<typeof createFsState>;

export type { TFsDraft, TFsDraftKind, TFsSlice };
export { createFsState };
