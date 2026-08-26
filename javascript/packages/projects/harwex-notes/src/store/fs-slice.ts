import { signal } from "@preact/signals-react";
import type { TFsNode, TFsNodeKind } from "../api/types";

type TFsDraft =
  | { mode: "create"; parentId: string | null; kind: TFsNodeKind }
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

export type { TFsDraft, TFsSlice };
export { createFsState };
