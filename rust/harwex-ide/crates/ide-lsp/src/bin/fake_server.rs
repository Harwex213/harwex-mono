//! A scripted language server for `ide-lsp`'s tests. It speaks real LSP framing on stdio.
//!
//! Navigation requests echo the requested position back, so tests can check the UTF-16
//! conversion both ways. `test/*` requests let a test make the server sleep, crash, ask the
//! client for configuration, send progress or fail with "content modified".

use std::collections::HashMap;
use std::io::{self, BufReader, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ide_lsp::framing::{frame, read_message};
use serde_json::{json, Value};

type Out = Arc<Mutex<io::Stdout>>;

fn send(out: &Out, msg: &Value) {
    let mut o = out.lock().unwrap_or_else(|e| e.into_inner());
    let _ = o.write_all(&frame(msg));
    let _ = o.flush();
}

fn reply(out: &Out, id: &Value, result: Value) {
    send(out, &json!({"jsonrpc": "2.0", "id": id, "result": result}));
}

fn reply_error(out: &Out, id: &Value, code: i64, message: &str) {
    send(out, &json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}));
}

fn main() {
    let out: Out = Arc::new(Mutex::new(io::stdout()));
    let mut reader = BufReader::new(io::stdin());
    let mut docs: HashMap<String, (i64, String)> = HashMap::new();
    let mut init_params = Value::Null;
    let mut content_modified_left: i64 = 0;
    // Test request waiting for the client's answer to our `workspace/configuration`.
    let mut waiting_config: Option<Value> = None;
    let mut cancelled: Vec<Value> = Vec::new();

    while let Ok(Some(msg)) = read_message(&mut reader) {
        let method = msg["method"].as_str().unwrap_or_default().to_string();
        let params = msg["params"].clone();
        let id = msg.get("id").cloned();
        if method.is_empty() {
            // A response to our own request.
            if msg["id"] == "config-1" {
                if let Some(test_id) = waiting_config.take() {
                    reply(&out, &test_id, msg["result"].clone());
                }
            }
            continue;
        }
        let uri = params["textDocument"]["uri"].as_str().unwrap_or_default().to_string();
        let position = params["position"].clone();
        match (method.as_str(), id) {
            ("initialize", Some(id)) => {
                init_params = params;
                reply(
                    &out,
                    &id,
                    json!({
                        "capabilities": {
                            "positionEncoding": "utf-16",
                            "textDocumentSync": 1,
                            "definitionProvider": true,
                            "typeDefinitionProvider": true,
                            "referencesProvider": true,
                            "documentHighlightProvider": true,
                            "hoverProvider": true,
                            "experimental": {"fakeFeature": true},
                        },
                        "serverInfo": {"name": "fake", "version": "1"},
                    }),
                );
            }
            ("initialized", None) => {}
            ("textDocument/didOpen", None) => {
                let doc = &params["textDocument"];
                docs.insert(
                    doc["uri"].as_str().unwrap_or_default().to_string(),
                    (doc["version"].as_i64().unwrap_or(0), doc["text"].as_str().unwrap_or_default().to_string()),
                );
            }
            ("textDocument/didChange", None) => {
                let text = params["contentChanges"][0]["text"].as_str().unwrap_or_default().to_string();
                docs.insert(uri, (params["textDocument"]["version"].as_i64().unwrap_or(0), text));
            }
            ("textDocument/didClose", None) => {
                docs.remove(&uri);
            }
            ("$/cancelRequest", None) => cancelled.push(params["id"].clone()),
            ("textDocument/definition" | "textDocument/typeDefinition", Some(id)) => {
                if content_modified_left > 0 {
                    content_modified_left -= 1;
                    reply_error(&out, &id, -32801, "content modified");
                    continue;
                }
                reply(
                    &out,
                    &id,
                    json!([{"targetUri": uri, "targetRange": {"start": position, "end": position},
                        "targetSelectionRange": {"start": position, "end": position}}]),
                );
            }
            ("textDocument/references", Some(id)) => {
                let end = json!({"line": position["line"], "character": position["character"].as_u64().unwrap_or(0) + 3});
                reply(
                    &out,
                    &id,
                    json!([
                        {"uri": uri, "range": {"start": position, "end": end}},
                        {"uri": uri, "range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 1}}},
                    ]),
                );
            }
            ("textDocument/documentHighlight", Some(id)) => {
                reply(&out, &id, json!([{"range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 1}}, "kind": 3}]));
            }
            ("textDocument/hover", Some(id)) => {
                reply(
                    &out,
                    &id,
                    json!({"contents": {"kind": "markdown", "value": "```rust\nfn fake()\n```\n\n---\n\nFake docs."},
                        "range": {"start": position, "end": position}}),
                );
            }
            ("test/sleep", Some(id)) => {
                let ms = params["ms"].as_u64().unwrap_or(0);
                let out = out.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(ms));
                    reply(&out, &id, json!({"slept": ms}));
                });
            }
            ("test/crash", Some(_)) => {
                eprintln!("fake server crashed on purpose");
                std::process::exit(3);
            }
            ("test/text", Some(id)) => {
                let doc = params["uri"].as_str().and_then(|u| docs.get(u));
                reply(&out, &id, doc.map_or(Value::Null, |(v, t)| json!({"version": v, "text": t})));
            }
            ("test/opened", Some(id)) => {
                let mut uris: Vec<&String> = docs.keys().collect();
                uris.sort();
                reply(&out, &id, json!(uris));
            }
            ("test/initializeParams", Some(id)) => reply(&out, &id, init_params.clone()),
            ("test/cancelled", Some(id)) => reply(&out, &id, json!(cancelled)),
            ("test/askConfiguration", Some(id)) => {
                waiting_config = Some(id);
                send(
                    &out,
                    &json!({"jsonrpc": "2.0", "id": "config-1", "method": "workspace/configuration",
                        "params": {"items": [{"section": "fake"}, {"section": "other"}]}}),
                );
            }
            ("test/contentModified", Some(id)) => {
                content_modified_left = params["times"].as_i64().unwrap_or(0);
                reply(&out, &id, Value::Null);
            }
            ("test/notify", Some(id)) => {
                send(&out, &json!({"jsonrpc": "2.0", "method": params["method"], "params": params["params"]}));
                reply(&out, &id, Value::Null);
            }
            ("shutdown", Some(id)) => reply(&out, &id, Value::Null),
            ("exit", None) => std::process::exit(0),
            (_, Some(id)) => reply_error(&out, &id, -32601, &format!("unknown method {method}")),
            (_, None) => {}
        }
    }
}
