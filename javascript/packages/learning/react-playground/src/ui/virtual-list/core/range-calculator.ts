import type { FlattenedNode } from '../types';

/**
 * Determines which nodes are visible given scroll position and viewport dimensions
 * @param flatIndex - Map of all flattened nodes
 * @param scrollTop - Current scroll position
 * @param viewportHeight - Height of the visible viewport
 * @param listOffsetTop - Offset of the list from scroll container top
 * @param overscan - Number of items to render beyond visible area
 * @returns Set of visible node IDs
 */
export function calculateVisibleRange(
  flatIndex: Map<string, FlattenedNode>,
  scrollTop: number,
  viewportHeight: number,
  listOffsetTop: number,
  overscan: number = 0
): Set<string> {
  const visibleNodes = new Set<string>();
  
  // Adjust scroll position relative to list start
  const effectiveScrollTop = Math.max(0, scrollTop - listOffsetTop);
  const visibleStart = Math.max(0, effectiveScrollTop - overscan * 50); // Assuming ~50px avg height for overscan
  const visibleEnd = effectiveScrollTop + viewportHeight + overscan * 50;

  // Convert flatIndex to array for binary search
  const nodes = Array.from(flatIndex.values());
  
  if (nodes.length === 0) {
    return visibleNodes;
  }

  // Binary search for first potentially visible node
  let left = 0;
  let right = nodes.length - 1;
  let firstVisible = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const node = nodes[mid];
    const nodeEnd = node.absoluteTop + node.totalHeight;

    if (nodeEnd < visibleStart) {
      left = mid + 1;
      firstVisible = left;
    } else {
      right = mid - 1;
    }
  }

  // From first visible, add all nodes that intersect viewport
  for (let i = firstVisible; i < nodes.length; i++) {
    const node = nodes[i];
    const nodeStart = node.absoluteTop;
    const nodeEnd = node.absoluteTop + node.totalHeight;

    // Node is completely past visible area
    if (nodeStart > visibleEnd) {
      break;
    }

    // Node intersects visible area
    if (nodeEnd >= visibleStart && nodeStart <= visibleEnd) {
      visibleNodes.add(node.id);
      
      // If node is visible, we need to check if we should render its parent chain
      // (parents must be visible for children to render)
      let currentParentId = node.parentId;
      while (currentParentId) {
        visibleNodes.add(currentParentId);
        const parentNode = flatIndex.get(currentParentId);
        currentParentId = parentNode?.parentId ?? null;
      }
    }
  }

  return visibleNodes;
}
