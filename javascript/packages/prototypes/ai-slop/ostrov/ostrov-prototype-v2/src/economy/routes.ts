import type { Axial } from "../hex/coords";
import { HEX_DIRECTIONS, hexKey } from "../hex/coords";
import type { Point } from "../hex/layout";

/**
 * The roads goods travel: one land path from every producer to a castle.
 *
 * The set is a breadth-first FOREST rather than one tree. Each castle opens an
 * intake lane on every hex direction it can be approached from — up to six — and
 * the search is grown from those approach hexes, not from the castle itself. The
 * castle hexes are marked before the search starts and are never expanded, so no
 * road ever runs through a castle to reach another one. Every land hex therefore
 * belongs to exactly one lane: the one whose approach hex is nearest.
 *
 * That is the whole of the throughput fix. Grown from the castle, every road on
 * the island ended in the same final leg, and the queue rule that keeps crates a
 * spacing apart on a shared stretch turned that leg into a single file whatever
 * the island produced. Grown from the approach hexes, six roads reach the castle
 * over six disjoint hex sets, and six files are admitted at once.
 *
 * Inside one lane nothing has changed: it is still a tree, every hex still has
 * exactly one parent, so two routes of the same lane that meet once are
 * identical from that hex onwards. Routes merge, they never split, and the point
 * where a pair merges is a property of the pair. Two routes of DIFFERENT lanes
 * share no hex at all — only the castle centre they both end on, which is the
 * gate, not a stretch of road — so `mergeRemaining` reports no merge for them
 * and the queue leaves them alone.
 *
 * Nothing here imports the config or any signal. It takes the land test and the
 * hex-to-world projection as arguments, which is what lets the verification
 * harness run the same code Node-side against a synthetic island.
 */

type Route = {
  /** Hex key of the producer this route starts at. Also its cache key. */
  id: string;
  /**
   * Intake lane this road belongs to: the hex key of the castle approach it
   * arrives by, or of the castle itself for a producer standing on one. Two
   * roads can only ever share ground when their lane is the same.
   */
  lane: string;
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
  /**
   * How many approach hexes one castle opens, at most. Six is every direction;
   * one collapses the forest back into the single trunk this replaced.
   */
  lanes: number;
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
  /** Hex keys of the intake lanes that were opened, for the harness and the tests. */
  lanes: readonly string[];
};

/** One hex of the forest: where it is, what leads from it to the castle, whose lane it is. */
type Step = {
  q: number;
  r: number;
  parent: string | null;
  lane: string;
};

/** Roads never share a hex across two intake lanes, nor across two castles. */
const NO_MERGE = Number.NEGATIVE_INFINITY;

function compareHexes(left: Axial, right: Axial): number {
  if (left.q !== right.q) {
    return left.q - right.q;
  }
  return left.r - right.r;
}

/**
 * Grows the forest of roads. The cost is one breadth-first walk over the land
 * the castles can reach, which is a few hundred hexes on an island of nine —
 * cheap enough that the caller rebuilds the whole thing whenever a castle
 * appears rather than patching it.
 *
 * The walk is seeded with the approach hexes rather than the castles, and it is
 * still one walk: a hex is claimed by the first lane that reaches it, so the
 * lanes carve the island into as many wedges as the castle has approaches, and a
 * producer is served by the approach nearest to it. Nothing here looks at
 * traffic, so the same island and the same castles always give the same forest
 * and a producer's lane never changes under it.
 */
function buildRoutes(options: RouteOptions): RouteTree {
  const { isLand, toWorld } = options;
  const parents = new Map<string, Step>();
  const queue: Step[] = [];
  const lanes: string[] = [];
  // Sorted, so two castles equidistant from a hex always hand it to the same one.
  const castles = [...options.castles].sort(compareHexes);
  const gates = new Set<string>();
  // Every castle is laid down before any lane is opened. A castle is a terminal,
  // never a step of a road, so marking them all first is what stops a lane of one
  // castle from being grown through another.
  for (const castle of castles) {
    const key = hexKey(castle.q, castle.r);
    if (parents.has(key) || !isLand(castle.q, castle.r)) {
      continue;
    }
    parents.set(key, { q: castle.q, r: castle.r, parent: null, lane: key });
    gates.add(key);
  }
  const wanted = Math.max(1, Math.min(HEX_DIRECTIONS.length, Math.round(options.lanes)));
  for (const castle of castles) {
    const key = hexKey(castle.q, castle.r);
    if (!gates.has(key)) {
      continue;
    }
    let opened = 0;
    // Direction order, so which approaches a castle opens is a property of the
    // castle and of the island, never of the order the buildings were laid in.
    for (const offset of HEX_DIRECTIONS) {
      if (opened >= wanted) {
        break;
      }
      const q = castle.q + offset.q;
      const r = castle.r + offset.r;
      const next = hexKey(q, r);
      if (parents.has(next) || !isLand(q, r)) {
        continue;
      }
      const step: Step = { q, r, parent: key, lane: next };
      parents.set(next, step);
      queue.push(step);
      lanes.push(next);
      opened += 1;
    }
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
      const child: Step = { q, r, parent: key, lane: step.lane };
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
      lane: first.lane,
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
    // Different lanes are disjoint hex sets by construction. The only thing they
    // have in common is the castle centre both end on, and a crate is credited
    // and gone the instant it reaches it, so there is no stretch to share.
    if (left.lane !== right.lane) {
      return NO_MERGE;
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

  return { empty: gates.size === 0, routeOf, mergeRemaining, lanes };
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
