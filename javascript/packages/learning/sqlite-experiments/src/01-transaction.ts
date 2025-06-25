import { open } from "sqlite";
import sqlite3 from "sqlite3";

/**
 * Данный эксперимент приводит к выводу, что ранать SQLite транзакции через BEGIN - COMMIT - ROLLBACK
 * при обработке запросов нельзя. Более того это по видимому будет невозможно, так как следующий вызов
 * BEGIN приведёт к ошибке.
 *
 * Есть мысль что при необходимости проведения транзакции, в ходе которой будет несколько sql запросов,
 * требуется отдельный worker, который будет на каждую такую транзакцию открывать новое "соединение"
 */
(async () => {
  const db = await open({
    filename: ":memory:",
    driver: sqlite3.Database,
  });

  await db.run("BEGIN");

  await db.exec(`
      CREATE TABLE users
      (
          id
              INTEGER
              PRIMARY KEY
              NOT NULL,
          name
              TEXT
              NOT NULL,
          created_at
              DATETIME
              DEFAULT CURRENT_TIMESTAMP,
          updated_at
              DATETIME
              DEFAULT CURRENT_TIMESTAMP
      );
  `);

  await db.run("INSERT INTO users (name) VALUES ('ameba')");

  const result = await db.get("SELECT * FROM users");
  console.log(result);

  await db.run("ROLLBACK");

  await db.exec(`
      CREATE TABLE users
      (
          id
              INTEGER
              PRIMARY KEY
              NOT NULL,
          name
              TEXT
              NOT NULL,
          created_at
              DATETIME
              DEFAULT CURRENT_TIMESTAMP,
          updated_at
              DATETIME
              DEFAULT CURRENT_TIMESTAMP
      );
  `);
})().catch((err) => {
  console.error(err);
});
