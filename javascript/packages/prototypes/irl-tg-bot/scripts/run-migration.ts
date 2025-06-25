import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { logger } from "../src/logger.js";

const runMigration = async () => {
  const db = await open({
    filename: "reminders.db",
    driver: sqlite3.Database,
  });

  await db.migrate();
};

runMigration().catch((err) => {
  logger.error(err);
});
