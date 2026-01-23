// Types
export type {
  VirtualTreeNode,
  FlattenedNode,
  ScrollMode,
  VirtualListContextValue,
} from './types';

// Components
export { VirtualListProvider } from './virtual-list-provider';
export type { VirtualListProviderProps } from './virtual-list-provider';

export { VirtualListRoot } from './virtual-list-root';
export type { VirtualListRootProps } from './virtual-list-root';

export { VirtualNode } from './virtual-node';
export type { VirtualNodeProps } from './virtual-node';

// Hooks
export { useVirtualList } from './use-virtual-list';

// Core utilities (exported for advanced usage)
export { calculateHeights } from './core/height-calculator';
export { calculateVisibleRange } from './core/range-calculator';
export { createScrollObserver } from './core/scroll-observer';
export type { ScrollObserver, ScrollState } from './core/scroll-observer';
