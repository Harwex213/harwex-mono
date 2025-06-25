import { type Database, open } from "sqlite";
import sqlite3 from "sqlite3";

async function execStartSql(db: Database) {
  await db.exec(`
    PRAGMA foreign_keys = ON;
  `);
}

async function initializeFileDatabase() {
  const db = await open({
    filename: "reminders.db",
    driver: sqlite3.Database,
  });

  await execStartSql(db);

  return db;
}

export {
  initializeFileDatabase,
  execStartSql,
};
