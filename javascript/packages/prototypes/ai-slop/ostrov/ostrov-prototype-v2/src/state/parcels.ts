import { config } from "@hw/ostrov-prototype-v2-config";
import type { BuildingId } from "../buildings/catalog";
import { CASTLE_ID, productionOf } from "../buildings/catalog";
import type { Traveller } from "../economy/lanes";
import { advanceTravellers, roomAtStart } from "../economy/lanes";
import type { RoadLeg, Route, RouteTree } from "../economy/routes";
import { buildRoutes, legsOf, spotOn } from "../economy/routes";
import type { ResourceKind } from "../economy/stock";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import { hexToWorld } from "../hex/layout";
import type { WorldMap } from "../map/world";
import { DELIVERY_BEAT_SEC, PARCEL_MIN_INTERVAL_SEC } from "../tuning";
import type { PlacedBuilding } from "./buildings";
import { buildings } from "./buildings";
import { credit } from "./resources";
import { world } from "./signals";

/**
 * Goods on the road.
 *
 * Every finished producer sends its output to the castle as a crate that walks
 * the land, hex centre by hex centre, and the resource is credited where the
 * crate lands rather than where it was dug. Three pieces do the work and none of
 * them knows about the other two: `economy/routes.ts` grows the tree of roads,
 * `economy/lanes.ts` keeps the crates in single file on it, and this module is
 * the clock — it decides when a producer sends one and what happens on arrival.
 *
 * Nothing here starts a loop of its own. `advanceEconomy` is called once from
 * the map's render loop, and `economyAnimating` tells that loop to keep asking
 * for frames while anything is still moving.
 */

/** Why a producer is sending nothing. */
type StallReason = "none" | "noCastle" | "noRoute";

type Producer = {
  key: string;
  hex: Axial;
  id: BuildingId;
  kind: ResourceKind;
  /** Seconds between two crates, after the demo speed-up. */
  interval: number;
  /** `performance.now()` of the next crate. */
  nextAt: number;
  stall: StallReason;
  /** Crates banked at the building because nothing could carry them yet. */
  stored: number;
  route: Route | null;
};

type Parcel = Traveller & {
  kind: ResourceKind;
  amount: number;
  /** Segment of the road the last lookup landed in, handed back as a hint. */
  hint: number;
  x: number;
  y: number;
  /** Hex the crate is over, so the painter draws it in the tile's own order. */
  hex: string;
  bornAt: number;
};

/** The beat played where a crate landed. */
type Delivery = {
  x: number;
  y: number;
  kind: ResourceKind;
  amount: number;
  /** `performance.now()` of the landing. */
  at: number;
};

/** What the building art needs to say why nothing is flowing. */
type Stall = {
  reason: StallReason;
  stored: number;
  kind: ResourceKind;
};

const producers = new Map<string, Producer>();

const parcels: Parcel[] = [];

const deliveries: Delivery[] = [];

/** Every leg of every live road, each one exactly once, for the ground track. */
let roads: RoadLeg[] = [];

/** Set whenever a road or a producer changed, so `roads` is rebuilt once. */
let roadsDirty = true;

let tree: RouteTree | null = null;

let treeWorld: WorldMap | null = null;

/** The castle hexes the current tree was grown from, as one comparable string. */
let treeCastles = "?";

let nextParcelId = 1;

/** Seconds between two crates from this building, after the demo speed-up. */
function intervalOf(id: BuildingId): number {
  const perMinute = config.buildings[id].productionPerMin;
  if (perMinute <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(PARCEL_MIN_INTERVAL_SEC, 60 / perMinute / config.economy.productionSpeedup);
}

function castleSignature(list: readonly PlacedBuilding[]): string {
  const keys: string[] = [];
  for (const building of list) {
    if (building.id === CASTLE_ID && building.state === "built") {
      keys.push(hexKey(building.q, building.r));
    }
  }
  return keys.sort().join(";");
}

/**
 * Regrows the tree of roads when the castles or the world have changed.
 *
 * Crates already on the road keep the `Route` object they were handed, so a
 * castle finished mid-journey never teleports anything: the crates in flight run
 * out their old road and everything sent after that takes the new one.
 */
function ensureTree(map: WorldMap, list: readonly PlacedBuilding[]): RouteTree {
  const signature = castleSignature(list);
  if (tree && treeWorld === map && treeCastles === signature) {
    return tree;
  }
  const castles: Axial[] = [];
  for (const building of list) {
    if (building.id === CASTLE_ID && building.state === "built") {
      castles.push({ q: building.q, r: building.r });
    }
  }
  treeWorld = map;
  treeCastles = signature;
  tree = buildRoutes({
    castles,
    isLand: (q, r) => map.byKey.has(hexKey(q, r)),
    toWorld: hexToWorld,
  });
  for (const producer of producers.values()) {
    producer.route = tree.routeOf(producer.hex);
  }
  roadsDirty = true;
  return tree;
}

/** Drops everything a previous world's roads and crates said. */
function resetIfWorldChanged(map: WorldMap): void {
  if (treeWorld === map || treeWorld === null) {
    return;
  }
  producers.clear();
  parcels.length = 0;
  deliveries.length = 0;
  roads = [];
  tree = null;
  treeCastles = "?";
}

/** Adds a producer for every finished production building, and drops the rest. */
function syncProducers(list: readonly PlacedBuilding[], now: number, current: RouteTree): void {
  const live = new Set<string>();
  for (const building of list) {
    if (building.state !== "built") {
      continue;
    }
    const kind = productionOf(building.id);
    if (kind === null) {
      continue;
    }
    const key = hexKey(building.q, building.r);
    live.add(key);
    if (producers.has(key)) {
      continue;
    }
    const hex: Axial = { q: building.q, r: building.r };
    const interval = intervalOf(building.id);
    producers.set(key, {
      key,
      hex,
      id: building.id,
      kind,
      interval,
      nextAt: now + interval * 1000,
      stall: "none",
      stored: 0,
      route: current.routeOf(hex),
    });
  }
  for (const key of [...producers.keys()]) {
    if (!live.has(key)) {
      producers.delete(key);
    }
  }
}

function emit(producer: Producer, route: Route, now: number): void {
  const parcel: Parcel = {
    id: nextParcelId,
    route,
    remaining: route.length,
    kind: producer.kind,
    amount: config.economy.parcelCarry,
    hint: 0,
    x: route.points[0]!.x,
    y: route.points[0]!.y,
    hex: route.hexes[0]!,
    bornAt: now,
  };
  nextParcelId += 1;
  parcels.push(parcel);
}

/**
 * One production tick: the output goes on the pile by the door, never straight
 * onto the road.
 *
 * Everything a producer makes is banked and then loaded out by `loadOut`, which
 * is what makes the three cases one case. A working building keeps a pile of
 * nought or one and the difference is invisible; a building with no castle to
 * send to keeps piling up to the cap and says so on its roof; a building whose
 * road is simply busy holds its crates until there is room, and no output is
 * ever quietly dropped on the floor.
 */
function produce(producer: Producer, current: RouteTree): void {
  producer.stall = producer.route ? "none" : current.empty ? "noCastle" : "noRoute";
  producer.stored = Math.min(config.economy.stallStockpileCap, producer.stored + 1);
}

/**
 * Puts as much of every producer's pile on the road as the road will take. Run
 * once a frame rather than once a production tick, so a pile banked during a
 * stall drains at the speed of the road instead of at the speed of the mine.
 */
function loadOut(current: RouteTree, now: number, spacing: number): void {
  for (const producer of producers.values()) {
    const route = producer.route;
    if (!route || producer.stored <= 0) {
      continue;
    }
    while (producer.stored > 0 && roomAtStart(current, route, parcels, spacing)) {
      emit(producer, route, now);
      producer.stored -= 1;
    }
  }
}

/** Rebuilds the track: the roads of every producer that has one, cut into legs. */
function refreshRoads(): void {
  const seen = new Set<string>();
  const routes: Route[] = [];
  for (const producer of producers.values()) {
    const route = producer.route;
    if (!route || seen.has(route.id)) {
      continue;
    }
    seen.add(route.id);
    routes.push(route);
  }
  roads = legsOf(routes);
}

/**
 * One step of the whole economy: who produced, who moved, who arrived.
 *
 * `now` is the frame stamp in milliseconds and `seconds` the step the caller
 * already clamped, so a tab that was in the background cannot fling a crate
 * across the island.
 */
function advanceEconomy(now: number, seconds: number): void {
  if (!config.economy.enabled) {
    return;
  }
  const map = world.peek();
  resetIfWorldChanged(map);
  const list = buildings.peek();
  const placed = [...list.values()];
  const current = ensureTree(map, placed);
  const before = producers.size;
  syncProducers(placed, now, current);
  if (producers.size !== before) {
    roadsDirty = true;
  }
  if (roadsDirty) {
    refreshRoads();
    roadsDirty = false;
  }

  const spacing = config.economy.parcelSpacing;
  for (const producer of producers.values()) {
    const step = producer.interval * 1000;
    if (!Number.isFinite(step)) {
      continue;
    }
    // A producer that fell far behind — a background tab, a long stall — catches
    // up by one crate and then keeps its cadence, instead of firing a hundred.
    if (now - producer.nextAt > step * 4) {
      producer.nextAt = now - step;
    }
    while (now >= producer.nextAt) {
      producer.nextAt += step;
      produce(producer, current);
    }
  }
  loadOut(current, now, spacing);

  if (parcels.length > 0) {
    advanceTravellers(parcels, current, seconds, config.economy.parcelSpeed, spacing);
    for (let index = parcels.length - 1; index >= 0; index -= 1) {
      const parcel = parcels[index]!;
      if (parcel.remaining > 0) {
        const spot = spotOn(parcel.route, parcel.remaining, parcel.hint);
        parcel.x = spot.x;
        parcel.y = spot.y;
        parcel.hex = spot.hex;
        parcel.hint = spot.index;
        continue;
      }
      credit(parcel.kind, parcel.amount);
      const end = parcel.route.points[parcel.route.points.length - 1]!;
      deliveries.push({ x: end.x, y: end.y, kind: parcel.kind, amount: parcel.amount, at: now });
      parcels.splice(index, 1);
    }
  }

  for (let index = deliveries.length - 1; index >= 0; index -= 1) {
    if (now - deliveries[index]!.at > DELIVERY_BEAT_SEC * 1000) {
      deliveries.splice(index, 1);
    }
  }
}

/** True while a crate is on the road or a landing beat is still playing. */
function economyAnimating(): boolean {
  if (!config.economy.enabled) {
    return false;
  }
  return parcels.length > 0 || deliveries.length > 0 || producers.size > 0;
}

/** Live data for the painter. Read it during the frame; never hold onto it. */
function parcelsInFlight(): readonly Parcel[] {
  return parcels;
}

function deliveryBeats(): readonly Delivery[] {
  return deliveries;
}

function roadLines(): readonly RoadLeg[] {
  return roads;
}

/**
 * Smallest pile worth putting a number on the roof for. A working building
 * carries nought or one crate at the door and that is not news.
 */
const BACKLOG_WORTH_SHOWING = 2;

const stalls = new Map<string, Stall>();

/** What each producer has to say for itself, keyed by its hex. Live data. */
function stallsByHex(): ReadonlyMap<string, Stall> {
  stalls.clear();
  for (const producer of producers.values()) {
    if (producer.stall === "none" && producer.stored < BACKLOG_WORTH_SHOWING) {
      continue;
    }
    stalls.set(producer.key, { reason: producer.stall, stored: producer.stored, kind: producer.kind });
  }
  return stalls;
}

export type { Delivery, Parcel, Stall, StallReason };
export { advanceEconomy, deliveryBeats, economyAnimating, parcelsInFlight, roadLines, stallsByHex };
