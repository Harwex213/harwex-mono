import type { Database } from "sqlite";

/**
 * Database schema creation SQL.
 * This is the single source of truth for the database schema.
 */
const DATABASE_SCHEMA = `
    CREATE TABLE IF NOT EXISTS users
    (
        id
            INTEGER
            PRIMARY KEY
            NOT NULL,
        chat_id
            INTEGER
            NOT NULL,
        created_at
            DATETIME
            DEFAULT CURRENT_TIMESTAMP,
        updated_at
            DATETIME
            DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reminders
    (
        id
            INTEGER
            PRIMARY KEY
            AUTOINCREMENT,
        user_id
            TEXT
            NOT NULL,
        content
            TEXT
            NOT NULL,
        target_date
            DATETIME,
        created_at
            DATETIME
            DEFAULT CURRENT_TIMESTAMP,
        updated_at
            DATETIME
            DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders (user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_target_date ON reminders (target_date);

    PRAGMA foreign_keys = ON;
`;

/**
 * Applies the database schema to the given database instance.
 * This function can be used for both production and test databases.
 */
async function applyDatabaseSchema(db: Database): Promise<void> {
  await db.exec(DATABASE_SCHEMA);
}

export {
  DATABASE_SCHEMA,
  applyDatabaseSchema,
};
