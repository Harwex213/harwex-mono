import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { applyDatabaseSchema } from "./schema.js";

async function initializeDatabase() {
  const db = await open({
    filename: "reminders.db",
    driver: sqlite3.Database,
  });

  // Apply the shared database schema
  await applyDatabaseSchema(db);

  return db;
}

export { initializeDatabase };
