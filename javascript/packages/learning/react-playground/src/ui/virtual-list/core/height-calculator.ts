import type { VirtualTreeNode, FlattenedNode } from '../types';

interface HeightCalculationResult {
  totalHeight: number;
  flatIndex: Map<string, FlattenedNode>;
}

/**
 * Recursively calculates heights and positions for all nodes in the tree
 * @param nodes - Array of tree nodes
 * @returns Object containing total height and flat index map
 */
export function calculateHeights<T>(nodes: VirtualTreeNode<T>[]): HeightCalculationResult {
  const flatIndex = new Map<string, FlattenedNode>();
  let currentTop = 0;

  function traverse(
    nodeList: VirtualTreeNode<T>[],
    depth: number,
    parentId: string | null
  ): number {
    let accumulatedHeight = 0;

    for (const node of nodeList) {
      const nodeTop = currentTop + accumulatedHeight;
      const childrenIds = node.children?.map(child => child.id) ?? [];

      // Calculate children's total height if they exist
      let childrenTotalHeight = 0;
      if (node.children && node.children.length > 0) {
        const beforeChildrenTop = currentTop + accumulatedHeight + node.height;
        const savedCurrentTop = currentTop;
        currentTop = beforeChildrenTop;
        
        childrenTotalHeight = traverse(node.children, depth + 1, node.id);
        
        currentTop = savedCurrentTop;
      }

      const totalHeight = node.height + childrenTotalHeight;

      // Store flattened node data
      flatIndex.set(node.id, {
        id: node.id,
        depth,
        absoluteTop: nodeTop,
        height: node.height,
        totalHeight,
        parentId,
        childrenIds,
      });

      accumulatedHeight += totalHeight;
    }

    return accumulatedHeight;
  }

  const totalHeight = traverse(nodes, 0, null);

  return {
    totalHeight,
    flatIndex,
  };
}
