import { DEFAULT_PLAYER } from "../data/defs";
import { tileIndex } from "../sim/grid";
import { SCHEMA_VERSION, type World } from "../sim/world";
import { type ColonyDb, SAVES_STORE } from "./db";

const AUTOSAVE_KEY = "autosave";

interface Snapshot {
  schemaVersion: number;
  tick: number;
  seed: number;
  world: World;
}

// IndexedDB persists via structured clone, so the World's Maps/Sets/typed
// arrays are stored as-is — no JSON.stringify, no manual (de)serialization.
async function saveSnapshot(db: ColonyDb, world: World): Promise<void> {
  const snapshot: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    tick: world.tick,
    seed: world.seed,
    world,
  };
  await db.put(SAVES_STORE, snapshot, AUTOSAVE_KEY);
}

async function loadSnapshot(db: ColonyDb): Promise<World | null> {
  const snapshot = (await db.get(SAVES_STORE, AUTOSAVE_KEY)) as Snapshot | undefined;
  if (!snapshot) {
    return null;
  }
  if (snapshot.schemaVersion !== SCHEMA_VERSION) {
    // TODO: migrate old snapshots; for the prototype we discard them.
    return null;
  }
  return hydrate(snapshot.world);
}

// The version stamp alone cannot be trusted: under HMR the save path picks up
// the new SCHEMA_VERSION while the live world object still predates the
// component Map that version added. Backfill missing Maps so a snapshot can
// never hand the systems/renderer an undefined component store.
function hydrate(world: World): World {
  // A world from before the stream lived on it resumes from the seed rather than from
  // wherever the last session's closure had got to — that position is gone with the
  // page. Not the same numbers the save would have drawn next, but a save is a
  // single-player thing: nobody is holding the other half of this stream.
  if (typeof world.rngState !== "number") {
    world.rngState = world.seed | 0;
  }
  if (!world.animals) {
    world.animals = new Map();
  }
  if (!world.rocks) {
    world.rocks = new Set();
  }
  if (!world.items) {
    world.items = new Map();
  }
  if (!world.buildings) {
    world.buildings = new Map();
  }
  // An inventory from before colonists carried stacks counted wood and nothing else,
  // and there is no stack to recover out of that number — so the hands are emptied
  // rather than left as a shape the haul job would read as a load it never picked up.
  for (const [id, inventory] of world.inventories) {
    if (!("kind" in inventory)) {
      world.inventories.set(id, { kind: null, amount: 0 });
    }
  }
  // A world from before ownership has colonists but nobody to own them, and an
  // owner-less colonist has no sprite sheet and no headcount to land in. Everything
  // such a save says about them is that they were one colony, so they all join the
  // default player rather than being left out of the component.
  if (!world.owners) {
    world.owners = new Map();
    for (const id of world.needs.keys()) {
      world.owners.set(id, DEFAULT_PLAYER);
    }
  }
  // A grid from before regions has terrain and nothing to say about which land a
  // tile belongs to. Zero-filled means peace lands everywhere, i.e. colonists
  // wander the whole map as they did before the field existed — a wrong region
  // would fence them out of their own half.
  if (!world.grid.region || world.grid.region.length !== world.grid.terrain.length) {
    world.grid.region = new Uint8Array(world.grid.terrain.length);
  }
  // Occupancy is derived from the buildings, so it is rebuilt rather than trusted:
  // a save from before the field existed has none, and one written mid-placement
  // cannot be half-right. A stale bit here is a tile nothing can walk on and nothing
  // explains.
  world.grid.blocked = new Uint8Array(world.grid.terrain.length);
  for (const id of world.buildings.keys()) {
    const pos = world.positions.get(id);
    if (pos) {
      world.grid.blocked[tileIndex(world.grid, Math.floor(pos.x), Math.floor(pos.y))] = 1;
    }
  }
  return world;
}

export type { Snapshot };
export { saveSnapshot, loadSnapshot, AUTOSAVE_KEY };
