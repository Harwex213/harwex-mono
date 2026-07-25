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
  if (!world.animals) {
    world.animals = new Map();
  }
  return world;
}

export type { Snapshot };
export { saveSnapshot, loadSnapshot, AUTOSAVE_KEY };
