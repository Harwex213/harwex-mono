import { computed, signal } from "@preact/signals-react";
import type { BuildingId } from "../buildings/catalog";
import { buildingLabel, buildingSpec, constructionSeconds, prerequisiteOf } from "../buildings/catalog";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import { OWNER_PLAYER } from "../map/island";
import { tileVisible } from "./fog";
import { paySpend, resourceLabel, shortfallOf } from "./resources";
import { world } from "./signals";
import { claimAround } from "./territory";

/**
 * What is standing on the island, and what the build button is doing.
 *
 * `placing` is the first of the three lifecycle steps: it holds the building the
 * cursor is currently carrying, before any hex has been chosen. Once a hex is
 * picked the building lands in `buildings`, keyed by hex, and walks
 * `constructing` → `built` on its own clock. One building per hex.
 */

type BuildingState = "constructing" | "built";

type PlacedBuilding = {
  id: BuildingId;
  q: number;
  r: number;
  state: BuildingState;
  /** `performance.now()` of the moment the site was laid, in milliseconds. */
  startedAt: number;
  /** How long this site takes to finish, in milliseconds. */
  durationMs: number;
  /** `performance.now()` of the moment it finished, or null while it is going up. */
  completedAt: number | null;
};

/** The building the cursor is carrying, or null when the map is in its normal mode. */
const placing = signal<BuildingId | null>(null);

const buildPanelOpen = signal(false);

const buildings = signal<ReadonlyMap<string, PlacedBuilding>>(new Map());

/** Painting order needs an array, and the renderer wants it without a rebuild per frame. */
const placedBuildings = computed<readonly PlacedBuilding[]>(() => [...buildings.value.values()]);

const builtIds = computed<ReadonlySet<BuildingId>>(() => {
  const ids = new Set<BuildingId>();
  for (const building of buildings.value.values()) {
    if (building.state === "built") {
      ids.add(building.id);
    }
  }
  return ids;
});

type Availability = {
  unlocked: boolean;
  /** Why it cannot be built yet. Empty while it can. */
  reason: string;
};

/** Whether the roster entry can be picked at all, prerequisites included. */
function availabilityOf(id: BuildingId): Availability {
  const prerequisite = prerequisiteOf(id);
  if (prerequisite === null || builtIds.value.has(prerequisite)) {
    return { unlocked: true, reason: "" };
  }
  return { unlocked: false, reason: `Needs: ${buildingLabel(prerequisite)}` };
}

type PlacementCheck = {
  valid: boolean;
  /** Why this hex is refused. Empty when it is fine. */
  reason: string;
};

const PLACEMENT_OK: PlacementCheck = { valid: true, reason: "" };

/** Whether `id` may be laid on `hex` right now. */
function placementCheck(id: BuildingId, hex: Axial | null): PlacementCheck {
  if (!hex) {
    return { valid: false, reason: "Outside the island" };
  }
  const tile = world.value.byKey.get(hexKey(hex.q, hex.r));
  if (!tile) {
    return { valid: false, reason: "Outside the island" };
  }
  // Nothing is built on ground the player cannot see. Owned tiles sit at the
  // centre of their own reveal radius and are therefore always in sight, so this
  // never refuses a legal hex — it is here so the rule is written down and holds
  // whatever a designer does to the reveal radius.
  if (!tileVisible(tile)) {
    return { valid: false, reason: "Hidden by fog" };
  }
  if (tile.owner !== OWNER_PLAYER) {
    return { valid: false, reason: "Not your island" };
  }
  if (buildings.value.has(hexKey(hex.q, hex.r))) {
    return { valid: false, reason: "Hex taken" };
  }
  const wanted = buildingSpec(id).terrain;
  if (wanted !== "any" && wanted !== tile.terrain) {
    return { valid: false, reason: "Wrong biome" };
  }
  // The price is checked last on purpose. It is the one refusal that has nothing
  // to do with the hex under the cursor, and the build panel has already dimmed
  // the tile, so the player meets it knowing why.
  const missing = shortfallOf(id);
  if (missing) {
    return { valid: false, reason: `Short of: ${resourceLabel(missing)}` };
  }
  return PLACEMENT_OK;
}

/** Enters placement mode with `id`, or leaves it when `id` is already carried. */
function togglePlacing(id: BuildingId): void {
  placing.value = placing.peek() === id ? null : id;
}

function cancelPlacing(): void {
  if (placing.peek() !== null) {
    placing.value = null;
  }
}

/**
 * Lays a site on `hex` and starts its clock. Returns false when the hex refuses
 * it, or when the pile does not cover the price.
 *
 * The price is taken the moment the site is laid, not when it is finished: the
 * player is paying for the materials that go into the scaffolding, and a queue
 * of free sites laid against money nobody has would make the panel a lie.
 */
function placeBuilding(id: BuildingId, hex: Axial, now: number): boolean {
  if (!placementCheck(id, hex).valid) {
    return false;
  }
  if (!paySpend(id)) {
    return false;
  }
  const next = new Map(buildings.peek());
  next.set(hexKey(hex.q, hex.r), {
    id,
    q: hex.q,
    r: hex.r,
    state: "constructing",
    startedAt: now,
    durationMs: constructionSeconds(id) * 1000,
    completedAt: null,
  });
  buildings.value = next;
  return true;
}

/**
 * Flips every site whose clock has run out. Called once a frame; it only writes
 * the signal on the frame a building actually finishes.
 *
 * A finished building with a claim radius takes the ground around it, which is
 * how the player's territory — and with it the fog — grows. The claim lands on
 * completion rather than on placement, so a site under construction is not yet
 * worth anything.
 */
function advanceBuildings(now: number): void {
  const current = buildings.peek();
  let next: Map<string, PlacedBuilding> | null = null;
  const finished: PlacedBuilding[] = [];
  for (const [key, building] of current) {
    if (building.state !== "constructing" || now < building.startedAt + building.durationMs) {
      continue;
    }
    next = next ?? new Map(current);
    const done: PlacedBuilding = {
      ...building,
      state: "built",
      completedAt: building.startedAt + building.durationMs,
    };
    next.set(key, done);
    finished.push(done);
  }
  if (next) {
    buildings.value = next;
  }
  for (const building of finished) {
    claimAround(building, buildingSpec(building.id).claimRadius);
  }
}

/**
 * True while something on the map is still moving of its own accord: a site
 * going up, a completion beat playing, or the endless life of a finished
 * building. The render loop keeps asking for frames while this holds.
 */
function buildingsAnimating(): boolean {
  // Nothing here checks a clock: a site is going up, or a finished building is
  // waving its flag and smoking, and both run for as long as they exist.
  return buildings.peek().size > 0 || placing.peek() !== null;
}

export type { Availability, BuildingState, PlacedBuilding, PlacementCheck };
export {
  advanceBuildings,
  availabilityOf,
  buildPanelOpen,
  buildings,
  buildingsAnimating,
  builtIds,
  cancelPlacing,
  placeBuilding,
  placedBuildings,
  placementCheck,
  placing,
  togglePlacing,
};
