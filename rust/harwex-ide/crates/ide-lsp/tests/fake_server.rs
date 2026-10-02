//! `LspClient` against the scripted fake server (`src/bin/fake_server.rs`): handshake, lazy
//! start, document sync, request routing, UTF-16 positions, server requests, progress,
//! timeouts, crash restart and shutdown.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ide_lsp::{ClientConfig, Error, LspClient, CONTENT_MODIFIED, METHOD_NOT_FOUND};
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
