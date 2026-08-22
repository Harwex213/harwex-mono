import type { LearnNode } from "../../shared/types.ts";

const NODE_WIDTH = 380;
/** Used until a card has been measured on screen. */
const NODE_FALLBACK_HEIGHT = 300;
const COLUMN_GAP = 48;
const ROW_GAP = 120;

type Heights = Record<string, number>;

function heightOf(heights: Heights, nodeId: string): number {
  return heights[nodeId] ?? NODE_FALLBACK_HEIGHT;
}

/** True when a card at (x, y) would sit on top of an existing one. */
function overlaps(nodes: LearnNode[], heights: Heights, x: number, y: number): boolean {
  return nodes.some((node) => {
    const horizontal = Math.abs(node.x - x) < NODE_WIDTH + COLUMN_GAP - 1;
    const verticalGap = y < node.y
      ? node.y - y - NODE_FALLBACK_HEIGHT
      : y - node.y - heightOf(heights, node.id);
    return horizontal && verticalGap < 24;
  });
}

/**
 * Finds a free spot for a new child, biased to sit under its parent. Card
 * heights vary with the answer, so placement uses the measured height.
 */
function placeChild(
  nodes: LearnNode[],
  heights: Heights,
  parent: LearnNode,
): { x: number; y: number } {
  const siblings = nodes.filter((node) => {
    return node.parentId === parent.id;
  });
  const y = parent.y + heightOf(heights, parent.id) + ROW_GAP;
  let x = parent.x + siblings.length * (NODE_WIDTH + COLUMN_GAP);
  let guard = 0;
  while (overlaps(nodes, heights, x, y) && guard < 60) {
    x += NODE_WIDTH + COLUMN_GAP;
    guard += 1;
  }
  return { x, y };
}

/** Finds a free spot for a new root, to the right of everything else. */
function placeRoot(nodes: LearnNode[]): { x: number; y: number } {
  const roots = nodes.filter((node) => {
    return node.parentId === null;
  });
  if (roots.length === 0) {
    return { x: 0, y: 0 };
  }
  const rightmost = Math.max(...nodes.map((node) => {
    return node.x;
  }));
  return { x: rightmost + NODE_WIDTH + COLUMN_GAP * 3, y: 0 };
}

/** Ids of a node and everything hanging off it. */
function subtreeIds(nodes: LearnNode[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId !== null && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** The path from the root down to (but excluding) the given node. */
function ancestorChain(nodes: LearnNode[], nodeId: string): LearnNode[] {
  const byId = new Map(nodes.map((node) => {
    return [node.id, node];
  }));
  const chain: LearnNode[] = [];
  let current = byId.get(nodeId)?.parentId ?? null;
  let guard = 0;
  while (current !== null && guard < 200) {
    const parent = byId.get(current);
    if (!parent) {
      break;
    }
    chain.unshift(parent);
    current = parent.parentId;
    guard += 1;
  }
  return chain;
}

export {
  ancestorChain,
  NODE_FALLBACK_HEIGHT,
  NODE_WIDTH,
  placeChild,
  placeRoot,
  subtreeIds,
};
