import { openDB, type IDBPDatabase } from "idb";

interface ColonyDbSchema {
  defs: unknown;
  saves: unknown;
}

type ColonyDb = IDBPDatabase<unknown>;

const DB_NAME = "colony-sim";
const DB_VERSION = 1;
const SAVES_STORE = "saves";
const DEFS_STORE = "defs";

function openColonyDb(): Promise<ColonyDb> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(DEFS_STORE)) {
        db.createObjectStore(DEFS_STORE);
      }
      if (!db.objectStoreNames.contains(SAVES_STORE)) {
        db.createObjectStore(SAVES_STORE);
      }
    },
  });
}

export type { ColonyDb, ColonyDbSchema };
export { openColonyDb, SAVES_STORE, DEFS_STORE };
