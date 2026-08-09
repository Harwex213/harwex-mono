import type { Axial } from "../hex/coords";
import { HEX_DIRECTIONS, hexKey } from "../hex/coords";
import type { Point } from "../hex/layout";

/**
 * The roads goods travel: one land path from every producer to a castle.
 *
 * The whole set is built as a breadth-first tree grown outwards from every
 * castle at once, over land hexes only. Multi-source breadth-first search hands
 * each hex the nearest castle for free, so a second castle simply takes over the
 * half of the island it is closer to, and a producer with no land route to any
 * castle is left out of the tree entirely.
 *
 * Growing one tree instead of running a search per producer buys the property
 * the parcel queue is built on: every hex has exactly one parent, so two routes
 * that meet once are identical from that hex onwards. Routes merge, they never
 * split, and the point where a pair merges is a property of the pair rather than
 * of where the two parcels happen to be.
 *
 * Nothing here imports the config or any signal. It takes the land test and the
 * hex-to-world projection as arguments, which is what lets the verification
 * harness run the same code Node-side against a synthetic island.
 */

type Route = {
  /** Hex key of the producer this route starts at. Also its cache key. */
  id: string;
  /** Every hex of the road, producer first, castle last. */
  hexes: readonly string[];
  /** Membership of `hexes`, for the merge test. */
  keys: ReadonlySet<string>;
  /** Centre of each hex of `hexes`, in world space. */
  points: readonly Point[];
  /** Arc length from point `i` to the castle. `remainingAt[0]` is the whole trip. */
  remainingAt: readonly number[];
  length: number;
  castle: Axial;
};

/**
 * One hex-to-hex leg of a road, deduplicated across every road that uses it.
 *
 * Roads share their whole tail, so painting them one road at a time lays the
 * last stretch down once per producer and darkens it every time. The painter
 * gets the legs instead, each exactly once.
 */
type RoadLeg = {
  from: Point;
  to: Point;
  /** Hex the leg starts on, for the fog level and the cull. */
  hex: string;
};

/** Where a parcel sits on its route, and which hex it is drawn with. */
type Spot = {
  x: number;
  y: number;
  /** Hex the parcel is currently over, so the painter can draw it in tile order. */
  hex: string;
  /** Segment the point fell in, handed back as the hint for the next lookup. */
  index: number;
};

type RouteOptions = {
  /** Hexes goods are delivered to. Order does not matter; it is sorted here. */
  castles: readonly Axial[];
  /** Whether a hex is land a parcel may walk over. */
  isLand: (q: number, r: number) => boolean;
  toWorld: (hex: Axial) => Point;
};

type RouteTree = {
  /** True when no castle at all was fed in, which is a different stall to "no path". */
  empty: boolean;
  /** The road from `hex`, or null when no land path reaches a castle. */
  routeOf: (hex: Axial) => Route | null;
  /**
   * Arc length, measured to the castle, of the hex where two roads join, or
   * `-Infinity` when they never share one. Two parcels can only ever meet at or
   * after that point, so it is the whole conflict test the queue needs.
   */
  mergeRemaining: (left: Route, right: Route) => number;
};

/** One hex of the tree: where it is, and which hex leads from it to the castle. */
type Step = {
  q: number;
  r: number;
  parent: string | null;
};

/** Roads never share a hex when they run to different castles. */
const NO_MERGE = Number.NEGATIVE_INFINITY;

function compareHexes(left: Axial, right: Axial): number {
  if (left.q !== right.q) {
    return left.q - right.q;
  }
  return left.r - right.r;
}

/**
 * Grows the tree of roads. The cost is one breadth-first walk over the land the
 * castles can reach, which is a few hundred hexes on an island of nine — cheap
 * enough that the caller rebuilds the whole thing whenever a castle appears
 * rather than patching it.
 */
function buildRoutes(options: RouteOptions): RouteTree {
  const { isLand, toWorld } = options;
  const parents = new Map<string, Step>();
  const queue: Step[] = [];
  // Sorted, so two castles equidistant from a hex always hand it to the same one.
  for (const castle of [...options.castles].sort(compareHexes)) {
    const key = hexKey(castle.q, castle.r);
    if (parents.has(key) || !isLand(castle.q, castle.r)) {
      continue;
    }
    const step: Step = { q: castle.q, r: castle.r, parent: null };
    parents.set(key, step);
    queue.push(step);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const step = queue[head]!;
    const key = hexKey(step.q, step.r);
    for (const offset of HEX_DIRECTIONS) {
      const q = step.q + offset.q;
      const r = step.r + offset.r;
      const next = hexKey(q, r);
      if (parents.has(next) || !isLand(q, r)) {
        continue;
      }
      const child: Step = { q, r, parent: key };
      parents.set(next, child);
      queue.push(child);
    }
  }

  const routes = new Map<string, Route | null>();
  const merges = new Map<string, number>();

  const routeOf = (hex: Axial): Route | null => {
    const start = hexKey(hex.q, hex.r);
    const known = routes.get(start);
    if (known !== undefined) {
      return known;
    }
    const first = parents.get(start);
    if (!first) {
      routes.set(start, null);
      return null;
    }
    const hexes: string[] = [];
    const points: Point[] = [];
    let cursor: Step | undefined = first;
    let castle: Axial = first;
    while (cursor) {
      hexes.push(hexKey(cursor.q, cursor.r));
      points.push(toWorld(cursor));
      castle = cursor;
      cursor = cursor.parent === null ? undefined : parents.get(cursor.parent);
    }
    const remainingAt = new Array<number>(points.length);
    remainingAt[points.length - 1] = 0;
    for (let index = points.length - 2; index >= 0; index -= 1) {
      const here = points[index]!;
      const ahead = points[index + 1]!;
      remainingAt[index] = remainingAt[index + 1]! + Math.hypot(ahead.x - here.x, ahead.y - here.y);
    }
    const route: Route = {
      id: start,
      hexes,
      keys: new Set(hexes),
      points,
      remainingAt,
      length: remainingAt[0]!,
      castle: { q: castle.q, r: castle.r },
    };
    routes.set(start, route);
    return route;
  };

  const mergeRemaining = (left: Route, right: Route): number => {
    if (left === right) {
      return left.length;
    }
    // One entry per unordered pair: the join is a property of the two roads and
    // never of which of them asked.
    const key = left.id < right.id ? `${left.id}|${right.id}` : `${right.id}|${left.id}`;
    const known = merges.get(key);
    if (known !== undefined) {
      return known;
    }
    let found = NO_MERGE;
    for (let index = 0; index < left.hexes.length; index += 1) {
      if (right.keys.has(left.hexes[index]!)) {
        found = left.remainingAt[index]!;
        break;
      }
    }
    merges.set(key, found);
    return found;
  };

  return { empty: queue.length === 0, routeOf, mergeRemaining };
}

/**
 * The point `remaining` arc units short of the castle.
 *
 * `hint` is the segment the caller was on last time. A parcel only ever moves
 * forwards, so the search resumes there and walks a segment or two at most,
 * which keeps the lookup at a constant cost however long the road is.
 */
function spotOn(route: Route, remaining: number, hint: number): Spot {
  const last = route.points.length - 1;
  if (last <= 0) {
    const only = route.points[0]!;
    return { x: only.x, y: only.y, hex: route.hexes[0]!, index: 0 };
  }
  let index = Math.min(Math.max(0, hint), last - 1);
  while (index > 0 && route.remainingAt[index]! < remaining) {
    index -= 1;
  }
  while (index < last - 1 && route.remainingAt[index + 1]! > remaining) {
    index += 1;
  }
  const from = route.remainingAt[index]!;
  const to = route.remainingAt[index + 1]!;
  const span = from - to;
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (from - remaining) / span));
  const here = route.points[index]!;
  const ahead = route.points[index + 1]!;
  return {
    x: here.x + (ahead.x - here.x) * t,
    y: here.y + (ahead.y - here.y) * t,
    hex: t < 0.5 ? route.hexes[index]! : route.hexes[index + 1]!,
    index,
  };
}

/** Every leg of every road handed in, each one exactly once, in road order. */
function legsOf(routes: readonly Route[]): RoadLeg[] {
  const seen = new Set<string>();
  const legs: RoadLeg[] = [];
  for (const route of routes) {
    for (let index = 1; index < route.hexes.length; index += 1) {
      const key = `${route.hexes[index - 1]}>${route.hexes[index]}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      legs.push({ from: route.points[index - 1]!, to: route.points[index]!, hex: route.hexes[index - 1]! });
    }
  }
  return legs;
}

export type { RoadLeg, Route, RouteOptions, RouteTree, Spot };
export { NO_MERGE, buildRoutes, legsOf, spotOn };
