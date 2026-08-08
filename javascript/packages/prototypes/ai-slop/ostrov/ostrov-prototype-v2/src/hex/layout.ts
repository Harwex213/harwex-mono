import type { Axial } from "./coords";
import { roundAxial } from "./coords";

/** Circumradius of a hex along the x axis, in world units. */
const HEX_SIZE = 64;

/**
 * Vertical squash of the whole map. The reference art looks at the island from
 * a low angle, so every world y is multiplied by this factor and a hex top face
 * ends up about 0.6 as tall as it is wide.
 */
const SQUASH = 0.6;

/** How far the rock walls drop below a top face, in world units. */
const WALL_DEPTH = 46;

const SQRT3 = Math.sqrt(3);

/** Corner `i` sits at `60 * i` degrees; corner 0 is the right-hand vertex. */
const HEX_CORNER_ANGLES: readonly number[] = [0, 1, 2, 3, 4, 5].map((index) => (Math.PI / 3) * index);

/** Edges whose outward normal points downwards on screen, so their wall is visible. */
const WALL_EDGES: readonly number[] = [0, 1, 2];

type Point = {
  x: number;
  y: number;
};

/** Centre of a hex in world space (already squashed). */
function hexToWorld(hex: Axial): Point {
  return {
    x: HEX_SIZE * 1.5 * hex.q,
    y: HEX_SIZE * SQRT3 * (hex.r + hex.q / 2) * SQUASH,
  };
}

/** Inverse of `hexToWorld`, rounded to the containing hex. */
function worldToHex(x: number, y: number): Axial {
  const unsquashed = y / SQUASH;
  const q = ((2 / 3) * x) / HEX_SIZE;
  const r = (-x / 3 + (SQRT3 / 3) * unsquashed) / HEX_SIZE;
  return roundAxial(q, r);
}

/** The six top-face corners of a hex, in world space, in edge order. */
function hexCorners(centre: Point): Point[] {
  return HEX_CORNER_ANGLES.map((angle) => ({
    x: centre.x + HEX_SIZE * Math.cos(angle),
    y: centre.y + HEX_SIZE * Math.sin(angle) * SQUASH,
  }));
}

/** Half-extents of a hex top face, handy for decoration scattering. */
const HEX_HALF_WIDTH = HEX_SIZE;
const HEX_HALF_HEIGHT = HEX_SIZE * (SQRT3 / 2) * SQUASH;

export type { Point };
export {
  HEX_CORNER_ANGLES,
  HEX_HALF_HEIGHT,
  HEX_HALF_WIDTH,
  HEX_SIZE,
  SQUASH,
  WALL_DEPTH,
  WALL_EDGES,
  hexCorners,
  hexToWorld,
  worldToHex,
};
