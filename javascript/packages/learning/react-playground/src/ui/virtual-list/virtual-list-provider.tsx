import { createContext, useMemo, useState, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { VirtualTreeNode, VirtualListContextValue, ScrollMode } from './types';
import { calculateHeights } from './core/height-calculator';
import { calculateVisibleRange } from './core/range-calculator';
import { createScrollObserver } from './core/scroll-observer';

export const VirtualListContext = createContext<VirtualListContextValue | null>(null);

export interface VirtualListProviderProps<T = unknown> {
  nodes: VirtualTreeNode<T>[];
  scrollMode?: ScrollMode;
  overscan?: number;
  containerRef?: RefObject<HTMLElement>;
  children: ReactNode;
}

export function VirtualListProvider<T = unknown>({
  nodes,
  scrollMode = 'window',
  overscan = 3,
  containerRef,
  children,
}: VirtualListProviderProps<T>) {
  const [visibleNodes, setVisibleNodes] = useState<Set<string>>(new Set());
  const [listOffsetTop, setListOffsetTop] = useState(0);
  
  // Calculate heights and flat index
  const { totalHeight, flatIndex } = useMemo(() => {
    return calculateHeights(nodes);
  }, [nodes]);

  // Create scroll observer
  const scrollObserverRef = useRef(createScrollObserver(scrollMode, containerRef));

  // Update visible range on scroll
  useEffect(() => {
    const observer = scrollObserverRef.current;

    const updateVisibleRange = () => {
      const { scrollTop, viewportHeight } = observer.getState();
      const newVisibleNodes = calculateVisibleRange(
        flatIndex,
        scrollTop,
        viewportHeight,
        listOffsetTop,
        overscan
      );
      
      setVisibleNodes(newVisibleNodes);
    };

    // Initial calculation
    updateVisibleRange();

    // Subscribe to scroll updates
    const unsubscribe = observer.subscribe(updateVisibleRange);

    return unsubscribe;
  }, [flatIndex, listOffsetTop, overscan]);

  // Recreate scroll observer when mode or container changes
  useEffect(() => {
    scrollObserverRef.current = createScrollObserver(scrollMode, containerRef);
  }, [scrollMode, containerRef]);

  const contextValue = useMemo<VirtualListContextValue>(() => ({
    visibleNodes,
    flatIndex,
    totalHeight,
    listOffsetTop,
    isNodeVisible: (id: string) => visibleNodes.has(id),
    setListOffsetTop,
  }), [visibleNodes, flatIndex, totalHeight, listOffsetTop]);

  return (
    <VirtualListContext.Provider value={contextValue}>
      {children}
    </VirtualListContext.Provider>
  );
}
