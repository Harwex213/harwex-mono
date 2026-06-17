import { type Database, open } from "sqlite";
import sqlite3 from "sqlite3";

const DB_FILENAME = "faenwald-bot.db";

async function initializeFileDatabase(): Promise<Database> {
    const db = await open({
        filename: DB_FILENAME,
        driver: sqlite3.Database,
    });

    await db.exec("PRAGMA foreign_keys = ON;");

    return db;
}

export { initializeFileDatabase, DB_FILENAME };
