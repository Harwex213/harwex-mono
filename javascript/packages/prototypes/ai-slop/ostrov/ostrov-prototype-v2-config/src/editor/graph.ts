import type { GameConfig } from "../schema";
import {
  BUILDINGS_GROUP,
  NODE_X_FIELD,
  NODE_Y_FIELD,
  NO_PREREQUISITE,
  PREREQUISITE_FIELD,
  entityEntries,
  groupEntries,
  prerequisiteCycleIds,
} from "../schema";
import type { ConfigValue } from "../types";

/**
 * The buildings tech tree as plain data: where every node sits, which edges run
 * between them and which of them form a cycle.
 *
 * Nothing here touches the DOM, so the canvas page only has to draw the result.
 */

const NODE_WIDTH = 208;

const NODE_HEIGHT = 82;

/** Distance between two prerequisite levels. */
const COLUMN_STEP = 300;

/** Distance between two nodes of the same level. */
const ROW_STEP = 106;

const ORIGIN_X = 70;

const ORIGIN_Y = 60;

/** Gap the arrowhead needs in front of the child node. */
const ARROW_GAP = 11;

const BUILDINGS = groupEntries().find(([key]) => key === BUILDINGS_GROUP)![1];

const BUILDING_ENTITIES = entityEntries(BUILDINGS)!;

type Row = Record<string, ConfigValue>;

type GraphNode = {
  id: string;
  label: string;
  /** Top-left corner in graph space. */
  x: number;
  y: number;
  /** Id of the prerequisite, or `none`. */
  requires: string;
  /** True while the node still sits where the automatic layout put it. */
  auto: boolean;
  /** True when the node cannot be built at all: its requirements close a ring. */
  onCycle: boolean;
  costWood: number;
  costStone: number;
  costGold: number;
  buildTimeSec: number;
};

type GraphEdge = {
  from: string;
  to: string;
  onCycle: boolean;
};

type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Ids that sit on a cycle, in schema order. Empty when the tree is a tree. */
  cycleIds: string[];
};

/** The cubic one edge is drawn along, in graph space. */
type EdgeCurve = {
  startX: number;
  startY: number;
  bend1X: number;
  bend1Y: number;
  bend2X: number;
  bend2Y: number;
  endX: number;
  endY: number;
};

/** What a link drag would do if it were dropped where it is now. */
type LinkVerdict =
  | { kind: "ok" }
  /** The target already requires something, and this drop takes its place. */
  | { kind: "replace"; previousLabel: string }
  /** A node cannot require itself. */
  | { kind: "self" }
  /** Labels of the ring the drop would close, target first. */
  | { kind: "cycle"; ring: string[] };

function rowsOf(config: GameConfig): Record<string, Row> {
  return (config as unknown as Record<string, Record<string, Row>>)[BUILDINGS_GROUP]!;
}

/**
 * Places every building by prerequisite depth: level in the column, children of
 * one parent stacked next to each other, a parent centred on its children.
 *
 * A ring of requirements has no root to start from, so whatever the walk from
 * the roots did not reach is walked again from the first id left over. Every
 * node is entered once, which is what keeps a cycle from looping forever.
 */
function autoLayout(rows: Record<string, Row>): Map<string, { x: number; y: number }> {
  const ids = BUILDING_ENTITIES.map(([id]) => id);
  const children = new Map<string, string[]>();
  for (const id of ids) {
    children.set(id, []);
  }
  for (const id of ids) {
    const parent = String(rows[id]![PREREQUISITE_FIELD]);
    const bucket = children.get(parent);
    if (bucket) {
      bucket.push(id);
    }
  }

  const visited = new Set<string>();
  const depths = new Map<string, number>();
  const rowsOfNode = new Map<string, number>();
  let nextRow = 0;

  const place = (id: string, depth: number): number => {
    visited.add(id);
    depths.set(id, depth);
    const kids = (children.get(id) ?? []).filter((kid) => !visited.has(kid));
    if (kids.length === 0) {
      const row = nextRow;
      nextRow += 1;
      rowsOfNode.set(id, row);
      return row;
    }
    let total = 0;
    for (const kid of kids) {
      total += place(kid, depth + 1);
    }
    const row = total / kids.length;
    rowsOfNode.set(id, row);
    return row;
  };

  for (const id of ids) {
    if (String(rows[id]![PREREQUISITE_FIELD]) === NO_PREREQUISITE && !visited.has(id)) {
      place(id, 0);
    }
  }
  // Anything left over hangs off a cycle, so it has no root to descend from.
  for (const id of ids) {
    if (!visited.has(id)) {
      place(id, 0);
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    positions.set(id, {
      x: ORIGIN_X + (depths.get(id) ?? 0) * COLUMN_STEP,
      y: ORIGIN_Y + (rowsOfNode.get(id) ?? 0) * ROW_STEP,
    });
  }
  return positions;
}

/** True while both coordinates are zero, which is the "lay me out" sentinel. */
function isAutoPlaced(row: Row): boolean {
  return Number(row[NODE_X_FIELD]) === 0 && Number(row[NODE_Y_FIELD]) === 0;
}

function buildGraph(config: GameConfig): Graph {
  const rows = rowsOf(config);
  const cycleIds = prerequisiteCycleIds(config);
  const onCycle = new Set(cycleIds);
  const auto = autoLayout(rows);

  const nodes: GraphNode[] = BUILDING_ENTITIES.map(([id, entity]) => {
    const row = rows[id]!;
    const fallback = auto.get(id)!;
    const placedAutomatically = isAutoPlaced(row);
    return {
      id,
      label: entity.label,
      x: placedAutomatically ? fallback.x : Number(row[NODE_X_FIELD]),
      y: placedAutomatically ? fallback.y : Number(row[NODE_Y_FIELD]),
      requires: String(row[PREREQUISITE_FIELD]),
      auto: placedAutomatically,
      onCycle: onCycle.has(id),
      costWood: Number(row.costWood),
      costStone: Number(row.costStone),
      costGold: Number(row.costGold),
      buildTimeSec: Number(row.buildTimeSec),
    };
  });

  const known = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    if (node.requires === NO_PREREQUISITE || !known.has(node.requires)) {
      continue;
    }
    edges.push({
      from: node.requires,
      to: node.id,
      onCycle: onCycle.has(node.id) && onCycle.has(node.requires),
    });
  }

  return { nodes, edges, cycleIds };
}

/**
 * The curve one edge follows: out of the right side of the parent, into the
 * left side of the child. Drawing and hit-testing share it, so the band the
 * pointer can grab is exactly the line the user sees.
 */
function edgeCurve(from: GraphNode, to: GraphNode): EdgeCurve {
  const startX = from.x + NODE_WIDTH;
  const startY = from.y + NODE_HEIGHT / 2;
  const endY = to.y + NODE_HEIGHT / 2;
  const bend = Math.max(50, Math.abs(to.x - startX) * 0.45);
  return {
    startX,
    startY,
    bend1X: startX + bend,
    bend1Y: startY,
    bend2X: to.x - bend,
    bend2Y: endY,
    endX: to.x - ARROW_GAP,
    endY,
  };
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

function edgePointAt(curve: EdgeCurve, t: number): { x: number; y: number } {
  return {
    x: cubic(curve.startX, curve.bend1X, curve.bend2X, curve.endX, t),
    y: cubic(curve.startY, curve.bend1Y, curve.bend2Y, curve.endY, t),
  };
}

const EDGE_SAMPLES = 28;

/**
 * The edge whose curve runs closest to a point, when that distance is under
 * `tolerance`. The curve is sampled instead of solved: 28 steps put every
 * sample a couple of graph units apart, which is finer than the band the
 * pointer needs.
 */
function edgeAt(graph: Graph, x: number, y: number, tolerance: number): GraphEdge | null {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  let best: GraphEdge | null = null;
  let bestDistance = tolerance;
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      continue;
    }
    const curve = edgeCurve(from, to);
    for (let step = 0; step <= EDGE_SAMPLES; step += 1) {
      const point = edgePointAt(curve, step / EDGE_SAMPLES);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = edge;
      }
    }
  }
  return best;
}

/**
 * What linking `source` as the prerequisite of `target` would do. A building
 * holds one prerequisite, so a target that already has one is a replacement,
 * not an addition — the canvas says so before the drop instead of after it.
 */
function linkVerdict(graph: Graph, sourceId: string, targetId: string): LinkVerdict {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const target = byId.get(targetId);
  const source = byId.get(sourceId);
  if (!target || !source) {
    return { kind: "self" };
  }
  if (sourceId === targetId) {
    return { kind: "self" };
  }
  // Walking up from the source is the whole cycle test: the new link points
  // target → source, so a ring exists only if the target is already above it.
  const chain: string[] = [];
  const seen = new Set<string>([sourceId]);
  let current = source.requires;
  while (current !== NO_PREREQUISITE && byId.has(current) && !seen.has(current)) {
    chain.push(byId.get(current)!.label);
    if (current === targetId) {
      return { kind: "cycle", ring: [target.label, source.label, ...chain] };
    }
    seen.add(current);
    current = byId.get(current)!.requires;
  }
  const previous = byId.get(target.requires);
  if (previous) {
    return { kind: "replace", previousLabel: previous.label };
  }
  return { kind: "ok" };
}

export type { EdgeCurve, Graph, GraphEdge, GraphNode, LinkVerdict };
export {
  BUILDINGS,
  BUILDING_ENTITIES,
  NODE_HEIGHT,
  NODE_WIDTH,
  buildGraph,
  edgeAt,
  edgeCurve,
  edgePointAt,
  linkVerdict,
};
