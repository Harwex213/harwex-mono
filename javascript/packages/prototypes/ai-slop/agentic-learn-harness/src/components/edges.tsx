import type { LearnNode } from "../../shared/types.ts";
import { NODE_FALLBACK_HEIGHT, NODE_WIDTH } from "../state/layout.ts";

type EdgesProps = {
  nodes: LearnNode[];
  heights: Record<string, number>;
  selectedId: string | null;
};

/** Cubic curve from a parent's bottom edge to a child's top edge. */
function path(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const lift = Math.max(40, Math.abs(to.y - from.y) * 0.45);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + lift}, ${to.x} ${to.y - lift}, ${to.x} ${to.y}`;
}

function Edges({ nodes, heights, selectedId }: EdgesProps) {
  const byId = new Map(nodes.map((node) => {
    return [node.id, node];
  }));

  const lines = nodes
    .filter((node) => {
      return node.parentId !== null && byId.has(node.parentId);
    })
    .map((node) => {
      const parent = byId.get(node.parentId as string) as LearnNode;
      const from = {
        x: parent.x + NODE_WIDTH / 2,
        y: parent.y + (heights[parent.id] ?? NODE_FALLBACK_HEIGHT),
      };
      const to = { x: node.x + NODE_WIDTH / 2, y: node.y };
      const active = selectedId === node.id || selectedId === parent.id;
      return (
        <path
          className={active ? "edge edge--active" : "edge"}
          d={path(from, to)}
          key={`${parent.id}-${node.id}`}
        />
      );
    });

  return (
    <svg className="edges" aria-hidden="true">
      {lines}
    </svg>
  );
}

export { Edges };
