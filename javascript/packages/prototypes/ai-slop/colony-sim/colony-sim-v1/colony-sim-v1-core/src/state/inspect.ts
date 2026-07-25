import { isDeadLands, isWalkable, Terrain, tileIndex } from "../sim/grid";
import { BUILDING_DEFS, DEFAULT_PLAYER, RESOURCE_DEFS } from "../data/defs";
import {
  AnimalKind,
  type Building,
  type EntityId,
  type Inventory,
  JobKind,
  type PlayerId,
  type ResourceKind,
} from "../sim/components";
import { objectKindOf, type World } from "../sim/world";
import type { Selection } from "./signals";

// Read model for the HUD's selection panel: label/value rows, no World types
// leaking into the DOM layer.
interface SelectionDetails {
  title: string;
  rows: [string, string][];
}

// The resource readout, one number per kind. A read model and not world state: the
// resources themselves are inside the stores, and a counter beside them would be a
// second truth waiting to drift away from the buildings it counts.
type Stock = Record<ResourceKind, number>;

// Read model for the colonists panel: one row per colonist, already formatted.
// Who owns a colonist is not in here: the HUD speaks for one colony, and ownership
// only survives where it does work — the sprite sheet the renderer picks.
interface ColonistRow {
  id: EntityId;
  title: string;
  job: string;
  hunger: string;
  fatigue: string;
}

const TERRAIN_NAMES: Record<Terrain, string> = {
  [Terrain.Grass]: "grass",
  [Terrain.Water]: "water",
  [Terrain.Rock]: "rock",
  [Terrain.Mountain]: "mountain",
};

const JOB_NAMES: Record<JobKind, string> = {
  [JobKind.Wander]: "wander",
  [JobKind.HarvestTree]: "harvest tree",
  [JobKind.Haul]: "haul",
};

const ANIMAL_NAMES: Record<AnimalKind, string> = {
  [AnimalKind.Chicken]: "chicken",
};

// Flattens the selected thing into panel rows. Recomputed once per tick (and on
// every selection change), so needs stay live without mirroring per-entity data
// into signals.
function describeSelection(world: World, selected: Selection | null): SelectionDetails | null {
  if (!selected) {
    return null;
  }
  if (selected.kind === "tile") {
    return describeTile(world, selected.x, selected.y);
  }
  return describeEntity(world, selected.id);
}

function describeTile(world: World, x: number, y: number): SelectionDetails {
  const terrain = world.grid.terrain[tileIndex(world.grid, x, y)] as Terrain;
  const rows: [string, string][] = [
    ["terrain", TERRAIN_NAMES[terrain]],
    ["walkable", isWalkable(world.grid, x, y) ? "yes" : "no"],
    // Which land the tile belongs to, because walkable ground a colonist refuses to
    // wander onto otherwise looks like a pathfinding bug.
    ["region", isDeadLands(world.grid, x, y) ? "dead lands" : "peace lands"],
  ];
  // The spot the map chose for the colony, and the one the camera opens on. Named
  // rather than left as an unexplained gold square on the ground.
  if (world.stockpile.x === x && world.stockpile.y === y) {
    rows.push(["colony", "origin"]);
  }
  return { title: `tile ${x}, ${y}`, rows };
}

function describeEntity(world: World, id: EntityId): SelectionDetails | null {
  const pos = world.positions.get(id);
  if (!pos) {
    return null;
  }
  const at = `${Math.floor(pos.x)}, ${Math.floor(pos.y)}`;

  const animal = world.animals.get(id);
  if (animal) {
    return {
      title: `${ANIMAL_NAMES[animal.kind]} #${id}`,
      rows: [
        ["at", at],
        ["state", world.paths.has(id) ? "roaming" : "idle"],
      ],
    };
  }

  const item = world.items.get(id);
  if (item) {
    return { title: `${item.kind} #${id}`, rows: [["at", at], ["amount", String(item.amount)]] };
  }

  const building = world.buildings.get(id);
  if (building) {
    return describeBuilding(building, id, at);
  }

  // A standing object reports the drop it is holding, straight from the table the
  // destruction path reads — so the panel cannot promise a yield the sim will not
  // deliver.
  const objectKind = objectKindOf(world, id);
  if (objectKind) {
    const def = RESOURCE_DEFS[objectKind];
    return { title: `${objectKind} #${id}`, rows: [["at", at], ["yields", `${def.amount} ${def.yields}`]] };
  }

  const needs = world.needs.get(id);
  if (!needs) {
    return null;
  }
  const job = world.jobs.get(id);
  return {
    title: `colonist #${id}`,
    rows: [
      ["at", at],
      ["job", job ? JOB_NAMES[job.kind] : "none"],
      ["hunger", percent(needs.hunger)],
      ["fatigue", percent(needs.fatigue)],
      ["carrying", carrying(world.inventories.get(id))],
    ],
  };
}

// A building says what it is for. For a store that is the one resource it keeps —
// the same fact the badge over its roof shows, and the reason the panel leads with
// it — plus how full it is, straight off the only copy of that number. A producer
// says what it grows and how far along the next crop is; both come from the def the
// system reads, so the panel cannot promise output the sim will not deliver.
function describeBuilding(building: Building, id: EntityId, at: string): SelectionDetails {
  const def = BUILDING_DEFS[building.kind];
  const rows: [string, string][] = [["at", at]];
  if (building.stores !== null) {
    rows.push(["stores", building.stores]);
    rows.push(["stored", `${building.amount} / ${def.capacity}`]);
  }
  if (def.produces !== null && def.produceTicks > 0) {
    rows.push(["produces", def.produces]);
    rows.push(["next crop", percent(Math.min(1, building.growth / def.produceTicks))]);
  }
  return { title: `${def.label} #${id}`, rows };
}

// The colonist roster — only the viewer's own crew. `needs` is what makes an entity
// a colonist (animals have no needs and no job), so it is also the iteration order —
// insertion order, i.e. stable ascending ids.
function listColonists(world: World, player: PlayerId): ColonistRow[] {
  const rows: ColonistRow[] = [];
  for (const [id, needs] of world.needs) {
    if (ownerOf(world, id) !== player) {
      continue;
    }
    const job = world.jobs.get(id);
    rows.push({
      id,
      title: `colonist #${id}`,
      job: job ? JOB_NAMES[job.kind] : "none",
      hunger: percent(needs.hunger),
      fatigue: percent(needs.fatigue),
    });
  }
  return rows;
}

// The viewer's headcount, over the same Map that defines what a colonist is. Counted
// rather than kept as a running tally: a spawn and a despawn would each have to
// remember to touch the tally, and one that forgot would be a headcount drifting away
// from the world with nothing to correct it.
function countColonists(world: World, player: PlayerId): number {
  let count = 0;
  for (const id of world.needs.keys()) {
    if (ownerOf(world, id) === player) {
      count += 1;
    }
  }
  return count;
}

// The viewer's resources, summed out of the viewer's own stores. Counted rather than
// tallied for the same reason the headcount is: every deposit, every demolished
// warehouse and every load dropped on the ground would have to remember to touch a
// tally, and the one that forgot would be a readout with nothing to correct it.
// Other players' stores are not the viewer's business — the HUD speaks for one colony.
function countStock(world: World, player: PlayerId): Stock {
  const stock = zeroStock();
  for (const [id, building] of world.buildings) {
    if (building.stores === null || ownerOf(world, id) !== player) {
      continue;
    }
    stock[building.stores] += building.amount;
  }
  return stock;
}

function zeroStock(): Stock {
  return { wood: 0, stone: 0, food: 0 };
}

// What a colonist is holding, for the panel: empty hands are a state to name, not a
// zero of some resource it happens not to be carrying.
function carrying(inventory: Inventory | undefined): string {
  if (!inventory || inventory.kind === null || inventory.amount <= 0) {
    return "nothing";
  }
  return `${inventory.amount} ${inventory.kind}`;
}

// An entity with no owner is a bug in whoever spawned it (see spawnColonist), not a
// state the read models are allowed to invent an owner for: it is read as the default
// player's, the same fallback the renderer picks a sprite sheet by.
function ownerOf(world: World, id: EntityId): PlayerId {
  return world.owners.get(id) ?? DEFAULT_PLAYER;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export type { SelectionDetails, ColonistRow, Stock };
export { countColonists, countStock, describeSelection, listColonists, zeroStock };
