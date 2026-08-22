import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import type { Point } from "../hex/layout";
import { hexToWorld } from "../hex/layout";
import type { WorldMap } from "../map/world";
import type { RouteTree } from "./routes";
import { buildRoutes } from "./routes";

/**
 * Walking directions for units, over the same hex search the goods use.
 *
 * Nothing is re-implemented here. `buildRoutes` grows a breadth-first forest of
 * land hexes towards a set of delivery hexes and hands back, for any hex, the
 * road from it to the nearest one. That is exactly a unit's problem read
 * backwards: a rally point is a delivery hex, and every unit walking to it wants
 * the road from where it stands. So the tree is grown with the RALLY POINT as
 * the single "castle", and `routeOf(where the unit is)` is the path, already
 * pointing the right way — the goods walk producer → castle and a unit walks its
 * own hex → rally, and both are the same direction along the same road.
 *
 * The hauling tree in `state/parcels.ts` is untouched by this: it keeps its own
 * `RouteTree`, grown from the castles with the configured number of intake
 * lanes. This module keeps its own trees, one per rally point, and the two never
 * meet. `buildRoutes` itself takes the land test and the projection as
 * arguments and holds no state, which is what makes serving both possible.
 *
 * Every step of a returned path is a hex neighbour and every hex of it is land,
 * because the search only ever walks `HEX_DIRECTIONS` over hexes `isLand`
 * accepts. A unit therefore never crosses the sky between two islands.
 */

/** Approaches a rally point opens. Six is every side, which is what a crowd wants. */
const RALLY_LANES = 6;

/** One walk, from where the unit stands to the point it was sent to. */
type Walk = {
  /** Hex centres, the unit's own hex first and the destination last. */
  points: readonly Point[];
  /** The same hexes as keys, for the fog lookup and for the assertions. */
  hexes: readonly string[];
};

/** Trees keyed by destination hex. Dropped whole when the world is replaced. */
const trees = new Map<string, RouteTree>();

let source: WorldMap | null = null;

function treeFor(map: WorldMap, target: Axial): RouteTree {
  if (source !== map) {
    source = map;
    trees.clear();
  }
  const key = hexKey(target.q, target.r);
  const known = trees.get(key);
  if (known) {
    return known;
  }
  const tree = buildRoutes({
    castles: [target],
    isLand: (q, r) => map.byKey.has(hexKey(q, r)),
    toWorld: hexToWorld,
    lanes: RALLY_LANES,
  });
  trees.set(key, tree);
  return tree;
}

/**
 * The land path from `from` to `target`, or null when no chain of land hexes
 * joins them. Both ends are included; a unit already standing on the target gets
 * a path of one hex.
 */
function walkTo(map: WorldMap, target: Axial, from: Axial): Walk | null {
  const route = treeFor(map, target).routeOf(from);
  if (!route) {
    return null;
  }
  return { points: route.points, hexes: route.hexes };
}

/** Whether any land path at all reaches `target` from `from`. */
function reachable(map: WorldMap, target: Axial, from: Axial): boolean {
  return walkTo(map, target, from) !== null;
}

export type { Walk };
export { reachable, walkTo };
