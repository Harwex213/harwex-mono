// Input data structure
export interface VirtualTreeNode<T = unknown> {
  id: string;
  height: number; // Height in pixels (required)
  data: T;        // User data
  children?: VirtualTreeNode<T>[];
}

// Internal computed structure
export interface FlattenedNode {
  id: string;
  depth: number;
  absoluteTop: number;    // Position from list start
  height: number;         // Own height (excluding children)
  totalHeight: number;    // Height including all descendants
  parentId: string | null;
  childrenIds: string[];
}

export type ScrollMode = 'window' | 'container';

export interface VirtualListContextValue {
  visibleNodes: Set<string>;
  flatIndex: Map<string, FlattenedNode>;
  totalHeight: number;
  listOffsetTop: number;
  isNodeVisible: (id: string) => boolean;
  setListOffsetTop: (offset: number) => void;
}
