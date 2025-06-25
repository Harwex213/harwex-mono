--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

-- create roles
CREATE TABLE roles
(
    id
        INTEGER
        PRIMARY KEY,
    max_reminders
        INTEGER,
    created_at
        DATETIME
        DEFAULT CURRENT_TIMESTAMP,
    updated_at
        DATETIME
        DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO roles (id, max_reminders)
VALUES
    -- ADMIN
    (1, null),
    -- ANON
    (2, 5);

-- migrate users
CREATE TABLE new_users
(
    id
        INTEGER
        PRIMARY KEY
        NOT NULL,
    chat_id
        INTEGER
        NOT NULL,
    role_id
        INTEGER
        NOT NULL,
    notify_on_start
        BOOLEAN
        NOT NULL
        DEFAULT FALSE,
    created_at
        DATETIME
        DEFAULT CURRENT_TIMESTAMP,
    updated_at
        DATETIME
        DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO new_users(id, chat_id, role_id, notify_on_start, created_at, updated_at)
SELECT id, chat_id, 2, false, created_at, updated_at
FROM users;

DROP TABLE users;

ALTER TABLE new_users
    RENAME TO users;

PRAGMA foreign_key_check;

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

-- clear roles
DROP TABLE roles;

-- migrate to previous users
CREATE TABLE new_users
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

INSERT INTO new_users(id, chat_id, created_at, updated_at)
SELECT id, chat_id, created_at, updated_at
FROM users;

DROP TABLE users;

ALTER TABLE new_users
    RENAME TO users;
