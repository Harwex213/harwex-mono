//! Terminal tabs per project in a local SQLite database: count, order, names, last titles,
//! working directories and the active tab, keyed by canonical project root.
//!
//! One store thread owns the connection and opens it on the first request, so the UI thread
//! never touches the disk. The UI thread only sends a request (a non-blocking channel send,
//! which keeps the requests in order) and a job waits for the reply. `flush` waits for every
//! queued request; the app calls it once on exit.
//!
//! The database path comes from `AppOptions::terminal_db`. `None` (the default, and every test
//! that does not set one) means no persistence. `default_db_path` gives the user's file for a
//! normal run and a temp file for background mode.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};

/// The schema this build writes. A database with a newer version is left alone.
pub const SCHEMA_VERSION: i64 = 1;
const FILE_NAME: &str = "harwex-ide.sqlite";

/// One saved terminal tab.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SavedTab {
    /// The name the user gave the tab; `None` shows the shell's own title.
    pub name: Option<String>,
    /// The shell's title at save time, shown until the shell starts again.
    pub title: String,
    /// The shell's working directory at save time.
    pub cwd: Option<PathBuf>,
}

/// The terminal tabs of one project.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SavedTerminals {
    pub tabs: Vec<SavedTab>,
    pub active: usize,
}

enum Msg {
    Load(PathBuf, Sender<Result<Option<SavedTerminals>, String>>),
    Save(PathBuf, SavedTerminals, Sender<Result<(), String>>),
    Flush(Sender<()>),
}

/// A handle to the store thread. Clones share the thread; it ends when the last handle drops.
#[derive(Clone)]
pub struct TerminalStore {
    path: PathBuf,
    tx: Sender<Msg>,
}

impl TerminalStore {
    /// Starts the store thread for the database at `path`. The file is created on first use.
    pub fn new(path: PathBuf) -> TerminalStore {
        let (tx, rx) = channel();
        let db = path.clone();
        std::thread::Builder::new().name("terminal-store".into()).spawn(move || serve(db, rx)).expect("spawn the terminal store thread");
        TerminalStore { path, tx }
    }

    /// The database file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Queues a load of `root`'s tabs. `Ok(None)`: the project has no saved row.
    pub fn load(&self, root: PathBuf) -> Receiver<Result<Option<SavedTerminals>, String>> {
        let (reply, rx) = channel();
        if self.tx.send(Msg::Load(root, reply.clone())).is_err() {
            let _ = reply.send(Err("the terminal store stopped".into()));
        }
        rx
    }

    /// Queues a save of `root`'s tabs. Requests run in the order they were queued.
    pub fn save(&self, root: PathBuf, terminals: SavedTerminals) -> Receiver<Result<(), String>> {
        let (reply, rx) = channel();
        if self.tx.send(Msg::Save(root, terminals, reply.clone())).is_err() {
            let _ = reply.send(Err("the terminal store stopped".into()));
        }
        rx
    }

    /// Waits until every queued request ran, at most `timeout`. Blocks: call it on exit only.
    pub fn flush(&self, timeout: Duration) -> bool {
        let (reply, rx) = channel();
        self.tx.send(Msg::Flush(reply)).is_ok() && rx.recv_timeout(timeout).is_ok()
    }
}

/// The database of a normal run (next to eframe's own storage) or of background mode (the temp
/// dir, so agent runs never write the user's state).
pub fn default_db_path(background: bool) -> Option<PathBuf> {
    if background {
        return Some(std::env::temp_dir().join("harwex-ide-background.sqlite"));
    }
    eframe::storage_dir("harwex-ide").map(|d| d.join(FILE_NAME))
}

fn serve(path: PathBuf, rx: Receiver<Msg>) {
    let mut conn: Option<Connection> = None;
    for msg in rx {
        match msg {
            Msg::Load(root, reply) => {
                let res = with_conn(&mut conn, &path).and_then(|c| load(c, &root).map_err(|e| e.to_string()));
                let _ = reply.send(res);
            }
            Msg::Save(root, terminals, reply) => {
                let res = with_conn(&mut conn, &path).and_then(|c| save(c, &root, &terminals).map_err(|e| e.to_string()));
                let _ = reply.send(res);
            }
            Msg::Flush(reply) => {
                let _ = reply.send(());
            }
        }
    }
}

/// Opens the connection on first use. A failed open is retried on the next request.
fn with_conn<'a>(conn: &'a mut Option<Connection>, path: &Path) -> Result<&'a mut Connection, String> {
    if conn.is_none() {
        *conn = Some(open(path).map_err(|e| format!("{}: {e}", path.display()))?);
    }
    Ok(conn.as_mut().expect("just opened"))
}

/// Opens (and creates or migrates) the database at `path`.
pub fn open(path: &Path) -> Result<Connection, Box<dyn std::error::Error>> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut conn = Connection::open(path)?;
    // Two IDE processes (a background run next to the user's) may share the file.
    conn.busy_timeout(Duration::from_secs(2))?;
    migrate(&mut conn)?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> Result<(), Box<dyn std::error::Error>> {
    let tx = conn.transaction()?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS version (version INTEGER NOT NULL);")?;
    let version: Option<i64> = tx.query_row("SELECT max(version) FROM version", [], |r| r.get(0))?;
    let version = version.unwrap_or(0);
    if version > SCHEMA_VERSION {
        return Err(format!("the database has schema version {version}; this build knows {SCHEMA_VERSION}").into());
    }
    if version < 1 {
        tx.execute_batch(
            "CREATE TABLE terminal_projects (
                 root TEXT PRIMARY KEY NOT NULL,
                 active INTEGER NOT NULL
             );
             CREATE TABLE terminal_tabs (
                 root TEXT NOT NULL REFERENCES terminal_projects(root) ON DELETE CASCADE,
                 position INTEGER NOT NULL,
                 name TEXT,
                 title TEXT NOT NULL,
                 cwd TEXT,
                 PRIMARY KEY (root, position)
             );
             DELETE FROM version;
             INSERT INTO version (version) VALUES (1);",
        )?;
    }
    tx.commit()?;
    Ok(())
}

fn key(root: &Path) -> String {
    root.to_string_lossy().into_owned()
}

pub fn load(conn: &Connection, root: &Path) -> rusqlite::Result<Option<SavedTerminals>> {
    let root = key(root);
    let Some(active) = conn.query_row("SELECT active FROM terminal_projects WHERE root = ?1", params![root], |r| r.get::<_, i64>(0)).optional()? else {
        return Ok(None);
    };
    let mut stmt = conn.prepare("SELECT name, title, cwd FROM terminal_tabs WHERE root = ?1 ORDER BY position")?;
    let tabs = stmt
        .query_map(params![root], |r| Ok(SavedTab { name: r.get(0)?, title: r.get(1)?, cwd: r.get::<_, Option<String>>(2)?.map(PathBuf::from) }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let active = usize::try_from(active).unwrap_or(0).min(tabs.len().saturating_sub(1));
    Ok(Some(SavedTerminals { tabs, active }))
}

pub fn save(conn: &mut Connection, root: &Path, terminals: &SavedTerminals) -> rusqlite::Result<()> {
    let root = key(root);
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM terminal_tabs WHERE root = ?1", params![root])?;
    tx.execute(
        "INSERT INTO terminal_projects (root, active) VALUES (?1, ?2) ON CONFLICT(root) DO UPDATE SET active = excluded.active",
        params![root, terminals.active as i64],
    )?;
    {
        let mut insert = tx.prepare("INSERT INTO terminal_tabs (root, position, name, title, cwd) VALUES (?1, ?2, ?3, ?4, ?5)")?;
        for (i, tab) in terminals.tabs.iter().enumerate() {
            insert.execute(params![root, i as i64, tab.name, tab.title, tab.cwd.as_ref().map(|c| c.to_string_lossy().into_owned())])?;
        }
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(name: Option<&str>, title: &str, cwd: Option<&str>) -> SavedTab {
        SavedTab { name: name.map(str::to_string), title: title.into(), cwd: cwd.map(PathBuf::from) }
    }

    #[test]
    fn round_trip_per_project() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("nested/db.sqlite");
        let mut conn = open(&path).expect("open");
        assert!(path.is_file(), "the file and its folder are created");
        let a = SavedTerminals { tabs: vec![tab(Some("build"), "zsh", Some("/a/sub")), tab(None, "vim", None)], active: 1 };
        let b = SavedTerminals { tabs: vec![tab(None, "zsh", Some("/b"))], active: 0 };
        save(&mut conn, Path::new("/a"), &a).expect("save a");
        save(&mut conn, Path::new("/b"), &b).expect("save b");
        assert_eq!(load(&conn, Path::new("/a")).expect("load"), Some(a));
        assert_eq!(load(&conn, Path::new("/b")).expect("load"), Some(b));
        assert_eq!(load(&conn, Path::new("/c")).expect("load"), None);
        // Zero tabs is a saved state, not a missing one.
        let empty = SavedTerminals::default();
        save(&mut conn, Path::new("/a"), &empty).expect("save empty");
        assert_eq!(load(&conn, Path::new("/a")).expect("load"), Some(empty));
    }

    #[test]
    fn reopen_keeps_the_schema_and_refuses_a_newer_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("db.sqlite");
        drop(open(&path).expect("create"));
        let conn = open(&path).expect("reopen");
        let v: i64 = conn.query_row("SELECT version FROM version", [], |r| r.get(0)).expect("version");
        assert_eq!(v, SCHEMA_VERSION);
        conn.execute("UPDATE version SET version = 99", []).expect("bump");
        drop(conn);
        assert!(open(&path).is_err(), "a newer schema is not touched");
    }

    #[test]
    fn store_thread_keeps_request_order() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = TerminalStore::new(dir.path().join("db.sqlite"));
        let first = SavedTerminals { tabs: vec![tab(None, "zsh", None)], active: 0 };
        let second = SavedTerminals { tabs: vec![tab(Some("x"), "zsh", None), tab(None, "zsh", None)], active: 1 };
        let r1 = store.save(PathBuf::from("/p"), first);
        let r2 = store.save(PathBuf::from("/p"), second.clone());
        assert!(store.flush(Duration::from_secs(5)));
        assert_eq!(r1.recv().expect("reply"), Ok(()));
        assert_eq!(r2.recv().expect("reply"), Ok(()));
        assert_eq!(store.load(PathBuf::from("/p")).recv().expect("reply"), Ok(Some(second)));
    }

    #[test]
    fn background_db_is_not_the_users() {
        let path = default_db_path(true).expect("path");
        assert!(path.starts_with(std::env::temp_dir()), "{}", path.display());
        if let Some(user) = default_db_path(false) {
            assert_ne!(user, path);
        }
    }
}
