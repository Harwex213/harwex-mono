--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

PRAGMA foreign_keys = OFF;

-- if not exist because bot was launched without migrations firstly
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

-- if not exist because bot was launched without migrations firstly
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

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX idx_reminders_user_id;
DROP INDEX idx_reminders_target_date;
DROP TABLE users;
DROP TABLE reminders;