import { ROOT, TECHS, trunkOf, twigsOf } from "./tech-tree";
import type { TBranch, TPoint, TTechLayout } from "./types";

/** The viewBox leaves a margin on each side for labels that lean past the triangle. */
const VIEW_MIN_X = -90;
const VIEW_WIDTH = 1180;
const VIEW_HEIGHT = 900;

/** Triangle corners; the root sits in the centroid. */
const APEX: TPoint = { x: 500, y: 40 };
const LEFT: TPoint = { x: 40, y: 840 };
const RIGHT: TPoint = { x: 960, y: 840 };
const CENTER: TPoint = {
  x: (APEX.x + LEFT.x + RIGHT.x) / 3,
  y: (APEX.y + LEFT.y + RIGHT.y) / 3,
};

/** How far along the center→corner line the trunk reaches. */
const TRUNK_REACH = 0.78;
/** Twig length at the root end; twigs shrink toward the corner where the triangle narrows. */
const TWIG_LENGTH = 86;
const TRUNK_NODE_RADIUS = 11;
const TWIG_NODE_RADIUS = 7;

const CORNER: Record<Exclude<TBranch, "root">, TPoint> = {
  army: APEX,
  science: LEFT,
  economy: RIGHT,
};

type TNodePlacement = {
  id: string;
  point: TPoint;
  parentId: string | null;
};

const add = (a: TPoint, b: TPoint, scale = 1): TPoint => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });

const rotate = (v: TPoint, degrees: number): TPoint => {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
};

const placeBranchNodes = (branch: Exclude<TBranch, "root">): TNodePlacement[] => {
  const corner = CORNER[branch];
  const toCorner = { x: corner.x - CENTER.x, y: corner.y - CENTER.y };
  const distance = Math.hypot(toCorner.x, toCorner.y);
  const length = distance * TRUNK_REACH;
  const dir = { x: toCorner.x / distance, y: toCorner.y / distance };
  const normal = { x: -dir.y, y: dir.x };

  const trunk = trunkOf(branch);
  const nodes: TNodePlacement[] = [];
  let previousId = ROOT.id;

  trunk.forEach((tech, index) => {
    const t = (index + 1) / trunk.length;
    // A gentle wiggle keeps the trunk from reading as a ruler line.
    const wiggle = Math.sin(index * 2.1 + 0.6) * 14;
    const point = add(add(CENTER, dir, length * t), normal, wiggle);

    nodes.push({ id: tech.id, point, parentId: previousId });

    // One twig leans forward on the right, the other leans backward on the left.
    const twigLength = TWIG_LENGTH * (1.15 - 0.6 * t);
    twigsOf(tech.id).forEach((twig, twigIndex) => {
      const angle = twigIndex === 0 ? 58 : -118;
      const twigDir = rotate(dir, angle);
      const twigPoint = add(point, twigDir, twigIndex === 0 ? twigLength * 0.85 : twigLength);

      nodes.push({ id: twig.id, point: twigPoint, parentId: tech.id });
    });

    previousId = tech.id;
  });

  return nodes;
};

const createLayout = (): Map<string, TTechLayout> => {
  const root: TNodePlacement = { id: ROOT.id, point: CENTER, parentId: null };
  const nodes = [root, ...placeBranchNodes("army"), ...placeBranchNodes("science"), ...placeBranchNodes("economy")];
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // Keep tree order so strokes draw trunk-first.
  return new Map(TECHS.map((tech) => [tech.id, byId.get(tech.id)!]));
};

const LAYOUT = createLayout();

const layoutOf = (id: string): TTechLayout => {
  const layout = LAYOUT.get(id);
  if (!layout) {
    throw new Error(`No layout for tech: ${id}`);
  }

  return layout;
};

export {
  APEX,
  LAYOUT,
  LEFT,
  RIGHT,
  TRUNK_NODE_RADIUS,
  TWIG_NODE_RADIUS,
  VIEW_HEIGHT,
  VIEW_MIN_X,
  VIEW_WIDTH,
  layoutOf,
};
