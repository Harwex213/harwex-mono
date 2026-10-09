//! Completion in `package.json` (task 097): package names from the registry search, versions
//! with `^`/`~` and dist-tags, the disk cache. The registry is a local fake HTTP server named in
//! the fixture's `.npmrc`; no test touches the network.

use crate::common::*;
use egui::{Key, Modifiers};
use harwex_ide::lang::npm::Fetch;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

const SUITE: &str = "npm_completion";

/// A tiny npm registry on 127.0.0.1: canned bodies by path, every request logged.
struct FakeRegistry {
    port: u16,
    /// `(path, accept header)` of each request.
    log: Arc<Mutex<Vec<(String, String)>>>,
    stop: Arc<AtomicBool>,
}

impl FakeRegistry {
    fn start(routes: HashMap<String, String>) -> FakeRegistry {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let log = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (log2, stop2) = (log.clone(), stop.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if stop2.load(Ordering::SeqCst) {
                    break;
                }
                if let Ok(s) = stream {
                    serve(s, &routes, &log2);
                }
            }
        });
        FakeRegistry { port, log, stop }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}/", self.port)
    }

    fn paths(&self) -> Vec<String> {
        self.log.lock().expect("log").iter().map(|(p, _)| p.clone()).collect()
    }
}

impl Drop for FakeRegistry {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wakes the accept loop so the thread ends and the port closes.
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

fn serve(stream: TcpStream, routes: &HashMap<String, String>, log: &Mutex<Vec<(String, String)>>) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    let mut first = String::new();
    if reader.read_line(&mut first).is_err() {
        return;
    }
    let mut accept = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        if let Some(v) = line.to_ascii_lowercase().strip_prefix("accept:") {
            accept = v.trim().to_string();
        }
    }
    let path = first.split_whitespace().nth(1).unwrap_or("").to_string();
    log.lock().expect("log").push((path.clone(), accept));
    let (status, body) = match routes.get(&path) {
        Some(b) => ("200 OK", b.clone()),
        None => ("404 Not Found", "{\"error\":\"Not found\"}".to_string()),
    };
    let mut stream = stream;
    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
}

fn routes() -> HashMap<String, String> {
    let mut r = HashMap::new();
    r.insert(
        "/lodash".to_string(),
        r#"{"name":"lodash","dist-tags":{"latest":"4.17.21","next":"5.0.0-rc.1"},"versions":{"3.10.1":{},"4.17.20":{},"4.17.21":{},"4.2.0":{},"5.0.0-rc.1":{}}}"#.to_string(),
    );
    r.insert("/react".to_string(), r#"{"name":"react","dist-tags":{"latest":"19.1.0"},"versions":{"18.3.1":{},"19.0.0":{},"19.1.0":{}}}"#.to_string());
    r.insert(
        "/-/v1/search?text=rea&size=20".to_string(),
        r#"{"objects":[{"package":{"name":"preact","version":"10.26.0"}},{"package":{"name":"react-dom","version":"19.1.0"}},{"package":{"name":"react","version":"19.1.0"}}],"total":3}"#.to_string(),
    );
    r
}

const PACKAGE_JSON: &str = "{\n  \"name\": \"demo\",\n  \"dependencies\": {\n    \"lodash\": \"\"\n  },\n  \"devDependencies\": {\n    \n  }\n}\n";

fn npm_project(fx: &Fixture, registry: &FakeRegistry) -> Repo {
    let repo = Repo::init(fx.path("repo"));
    repo.write("package.json", PACKAGE_JSON);
    repo.write(".npmrc", &format!("registry={}\n", registry.url()));
    repo.commit_all("Initial commit");
    repo
}

fn labels(ide: &Ide) -> Vec<String> {
    ide.state().ws.npm.labels()
}

/// Puts the caret between the quotes of the lodash version (line 3) and types `typed`.
fn type_lodash_version(ide: &mut Ide, typed: &str) {
    let col = ide.active_line(3).find("\"\"").expect("empty version") + 1;
    ide.click_at(ide.caret_pos(3, col));
    ide.type_text(typed);
}

#[test]
fn version_completion_lists_tags_and_versions() {
    let fx = Fixture::new(SUITE, "version_completion_lists_tags_and_versions");
    let registry = FakeRegistry::start(routes());
    let repo = npm_project(&fx, &registry);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("package.json");

    type_lodash_version(&mut ide, "^4.1");
    ide.wait_until("lodash versions", |ide| !labels(ide).is_empty());
    assert_eq!(labels(&ide), ["^4.17.21", "^4.17.20"]);
    assert!(ide.has("Completion ^4.17.21"));
    assert!(ide.is_selected("Completion ^4.17.21"));
    ide.snapshot("versions_popup");

    // Backspace narrows nothing away: the list follows the typed text.
    ide.key(Key::Backspace);
    ide.key(Key::Backspace);
    ide.wait_until("wider list", |ide| labels(ide).len() > 2);
    assert_eq!(labels(&ide), ["^4.17.21", "^4.17.20", "^4.2.0"]);

    ide.key(Key::ArrowDown);
    ide.key(Key::Enter);
    assert_eq!(ide.active_line(3), "    \"lodash\": \"^4.17.20\"");
    assert!(ide.state().ws.npm.popup.is_none());
    // The caret sits after the closing quote, and Enter did not reach the editor.
    assert_eq!(ide.cursor(), (3, "    \"lodash\": \"^4.17.20\"".len()));
    assert_eq!(ide.active_text().lines().count(), PACKAGE_JSON.lines().count());

    // One request for the abbreviated document; the second popup reads the memory cache.
    let log = registry.log.lock().expect("log").clone();
    assert_eq!(log.len(), 1, "{log:?}");
    assert_eq!(log[0].0, "/lodash");
    assert!(log[0].1.starts_with("application/vnd.npm.install-v1+json"), "{}", log[0].1);
    assert_eq!(ide.state().ws.npm.requests, 1);

    // The disk cache lives in the project and stays out of git.
    assert!(repo.dir.join(".harwex/cache/npm/lodash.json").exists());
    assert_eq!(repo.read(".harwex/cache/.gitignore"), "*\n");
    assert!(!repo.status_short().contains(".harwex"), "{}", repo.status_short());
}

#[test]
fn escape_closes_and_ctrl_space_opens() {
    let fx = Fixture::new(SUITE, "escape_closes_and_ctrl_space_opens");
    let registry = FakeRegistry::start(routes());
    let repo = npm_project(&fx, &registry);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("package.json");

    type_lodash_version(&mut ide, "3");
    ide.wait_until("lodash versions", |ide| !labels(ide).is_empty());
    assert_eq!(labels(&ide), ["3.10.1"]);
    ide.key(Key::Escape);
    assert!(ide.state().ws.npm.popup.is_none());
    // Escape went to the popup only: the text and caret stay.
    assert_eq!(ide.active_line(3), "    \"lodash\": \"3\"");

    ide.key_mods(Modifiers::CTRL, Key::Space);
    ide.wait_until("popup again", |ide| !labels(ide).is_empty());
    assert_eq!(labels(&ide), ["3.10.1"]);
    // A press on a row picks it.
    let row = ide.rect("Completion 3.10.1");
    ide.click_at(row.center());
    assert_eq!(ide.active_line(3), "    \"lodash\": \"3.10.1\"");
    assert!(ide.state().ws.npm.popup.is_none());

    // Outside a dependency section nothing opens.
    let col = ide.active_line(1).find("demo").expect("name") + 4;
    ide.click_at(ide.caret_pos(1, col));
    ide.type_text("x");
    ide.steps(3);
    assert!(ide.state().ws.npm.popup.is_none());
}

#[test]
fn name_completion_searches_the_registry() {
    let fx = Fixture::new(SUITE, "name_completion_searches_the_registry");
    let registry = FakeRegistry::start(routes());
    let repo = npm_project(&fx, &registry);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("package.json");

    // The empty line inside devDependencies.
    ide.click_at(ide.caret_pos(6, 4));
    ide.type_text("\"rea");
    ide.wait_until("search hits", |ide| !labels(ide).is_empty());
    // The exact name first, then the names that start with the query.
    assert_eq!(labels(&ide), ["react", "react-dom", "preact"]);
    ide.snapshot("names_popup");
    ide.key(Key::Enter);
    assert_eq!(ide.active_line(6), "    \"react\"");

    // The value of the new entry lists react's versions.
    ide.type_text(": \"");
    ide.wait_until("react versions", |ide| !labels(ide).is_empty());
    assert_eq!(labels(&ide)[..3], ["^19.1.0", "~19.1.0", "19.1.0"]);
    ide.key(Key::Enter);
    assert_eq!(ide.active_line(6), "    \"react\": \"^19.1.0\"");
    assert_eq!(registry.paths(), ["/-/v1/search?text=rea&size=20", "/react"]);
}

#[test]
fn disk_cache_serves_without_registry_and_errors_show() {
    let fx = Fixture::new(SUITE, "disk_cache_serves_without_registry_and_errors_show");
    let registry = FakeRegistry::start(routes());
    let repo = npm_project(&fx, &registry);
    {
        let mut ide = Ide::open(SUITE, &repo.dir);
        ide.open_file("package.json");
        type_lodash_version(&mut ide, "4");
        ide.wait_until("lodash versions", |ide| !labels(ide).is_empty());
    }
    assert_eq!(registry.paths(), ["/lodash"]);
    drop(registry);

    // A new window has an empty memory cache; the fresh disk cache answers, so the dead
    // registry is never asked.
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("package.json");
    type_lodash_version(&mut ide, "4");
    ide.wait_until("cached versions", |ide| !labels(ide).is_empty());
    assert_eq!(labels(&ide)[0], "^4.17.21");

    // An unknown package: the popup says why it has no rows.
    let col = ide.active_line(3).find("lodash").expect("name");
    ide.click_at(ide.caret_pos(3, col + 6));
    ide.type_text("x\": \"");
    let doc = ide.active_line(3);
    assert!(doc.contains("\"lodashx\": \""), "{doc}");
    ide.wait_for("lodashx failed", |s| matches!(s.ws.npm.package("lodashx"), Some(Fetch::Failed(_))));
    ide.steps(2);
    let status = ide.labels().into_iter().find(|l| l.starts_with("Completion status")).expect("status row");
    assert!(status.starts_with("Completion status npm registry:"), "{status}");
}
