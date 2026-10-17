import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// The folder inside the vault that holds the app's own files. It is hidden from the tree.
const STATE_DIR_NAME = ".harwex-notes";
const STATE_DB_FILE_NAME = "state.sqlite";
const IN_MEMORY_DB = ":memory:";

type TStateDbLocationInput = {
  stateDbPath: string | undefined;
  vaultPath: string | undefined;
};

const isSet = (value: string | undefined): value is string => {
  return value !== undefined && value.length > 0;
};

// `STATE_DB_PATH` wins. A real vault keeps its state next to its content, so moving the
// vault folder moves the state with it. The in-memory sample vault keeps nothing.
const readStateDbLocation = ({ stateDbPath, vaultPath }: TStateDbLocationInput): string => {
  if (isSet(stateDbPath)) {
    return stateDbPath;
  }

  if (isSet(vaultPath)) {
    return path.join(path.resolve(vaultPath), STATE_DIR_NAME, STATE_DB_FILE_NAME);
  }

  return IN_MEMORY_DB;
};

// Each entry moves the schema one version up. `PRAGMA user_version` holds how many have
// run. Append new entries; never edit one that has shipped.
const MIGRATIONS: readonly string[] = [
  `
    CREATE TABLE tree_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      selected_path TEXT
    );
    CREATE TABLE tree_expanded (
      path TEXT PRIMARY KEY
    );
    CREATE TABLE node_state (
      path TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (path, key)
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `,
];

const readSchemaVersion = (db: DatabaseSync): number => {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;

  return row?.user_version ?? 0;
};

const migrate = (db: DatabaseSync) => {
  const version = readSchemaVersion(db);

  if (version > MIGRATIONS.length) {
    throw new Error(`The state database is version ${version}, newer than this app (${MIGRATIONS.length})`);
  }

  for (let index = version; index < MIGRATIONS.length; index += 1) {
    db.exec("BEGIN");

    try {
      db.exec(MIGRATIONS[index] as string);
      db.exec(`PRAGMA user_version = ${index + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
};

const openStateDb = (location: string): DatabaseSync => {
  if (location !== IN_MEMORY_DB) {
    mkdirSync(path.dirname(location), { recursive: true });
  }

  const db = new DatabaseSync(location);

  migrate(db);

  return db;
};

export { STATE_DIR_NAME, openStateDb, readStateDbLocation };
