import { SCHEMA_VERSION, type World } from "@/sim/world";
import { type ColonyDb, SAVES_STORE } from "@/persistence/db";

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
  return snapshot.world;
}

export type { Snapshot };
export { saveSnapshot, loadSnapshot, AUTOSAVE_KEY };
