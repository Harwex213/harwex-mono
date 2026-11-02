import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { TAction, TFormat, TSide } from "./veto.ts";

type TPickRow = {
  id: string;
  createdAt: string;
  format: TFormat;
  teamA: string;
  teamB: string;
  hostToken: string;
  guestToken: string | null;
  firstSide: TSide | null;
};

// DATA_DIR points at a volume in the container. Locally the data sits in backend/data.
const DATA_DIR = process.env.DATA_DIR
  ? pathToFileURL(`${process.env.DATA_DIR.replace(/\/$/, "")}/`)
  : new URL("../data/", import.meta.url);

const openDb = (file = new URL("picks.sqlite", DATA_DIR)) => {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS picks (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      format TEXT NOT NULL,
      team_a TEXT NOT NULL,
      team_b TEXT NOT NULL,
      host_token TEXT NOT NULL,
      guest_token TEXT,
      first_side TEXT
    );
    CREATE TABLE IF NOT EXISTS actions (
      pick_id TEXT NOT NULL REFERENCES picks(id),
      step INTEGER NOT NULL,
      side TEXT NOT NULL,
      kind TEXT NOT NULL,
      map TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (pick_id, step)
    );
  `);

  const insertPick = db.prepare(`
    INSERT INTO picks (id, created_at, format, team_a, team_b, host_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectPick = db.prepare(`
    SELECT id, created_at AS createdAt, format, team_a AS teamA, team_b AS teamB,
      host_token AS hostToken, guest_token AS guestToken, first_side AS firstSide
    FROM picks WHERE id = ?
  `);
  // The guest slot is taken once: the WHERE clause makes a second join a no-op.
  const updateGuest = db.prepare(`
    UPDATE picks SET guest_token = ?, first_side = ? WHERE id = ? AND guest_token IS NULL
  `);
  const insertAction = db.prepare(`
    INSERT INTO actions (pick_id, step, side, kind, map, created_at) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectActions = db.prepare(`
    SELECT step, side, kind, map FROM actions WHERE pick_id = ? ORDER BY step
  `);

  return {
    createPick: (pick: Omit<TPickRow, "guestToken" | "firstSide">) => {
      insertPick.run(pick.id, pick.createdAt, pick.format, pick.teamA, pick.teamB, pick.hostToken);
    },
    getPick: (id: string) => {
      return selectPick.get(id) as TPickRow | undefined;
    },
    joinPick: (id: string, guestToken: string, firstSide: TSide) => {
      return updateGuest.run(guestToken, firstSide, id).changes === 1;
    },
    addAction: (id: string, action: TAction) => {
      insertAction.run(id, action.step, action.side, action.kind, action.map, new Date().toISOString());
    },
    getActions: (id: string) => {
      return selectActions.all(id) as TAction[];
    },
  };
};

type TDb = ReturnType<typeof openDb>;

export type { TDb, TPickRow };
export { openDb, DATA_DIR };
