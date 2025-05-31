import type { Database } from "sqlite";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { applyDatabaseSchema } from "../db/schema";

/**
 * Creates a clean test database for each test.
 * Use this in beforeEach hooks to ensure test isolation.
 */
async function setupTestDatabase(): Promise<Database> {
  const db = await open({
    filename: ":memory:",
    driver: sqlite3.Database,
  });

  // Apply the same schema as production
  await applyDatabaseSchema(db);

  return db;
}

/**
 * Properly closes the test database.
 * Use this in afterEach hooks to clean up resources.
 */
async function teardownTestDatabase(db: Database): Promise<void> {
  await db.close();
}

export {
  setupTestDatabase,
  teardownTestDatabase,
};
