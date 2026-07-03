import Database from "better-sqlite3";

const main = async () => {
  /** Что делает `Database` инстанс? */
  const db = new Database(":memory:");
  /** колл `pragma` во что конвертируется? */
  /** journal_mode = WAL что устанавливает и на что влияет? */
  db.pragma("journal_mode = WAL");
  /** схема create table команды? */
  db.exec("CREATE TABLE IF NOT EXISTS provinces (id TEXT PRIMARY KEY NOT NULL, turnover INTEGER NOT NULL) STRICT");

  db.prepare("INSERT INTO provinces (id, turnover) VALUES (?, ?)").run("1", 500_000);
  db.prepare("INSERT INTO provinces (id, turnover) VALUES (@name, @turnover)").run({
    name: "2",
    turnover: 500_000,
  });

  /** А поточно можно как-то доставать, чтобы не убить память? */
  const select = db.prepare("SELECT * FROM provinces");
  console.log(select.all());
};

void main();
