import Database from "better-sqlite3";

const main = async () => {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS provinces (id TEXT PRIMARY KEY NOT NULL, turnover INTEGER NOT NULL) STRICT");

  db.prepare("INSERT INTO provinces (id, turnover) VALUES (?, ?)").run("1", 500_000);
  db.prepare("INSERT INTO provinces (id, turnover) VALUES (@name, @turnover)").run({
    name: "2",
    turnover: 500_000,
  });

  const select = db.prepare("SELECT * FROM provinces");
  console.log(select.all());
};

void main();
