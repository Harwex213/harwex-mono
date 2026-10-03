import { HEX_SIZE } from "./hex";

/**
 * Hex-level collision between the islands of the cleanup phase. Islands never
 * rotate, so every hex of every island has the same orientation. Two such
 * hexes overlap exactly when their centres overlap on all three edge normals.
 * That makes the separating axis test exact and cheap: three dot products.
 */

const SQRT_3 = Math.sqrt(3);
/** Distance from a hex centre to the middle of an edge. */
const HEX_INRADIUS = (HEX_SIZE * SQRT_3) / 2;
/** Distance between two neighbouring hex centres. */
const HEX_STEP = HEX_SIZE * SQRT_3;
/** A pointy-top hex has its edges facing 0°, 60° and 120°. */
const AXES: readonly (readonly [number, number])[] = [0, 60, 120].map((deg) => {
  const rad = (deg * Math.PI) / 180;

  return [Math.cos(rad), Math.sin(rad)] as const;
});
/** Two facing hexes of two islands closer than this are a bridge for units. */
const BRIDGE_GAP = 12;
/** A bridge must join hexes that face each other, not two hexes a step apart. */
const BRIDGE_MAX_CENTER_DISTANCE = HEX_STEP * 1.2;
/** How much of the sideways slip two docked islands lose per tick. */
const DOCK_FRICTION = 0.3;
const SOLVER_ITERATIONS = 4;
/** Islands farther apart than their radii plus this skip the hex pass. */
const BROADPHASE_MARGIN = HEX_STEP;

/** The collision view of an island. The sim owns these objects and mutates them. */
type TBody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Inverse mass. A heavier island shoves a lighter one further. */
  invMass: number;
  /** Hex centres relative to the body position. */
  readonly localX: Float64Array;
  readonly localY: Float64Array;
  /** Centroid of the hexes, relative to the body position. */
  readonly centerX: number;
  readonly centerY: number;
  /** Centroid to the farthest hex corner. */
  readonly radius: number;
  /** A body that is sinking takes no part in collisions. */
  solid: boolean;
  /**
   * An anchored body is not pushed by an unanchored one: a guarded enemy
   * island holds its ground against the player's island. Two anchored bodies
   * still push each other by mass.
   */
  anchored: boolean;
};

type TBridge = {
  readonly a: number;
  readonly b: number;
  readonly hexA: number;
  readonly hexB: number;
};

type TPairDistance = {
  readonly a: number;
  readonly b: number;
  /** Shortest gap between any two hexes of the two islands, by the SAT measure. */
  readonly gap: number;
};

/**
 * The signed gap between two hexes with centre offset (dx, dy). Negative is an
 * overlap. `axis` is the edge normal of the best separating axis.
 */
const hexGap = (dx: number, dy: number) => {
  let best = -Infinity;
  let axis = 0;

  for (let index = 0; index < AXES.length; index += 1) {
    const normal = AXES[index] as readonly [number, number];
    const separation = Math.abs(dx * normal[0] + dy * normal[1]) - HEX_INRADIUS * 2;
    if (separation > best) {
      best = separation;
      axis = index;
    }
  }

  return { gap: best, axis };
};

const nearEnough = (a: TBody, b: TBody) => {
  const dx = b.x + b.centerX - (a.x + a.centerX);
  const dy = b.y + b.centerY - (a.y + a.centerY);

  return Math.hypot(dx, dy) < a.radius + b.radius + BROADPHASE_MARGIN;
};

/** The deepest overlap between two bodies, or `null` when they do not touch. */
const deepestOverlap = (a: TBody, b: TBody) => {
  let depth = 0;
  let normalX = 0;
  let normalY = 0;

  for (let i = 0; i < a.localX.length; i += 1) {
    const ax = a.x + (a.localX[i] as number);
    const ay = a.y + (a.localY[i] as number);

    for (let j = 0; j < b.localX.length; j += 1) {
      const dx = b.x + (b.localX[j] as number) - ax;
      const dy = b.y + (b.localY[j] as number) - ay;
      const { gap, axis } = hexGap(dx, dy);
      if (-gap > depth) {
        const normal = AXES[axis] as readonly [number, number];
        const sign = dx * normal[0] + dy * normal[1] >= 0 ? 1 : -1;
        depth = -gap;
        normalX = normal[0] * sign;
        normalY = normal[1] * sign;
      }
    }
  }

  return depth > 0 ? { depth, normalX, normalY } : null;
};

/**
 * Pushes overlapping islands apart and kills the part of their velocity that
 * drives them into each other. The push is split by inverse mass, so a big
 * island shoves a small one. Docked islands also lose some sideways slip, so
 * they stay docked instead of sliding off each other.
 */
const solveCollisions = (bodies: readonly TBody[]) => {
  for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
    let touched = false;

    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i] as TBody;
      if (!a.solid) {
        continue;
      }

      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j] as TBody;
        if (!b.solid || !nearEnough(a, b)) {
          continue;
        }

        const invA = b.anchored && !a.anchored ? a.invMass : a.anchored && !b.anchored ? 0 : a.invMass;
        const invB = a.anchored && !b.anchored ? b.invMass : b.anchored && !a.anchored ? 0 : b.invMass;
        const invSum = invA + invB;
        if (invSum === 0) {
          continue;
        }

        const overlap = deepestOverlap(a, b);
        if (!overlap) {
          continue;
        }

        touched = true;
        const { depth, normalX, normalY } = overlap;
        a.x -= normalX * depth * (invA / invSum);
        a.y -= normalY * depth * (invA / invSum);
        b.x += normalX * depth * (invB / invSum);
        b.y += normalY * depth * (invB / invSum);

        const relX = b.vx - a.vx;
        const relY = b.vy - a.vy;
        const closing = relX * normalX + relY * normalY;
        if (closing < 0) {
          const impulse = -closing / invSum;
          a.vx -= impulse * normalX * invA;
          a.vy -= impulse * normalY * invA;
          b.vx += impulse * normalX * invB;
          b.vy += impulse * normalY * invB;
        }

        if (iteration === 0) {
          const slipX = relX - closing * normalX;
          const slipY = relY - closing * normalY;
          const impulse = DOCK_FRICTION / invSum;
          a.vx += slipX * impulse * invA;
          a.vy += slipY * impulse * invA;
          b.vx -= slipX * impulse * invB;
          b.vy -= slipY * impulse * invB;
        }
      }
    }

    if (!touched) {
      break;
    }
  }
};

/**
 * Every pair of facing hexes of two islands that nearly touch. Units walk
 * across these. Also returns the smallest gap of each nearby island pair.
 */
const findBridges = (bodies: readonly TBody[]) => {
  const bridges: TBridge[] = [];
  const distances: TPairDistance[] = [];

  for (let a = 0; a < bodies.length; a += 1) {
    const bodyA = bodies[a] as TBody;
    if (!bodyA.solid) {
      continue;
    }

    for (let b = a + 1; b < bodies.length; b += 1) {
      const bodyB = bodies[b] as TBody;
      if (!bodyB.solid) {
        continue;
      }

      const dx = bodyB.x + bodyB.centerX - (bodyA.x + bodyA.centerX);
      const dy = bodyB.y + bodyB.centerY - (bodyA.y + bodyA.centerY);
      const centerGap = Math.hypot(dx, dy) - bodyA.radius - bodyB.radius;
      // Far islands still get a rough gap, so units can rally toward them.
      if (centerGap > BROADPHASE_MARGIN * 6) {
        distances.push({ a, b, gap: centerGap });

        continue;
      }

      let smallest = Infinity;

      for (let i = 0; i < bodyA.localX.length; i += 1) {
        const ax = bodyA.x + (bodyA.localX[i] as number);
        const ay = bodyA.y + (bodyA.localY[i] as number);

        for (let j = 0; j < bodyB.localX.length; j += 1) {
          const hx = bodyB.x + (bodyB.localX[j] as number) - ax;
          const hy = bodyB.y + (bodyB.localY[j] as number) - ay;
          const { gap } = hexGap(hx, hy);
          smallest = Math.min(smallest, gap);

          if (gap < BRIDGE_GAP && Math.hypot(hx, hy) < BRIDGE_MAX_CENTER_DISTANCE) {
            bridges.push({ a, b, hexA: i, hexB: j });
          }
        }
      }

      distances.push({ a, b, gap: smallest });
    }
  }

  return { bridges, distances };
};

export type { TBody, TBridge, TPairDistance };
export { BRIDGE_GAP, findBridges, HEX_INRADIUS, HEX_STEP, hexGap, solveCollisions };
