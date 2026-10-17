import type { DatabaseSync } from "node:sqlite";
import type { TJsonValue, TTreeState } from "@hw/harwex-notes-protocol";

// A row belongs to `:path` when its path is `:path` itself or lies below it. The second
// test is not a LIKE pattern, so "_" and "%" in a file name match only themselves.
const inRange = (column: string, parameter: string) => {
  return `(${column} = :${parameter} OR substr(${column}, 1, length(:${parameter}) + 1) = :${parameter} || '/')`;
};

// Every table column that holds a vault path. A rename, a move or a delete has to reach
// all of them, so a new path-keyed table is added here and nowhere else.
const PATH_COLUMNS: readonly { table: string; column: string; onRemove: "delete" | "clear" }[] = [
  { table: "tree_expanded", column: "path", onRemove: "delete" },
  { table: "tree_state", column: "selected_path", onRemove: "clear" },
  { table: "node_state", column: "path", onRemove: "delete" },
];

const encodeValue = (value: TJsonValue): string => JSON.stringify(value);

const decodeValue = (text: string): TJsonValue => JSON.parse(text) as TJsonValue;

// UI state that survives a reload, kept apart from the vault content. Every path is
// vault-relative with "/" separators.
class StateStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  // `null` until the tree state is saved for the first time.
  readTreeState = (): TTreeState | null => {
    const row = this.#db.prepare("SELECT selected_path FROM tree_state WHERE id = 1").get() as
      | { selected_path: string | null }
      | undefined;

    if (row === undefined) {
      return null;
    }

    const expandedRows = this.#db.prepare("SELECT path FROM tree_expanded ORDER BY path").all() as {
      path: string;
    }[];

    return {
      expandedPaths: expandedRows.map((expandedRow) => expandedRow.path),
      selectedPath: row.selected_path,
    };
  };

  writeTreeState = (state: TTreeState): void => {
    this.#transaction(() => {
      this.#db
        .prepare("INSERT OR REPLACE INTO tree_state (id, selected_path) VALUES (1, :selectedPath)")
        .run({ selectedPath: state.selectedPath });
      this.#db.exec("DELETE FROM tree_expanded");

      const insert = this.#db.prepare("INSERT OR IGNORE INTO tree_expanded (path) VALUES (:path)");
      for (const expandedPath of state.expandedPaths) {
        insert.run({ path: expandedPath });
      }
    });
  };

  readNodeState = (nodePath: string, key: string): TJsonValue | null => {
    const row = this.#db
      .prepare("SELECT value FROM node_state WHERE path = :path AND key = :key")
      .get({ path: nodePath, key }) as { value: string } | undefined;

    return row === undefined ? null : decodeValue(row.value);
  };

  // `null` removes the row.
  writeNodeState = (nodePath: string, key: string, value: TJsonValue | null): void => {
    if (value === null) {
      this.#db.prepare("DELETE FROM node_state WHERE path = :path AND key = :key").run({ path: nodePath, key });

      return;
    }

    this.#db
      .prepare("INSERT OR REPLACE INTO node_state (path, key, value) VALUES (:path, :key, :value)")
      .run({ path: nodePath, key, value: encodeValue(value) });
  };

  readSetting = (key: string): TJsonValue | null => {
    const row = this.#db.prepare("SELECT value FROM settings WHERE key = :key").get({ key }) as
      | { value: string }
      | undefined;

    return row === undefined ? null : decodeValue(row.value);
  };

  readSettings = (): Readonly<Record<string, TJsonValue>> => {
    const rows = this.#db.prepare("SELECT key, value FROM settings ORDER BY key").all() as {
      key: string;
      value: string;
    }[];

    return Object.fromEntries(rows.map((row) => [row.key, decodeValue(row.value)]));
  };

  // `null` removes the row.
  writeSetting = (key: string, value: TJsonValue | null): void => {
    if (value === null) {
      this.#db.prepare("DELETE FROM settings WHERE key = :key").run({ key });

      return;
    }

    this.#db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (:key, :value)")
      .run({ key, value: encodeValue(value) });
  };

  // A rename or a move. Rows of `fromPath` and of everything below it move to `toPath`.
  // Stale rows already sitting at `toPath` are dropped first, so the moved rows win.
  movePath = (fromPath: string, toPath: string): void => {
    if (fromPath === toPath) {
      return;
    }

    this.#transaction(() => {
      this.#removeRange(toPath, fromPath);

      for (const { table, column } of PATH_COLUMNS) {
        this.#db
          .prepare(
            `UPDATE ${table} SET ${column} = :to || substr(${column}, length(:from) + 1) WHERE ${inRange(column, "from")}`
          )
          .run({ from: fromPath, to: toPath });
      }
    });
  };

  // A delete. Rows of `nodePath` and of everything below it go away.
  removePath = (nodePath: string): void => {
    this.#transaction(() => {
      this.#removeRange(nodePath, null);
    });
  };

  #removeRange(nodePath: string, keptPath: string | null): void {
    const keep = keptPath === null ? "" : ` AND NOT ${inRange("{column}", "kept")}`;

    for (const { table, column, onRemove } of PATH_COLUMNS) {
      const where = `${inRange(column, "path")}${keep.replaceAll("{column}", column)}`;
      const sql = onRemove === "delete"
        ? `DELETE FROM ${table} WHERE ${where}`
        : `UPDATE ${table} SET ${column} = NULL WHERE ${where}`;
      const parameters: Record<string, string> = keptPath === null
        ? { path: nodePath }
        : { path: nodePath, kept: keptPath };

      this.#db.prepare(sql).run(parameters);
    }
  }

  #transaction(task: () => void): void {
    this.#db.exec("BEGIN");

    try {
      task();
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
}

export { StateStore };
