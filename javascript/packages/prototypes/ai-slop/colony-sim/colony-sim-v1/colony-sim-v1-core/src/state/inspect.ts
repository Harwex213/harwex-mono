import { isDeadLands, isWalkable, Terrain, tileIndex } from "../sim/grid";
import { RESOURCE_DEFS } from "../data/defs";
import { AnimalKind, type EntityId, JobKind } from "../sim/components";
import { objectKindOf, type World } from "../sim/world";
import type { Selection } from "./signals";

// Read model for the HUD's selection panel: label/value rows, no World types
// leaking into the DOM layer.
interface SelectionDetails {
  title: string;
  rows: [string, string][];
}

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
  if (world.stockpile.x === x && world.stockpile.y === y) {
    rows.push(["stockpile", `${world.stock.wood} wood`]);
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
      ["carrying", `${world.inventories.get(id)?.wood ?? 0} wood`],
    ],
  };
}

// The colonist roster. `needs` is what makes an entity a colonist (animals have
// no needs and no job), so it is also the iteration order — insertion order, i.e.
// stable ascending ids.
function listColonists(world: World): ColonistRow[] {
  const rows: ColonistRow[] = [];
  for (const [id, needs] of world.needs) {
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

// Headcount over the same Map that defines what a colonist is. Counted rather than
// kept as a running tally: a spawn and a despawn would each have to remember to
// touch the tally, and one that forgot would be a headcount drifting away from the
// world with nothing to correct it.
function countColonists(world: World): number {
  return world.needs.size;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export type { SelectionDetails, ColonistRow };
export { countColonists, describeSelection, listColonists };
