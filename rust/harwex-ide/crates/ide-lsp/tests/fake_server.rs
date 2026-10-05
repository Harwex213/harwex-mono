//! `LspClient` against the scripted fake server (`src/bin/fake_server.rs`): handshake, lazy
//! start, document sync, request routing, UTF-16 positions, server requests, progress,
//! timeouts, crash restart and shutdown.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ide_lsp::{CancelScope, ClientConfig, Error, LspClient, CONTENT_MODIFIED, METHOD_NOT_FOUND};
use serde_json::{json, Value};

const T: Duration = Duration::from_secs(5);

struct Fixture {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    file: PathBuf,
}

fn fixture() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(tmp.path()).unwrap();
    let file = root.join("src/main.rs");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, "fn main() {}\n").unwrap();
    Fixture { _tmp: tmp, root, file }
}

fn config(root: &Path) -> ClientConfig {
    let mut c = ClientConfig::new("fake-lsp", env!("CARGO_BIN_EXE_ide-lsp-fake-server"));
    c.root = Some(root.to_path_buf());
    c.cwd = Some(root.to_path_buf());
    c.language_id = |_| "rust";
    c.initialization_options = Some(json!({"checkOnSave": false}));
    c
}

fn uri(p: &Path) -> String {
    ide_lsp::path_to_uri(p)
}

#[test]
fn starts_lazily_and_sends_the_handshake() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    assert!(!client.is_running());
    assert_eq!(client.spawn_count(), 0);
    assert_eq!(client.idle_for(), None);

    client.open(&fx.file, "fn main() {}\n", T);
    assert!(client.is_running());
    assert_eq!(client.spawn_count(), 1);
    let init = client.request("test/initializeParams", json!({}), T).unwrap();
    assert_eq!(init["rootUri"], uri(&fx.root));
    assert_eq!(init["workspaceFolders"][0]["uri"], uri(&fx.root));
    assert_eq!(init["initializationOptions"], json!({"checkOnSave": false}));
    assert_eq!(init["capabilities"]["general"]["positionEncodings"], json!(["utf-16"]));
    assert_eq!(init["capabilities"]["window"]["workDoneProgress"], true);
    let caps = client.capabilities(T).unwrap();
    assert_eq!(caps["experimental"]["fakeFeature"], true);
    assert_eq!(client.spawn_count(), 1, "requests reuse the process");
}

#[test]
fn full_text_sync_with_increasing_versions() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    client.open(&fx.file, "a", T);
    client.change(&fx.file, "ab", T);
    client.change(&fx.file, "abc", T);
    let doc = client.request("test/text", json!({"uri": uri(&fx.file)}), T).unwrap();
    assert_eq!(doc, json!({"version": 3, "text": "abc"}));
    assert_eq!(client.editor_files(), 1);
    client.close(&fx.file);
    assert_eq!(client.editor_files(), 0);
    assert_eq!(client.request("test/opened", json!({}), T).unwrap(), json!([]));
}

#[test]
fn positions_round_trip_through_utf16() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    let text = "fn a() {}\nlet s = \"😀😀\"; call(s);\n";
    client.open(&fx.file, text, T);
    let column = "let s = \"😀😀\"; ".chars().count();
    // The fake server echoes the position it received.
    let (params, _) = client.position_params(&fx.file, 1, column, T).unwrap();
    assert_eq!(params["position"], json!({"line": 1, "character": column + 2}));
    let locs = client.locations("textDocument/definition", &fx.file, 1, column, T).unwrap();
    assert_eq!(locs.len(), 1);
    assert_eq!(locs[0].path, fx.file);
    assert_eq!((locs[0].line, locs[0].column), (1, column));
}

#[test]
fn references_carry_line_text_definition_and_write_flags() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    client.open(&fx.file, "x = 1;\nlet y = x;\n", T);
    let refs = client.references(&fx.file, 1, 8, T).unwrap();
    assert_eq!(refs.len(), 2);
    let at = refs.iter().find(|r| r.location.line == 1).unwrap();
    // The fake end is 3 past the start; it clamps to the end of the 10-char line.
    assert_eq!((at.location.column, at.end_column), (8, 10));
    assert_eq!(at.line_text, "let y = x;");
    assert!(at.is_definition, "definition echoes this spot");
    assert!(!at.is_write);
    let first = refs.iter().find(|r| r.location.line == 0).unwrap();
    assert!(first.is_write, "documentHighlight marks (0, 0) as a write");
    assert!(!first.is_definition);
}

#[test]
fn hover_returns_markdown_and_range() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    client.open(&fx.file, "fn main() {}\n", T);
    let hover = client.hover(&fx.file, 0, 3, T).unwrap().unwrap();
    assert_eq!((hover.line, hover.column), (0, 3));
    let (display, doc) = ide_lsp::split_hover_markdown(&hover.markdown);
    assert_eq!((display.as_str(), doc.as_str()), ("fn fake()", "Fake docs."));
}

#[test]
fn file_not_opened_by_editor_is_read_from_disk_and_refreshed() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    let text = client.ensure_open(&fx.file, T).unwrap();
    assert_eq!(&*text, "fn main() {}\n");
    assert_eq!(client.editor_files(), 0, "a disk file is not an editor file");
    // A new mtime makes the next request send the new disk text.
    std::thread::sleep(Duration::from_millis(20));
    std::fs::write(&fx.file, "fn other() {}\n").unwrap();
    let past = std::time::SystemTime::now() + Duration::from_secs(2);
    let f = std::fs::File::options().write(true).open(&fx.file).unwrap();
    f.set_modified(past).unwrap();
    assert_eq!(&*client.ensure_open(&fx.file, T).unwrap(), "fn other() {}\n");
    let doc = client.request("test/text", json!({"uri": uri(&fx.file)}), T).unwrap();
    assert_eq!(doc, json!({"version": 2, "text": "fn other() {}\n"}));
}

#[test]
fn responses_are_routed_by_id_across_threads() {
    let fx = fixture();
    let client = Arc::new(LspClient::new(config(&fx.root)));
    client.open(&fx.file, "x", T);
    // The slow request is sent first and answered last.
    let handles: Vec<_> = [400u64, 10, 200, 0]
        .into_iter()
        .map(|ms| {
            let c = client.clone();
            std::thread::spawn(move || (ms, c.request("test/sleep", json!({"ms": ms}), T).unwrap()))
        })
        .collect();
    for h in handles {
        let (ms, result) = h.join().unwrap();
        assert_eq!(result, json!({"slept": ms}));
    }
}

#[test]
fn timeout_cancels_and_the_next_request_works() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    let err = client.request("test/sleep", json!({"ms": 1500}), Duration::from_millis(100)).unwrap_err();
    assert!(matches!(&err, Error::Timeout { method, .. } if method == "test/sleep"), "{err:?}");
    assert!(err.to_string().contains("timed out"));
    let cancelled = client.request("test/cancelled", json!({}), T).unwrap();
    assert_eq!(cancelled.as_array().map(Vec::len), Some(1), "the server got $/cancelRequest");
    assert_eq!(client.request("test/sleep", json!({"ms": 0}), T).unwrap(), json!({"slept": 0}));
}

#[test]
fn cancel_flag_sends_cancel_request_and_drops_the_answer() {
    let fx = fixture();
    let client = Arc::new(LspClient::new(config(&fx.root)));
    client.request("test/sleep", json!({"ms": 0}), T).unwrap();
    let flag = Arc::new(AtomicBool::new(false));
    let worker = {
        let (client, flag) = (client.clone(), flag.clone());
        std::thread::spawn(move || {
            let _scope = CancelScope::enter(flag);
            let started = Instant::now();
            (client.request("test/sleep", json!({"ms": 800}), T), started.elapsed())
        })
    };
    std::thread::sleep(Duration::from_millis(100));
    flag.store(true, Ordering::SeqCst);
    let (result, took) = worker.join().unwrap();
    let err = result.unwrap_err();
    assert!(matches!(&err, Error::Cancelled { method } if method == "test/sleep"), "{err:?}");
    assert!(err.to_string().contains(ide_lsp::CANCELLED));
    assert!(took < Duration::from_millis(600), "cancel waited for the answer: {took:?}");
    let cancelled = client.request("test/cancelled", json!({}), T).unwrap();
    // Ids: 1 is `initialize`, 2 the warm-up sleep, 3 the cancelled one.
    assert_eq!(cancelled, json!([3]), "the server got $/cancelRequest for the sleeping request");
    // The late answer arrives and is dropped; the next request gets its own answer.
    std::thread::sleep(Duration::from_millis(900));
    assert_eq!(client.request("test/sleep", json!({"ms": 1}), T).unwrap(), json!({"slept": 1}));
    // A set flag sends nothing at all.
    let _scope = CancelScope::enter(Arc::new(AtomicBool::new(true)));
    assert!(matches!(client.request("test/sleep", json!({"ms": 0}), T), Err(Error::Cancelled { .. })));
}

fn alive(pid: u64) -> bool {
    std::process::Command::new("kill").args(["-0", &pid.to_string()]).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
}

fn assert_dies(pid: u64, what: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while alive(pid) {
        if Instant::now() > deadline {
            let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
            panic!("{what} (pid {pid}) survived");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn kill_and_shutdown_take_the_server_children_along() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    let child = client.request("test/spawnChild", json!({}), T).unwrap()["pid"].as_u64().unwrap();
    assert!(alive(child));
    client.kill();
    assert_dies(child, "child of a killed server");
    // A server that exits on `shutdown` leaves its helper behind; the client kills it.
    let child = client.request("test/spawnChild", json!({}), T).unwrap()["pid"].as_u64().unwrap();
    client.shutdown();
    assert_dies(child, "child of a shut down server");
}

#[test]
fn crash_restarts_and_reopens_unsaved_text() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    client.open(&fx.file, "unsaved edit", T);
    let err = client.request("test/crash", json!({}), T).unwrap_err();
    match &err {
        Error::ServerDied(stderr) => assert!(stderr.contains("crashed on purpose") || stderr.is_empty(), "{stderr}"),
        other => panic!("expected ServerDied, got {other:?}"),
    }
    // Let the reader see EOF, like a real crash between two user actions.
    std::thread::sleep(Duration::from_millis(50));
    assert!(!client.is_running());
    let doc = client.request("test/text", json!({"uri": uri(&fx.file)}), T).unwrap();
    assert_eq!(doc["text"], "unsaved edit");
    assert_eq!(client.spawn_count(), 2);

    // Kill (as an OOM killer would) also recovers on the next call.
    client.kill();
    let doc = client.request("test/text", json!({"uri": uri(&fx.file)}), T).unwrap();
    assert_eq!(doc["text"], "unsaved edit");
    assert_eq!(client.spawn_count(), 3);
}

#[test]
fn server_requests_are_answered_with_configuration() {
    let fx = fixture();
    let mut c = config(&fx.root);
    c.configuration = Some(Arc::new(|item: &Value| match item["section"].as_str() {
        Some("fake") => json!({"checkOnSave": false}),
        _ => Value::Null,
    }));
    let client = LspClient::new(c);
    let answer = client.request("test/askConfiguration", json!({}), T).unwrap();
    assert_eq!(answer, json!([{"checkOnSave": false}, null]));
}

#[test]
fn progress_and_notifications_are_tracked() {
    let fx = fixture();
    let seen: Arc<Mutex<Vec<String>>> = Arc::default();
    let mut c = config(&fx.root);
    let sink = seen.clone();
    c.on_notification = Some(Arc::new(move |method: &str, _: &Value| sink.lock().unwrap().push(method.to_string())));
    let client = LspClient::new(c);
    let begin = json!({"token": "rustAnalyzer/Indexing", "value": {"kind": "begin", "title": "Indexing", "percentage": 10}});
    client.request("test/notify", json!({"method": "$/progress", "params": begin}), T).unwrap();
    let progress = client.progress();
    assert_eq!(progress.len(), 1);
    assert_eq!((progress[0].title.as_str(), progress[0].percentage), ("Indexing", Some(10)));
    let end = json!({"token": "rustAnalyzer/Indexing", "value": {"kind": "end"}});
    client.request("test/notify", json!({"method": "$/progress", "params": end}), T).unwrap();
    assert!(client.progress().is_empty());
    client.request("test/notify", json!({"method": "experimental/serverStatus", "params": {"quiescent": true}}), T).unwrap();
    assert_eq!(*seen.lock().unwrap(), ["$/progress", "$/progress", "experimental/serverStatus"]);
}

#[test]
fn error_codes_are_kept() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    client.open(&fx.file, "x", T);
    client.request("test/contentModified", json!({"times": 1}), T).unwrap();
    let err = client.locations("textDocument/definition", &fx.file, 0, 0, T).unwrap_err();
    assert!(matches!(err, Error::Server { code: CONTENT_MODIFIED, .. }));
    assert!(err.is_retryable());
    assert_eq!(client.locations("textDocument/definition", &fx.file, 0, 0, T).unwrap().len(), 1);

    let err = client.request("nope/nothing", json!({}), T).unwrap_err();
    assert!(matches!(err, Error::Server { code: METHOD_NOT_FOUND, .. }));
    assert!(!err.is_retryable());
    assert!(err.to_string().starts_with("method not supported"), "{err}");
}

#[test]
fn shutdown_stops_and_the_next_call_starts_again() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    client.open(&fx.file, "x", T);
    std::thread::sleep(Duration::from_millis(30));
    assert!(client.idle_for().unwrap() >= Duration::from_millis(30));
    client.shutdown();
    assert!(!client.is_running());
    assert_eq!(client.idle_for(), None);
    assert_eq!(client.editor_files(), 0, "shutdown forgets open files");
    client.open(&fx.file, "y", T);
    assert!(client.is_running());
    assert_eq!(client.spawn_count(), 2);
}

#[test]
fn missing_program_is_a_spawn_error() {
    let fx = fixture();
    let mut c = config(&fx.root);
    c.program = PathBuf::from("/nonexistent/language-server");
    let client = LspClient::new(c);
    assert!(matches!(client.request("x", json!({}), T), Err(Error::Spawn(_))));
    client.open(&fx.file, "x", T);
    assert_eq!(client.editor_files(), 1, "open never fails; the file waits for a server");
}

#[test]
fn will_rename_files_returns_edits_and_did_rename_closes_old_paths() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    let other = fx.root.join("src/lib.rs");
    std::fs::write(&other, "mod main;\n").unwrap();
    client.open(&fx.file, "fn main() {}\n", T);
    client.ensure_open(&other, T).unwrap();
    let init = client.request("test/initializeParams", json!({}), T).unwrap();
    assert_eq!(init["capabilities"]["workspace"]["fileOperations"]["willRename"], true);

    let new = fx.root.join("src/app.rs");
    let edits = client.will_rename_files(&[(fx.file.clone(), new.clone())], T).unwrap();
    let mut paths: Vec<&Path> = edits.iter().map(|e| e.path.as_path()).collect();
    paths.sort();
    assert_eq!(paths, [other.as_path(), fx.file.as_path()]);
    let e = &edits[0].edits[0];
    assert_eq!((e.start_line, e.start_column, e.end_line, e.end_column), (0, 0, 0, 0));
    assert_eq!(e.new_text, format!("// {} -> {}\n", uri(&fx.file), uri(&new)));

    let usages = client.file_usages(&fx.file, T).unwrap();
    assert_eq!(usages.len(), 2, "one per edited file");
    assert!(usages.iter().all(|u| u.location.line == 0 && u.location.column == 0));
    assert_eq!(usages.iter().find(|u| u.location.path == other).unwrap().line_text, "mod main;");

    std::fs::rename(&fx.file, &new).unwrap();
    client.did_rename_files(&[(fx.file.clone(), new.clone())], T).unwrap();
    assert_eq!(client.open_text(&fx.file), None, "the old path is closed");
    let renamed = client.request("test/renamed", json!({}), T).unwrap();
    assert_eq!(renamed, json!([{"oldUri": uri(&fx.file), "newUri": uri(&new)}]));
    let opened = client.request("test/opened", json!({}), T).unwrap();
    assert_eq!(opened, json!([uri(&other)]));

    client.close_under(&fx.root.join("src"));
    assert!(client.open_paths().is_empty());
}

#[test]
fn diagnostics_are_pulled_with_editor_columns() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    client.open(&fx.file, "let 😀 = ERR;\n// WARN HINT\n", T);
    assert!(client.supports_pull_diagnostics(T).unwrap());
    let d = client.diagnostics(&fx.file, T).unwrap();
    let got: Vec<(usize, usize, usize, ide_lsp::Severity, bool)> = d.iter().map(|d| (d.line, d.column, d.end_column, d.severity, d.unnecessary)).collect();
    assert_eq!(
        got,
        [(0, 8, 11, ide_lsp::Severity::Error, false), (1, 3, 7, ide_lsp::Severity::Warning, false), (1, 8, 12, ide_lsp::Severity::Hint, true)]
    );
    assert_eq!(d[0].code.as_deref(), Some("fake-err"));
    assert_eq!(d[0].source.as_deref(), Some("fake"));
    // An edit is seen by the next pull.
    client.change(&fx.file, "fine\n", T);
    assert!(client.diagnostics(&fx.file, T).unwrap().is_empty());
}

#[test]
fn pushed_diagnostics_are_kept_per_file() {
    let fx = fixture();
    let client = LspClient::new(config(&fx.root));
    client.open(&fx.file, "x\n", T);
    let params = json!({"uri": uri(&fx.file), "diagnostics": [{"range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 1}}, "severity": 2, "message": "pushed"}]});
    client.request("test/notify", json!({"method": "textDocument/publishDiagnostics", "params": params}), T).unwrap();
    let raw = client.pushed(&fx.file).expect("stored");
    assert_eq!(raw[0]["message"], "pushed");
    client.close(&fx.file);
    assert!(client.pushed(&fx.file).is_none(), "closing forgets the file's diagnostics");
}
