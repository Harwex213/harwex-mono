/** The three corners of the triangle plus the starting node in the center. */
type TBranch = "root" | "army" | "economy" | "science";

type TEffect =
  | { kind: "unlockBuilding"; target: string }
  | { kind: "unlockUnit"; target: string }
  | { kind: "improveBuilding"; target: string; note: string }
  | { kind: "improveUnit"; target: string; note: string };

type TTech = {
  id: string;
  name: string;
  branch: TBranch;
  /** 0 is the root, 1..N is the step along the trunk. */
  tier: number;
  /** Trunk nodes sit on the main line, twigs hang off a trunk node. */
  slot: "trunk" | "twig";
  requires: string[];
  /** One emoji, unique per node; the canvas draws it inside the circle. */
  icon: string;
  /** One or two plain sentences shown in the popup. */
  description: string;
  effects: TEffect[];
};

type TPoint = {
  x: number;
  y: number;
};

/** Where a node is drawn. */
type TTechLayout = {
  id: string;
  point: TPoint;
  /** Node the connecting stroke starts from (null for the root). */
  parentId: string | null;
};

export type { TBranch, TEffect, TPoint, TTech, TTechLayout };
