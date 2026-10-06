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
    let mut renamed: Vec<Value> = Vec::new();
    // Every notification method in arrival order (`test/notified`).
    let mut notified: Vec<String> = Vec::new();
    // `test/virtualDefinitions`: definitions point at a `fake-virtual://` document.
    let mut virtual_defs = false;

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
        if id.is_none() {
            notified.push(method.clone());
        }
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
                            "diagnosticProvider": {"interFileDependencies": false, "workspaceDiagnostics": false},
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
            ("textDocument/definition", Some(id)) if virtual_defs => {
                let range = json!({"start": {"line": 1, "character": 6}, "end": {"line": 1, "character": 11}});
                reply(&out, &id, json!([{"uri": "fake-virtual://lib/Thing.cs?x=1", "range": range}]));
            }
            ("fake/virtualText", Some(id)) => {
                let text = format!("// {uri}\nclass Thing {{}}\n");
                reply(&out, &id, json!({"text": text}));
            }
            ("test/virtualDefinitions", Some(id)) => {
                virtual_defs = true;
                reply(&out, &id, Value::Null);
            }
            ("test/notified", Some(id)) => reply(&out, &id, json!(notified)),
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
            // Every `ERR`, `WARN` and `HINT` in the text is a diagnostic, columns in UTF-16.
            ("textDocument/diagnostic", Some(id)) => {
                let text = docs.get(&uri).map(|(_, t)| t.clone()).unwrap_or_default();
                let mut items = Vec::new();
                for (line_no, line) in text.lines().enumerate() {
                    for (word, severity) in [("ERR", 1), ("WARN", 2), ("HINT", 4)] {
                        for (byte, _) in line.match_indices(word) {
                            let col: usize = line[..byte].encode_utf16().count();
                            let mut d = json!({"range": {"start": {"line": line_no, "character": col}, "end": {"line": line_no, "character": col + word.len()}},
                                "severity": severity, "code": format!("fake-{}", word.to_lowercase()), "source": "fake", "message": format!("{word} here")});
                            if severity == 4 {
                                d["tags"] = json!([1]);
                            }
                            items.push(d);
                        }
                    }
                }
                reply(&out, &id, json!({"kind": "full", "items": items}));
            }
            // Inserts one comment line per rename at the top of every open document, so tests
            // can check the conversion and that the request came before the move.
            ("workspace/willRenameFiles", Some(id)) => {
                let files = params["files"].as_array().cloned().unwrap_or_default();
                let mut uris: Vec<&String> = docs.keys().collect();
                uris.sort();
                let text: String = files.iter().map(|f| format!("// {} -> {}\n", f["oldUri"].as_str().unwrap_or_default(), f["newUri"].as_str().unwrap_or_default())).collect();
                let changes: Vec<Value> = uris
                    .iter()
                    .map(|u| json!({"textDocument": {"uri": u, "version": null},
                        "edits": [{"range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 0}}, "newText": text}]}))
                    .collect();
                reply(&out, &id, json!({"documentChanges": changes}));
            }
            // Renames the word at the position in its document only, with `changes`.
            ("textDocument/rename", Some(id)) => {
                let text = docs.get(&uri).map(|(_, t)| t.clone()).unwrap_or_default();
                let line_no = position["line"].as_u64().unwrap_or(0) as usize;
                let col = position["character"].as_u64().unwrap_or(0) as usize;
                let line: Vec<u16> = text.lines().nth(line_no).unwrap_or_default().encode_utf16().collect();
                let word = |c: u16| char::from_u32(u32::from(c)).is_some_and(|c| c.is_alphanumeric() || c == '_');
                let start = (0..col.min(line.len())).rev().take_while(|&i| word(line[i])).last().unwrap_or(col);
                let end = (col..line.len()).take_while(|&i| word(line[i])).last().map_or(col, |i| i + 1);
                if start == end {
                    reply_error(&out, &id, -32602, "no symbol here");
                    continue;
                }
                let range = json!({"start": {"line": line_no, "character": start}, "end": {"line": line_no, "character": end}});
                reply(&out, &id, json!({"changes": {uri: [{"range": range, "newText": params["newName"]}]}}));
            }
            ("workspace/didRenameFiles", None) => renamed.extend(params["files"].as_array().cloned().unwrap_or_default()),
            ("test/renamed", Some(id)) => reply(&out, &id, json!(renamed)),
            ("test/sleep", Some(id)) => {
                let ms = params["ms"].as_u64().unwrap_or(0);
                let out = out.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(ms));
                    reply(&out, &id, json!({"slept": ms}));
                });
            }
            // A helper child that ignores SIGTERM, like a stuck `tsgolint`. Answers its pid.
            ("test/spawnChild", Some(id)) => {
                let child = std::process::Command::new("sh")
                    .args(["-c", "trap '' TERM; while :; do sleep 1; done"])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .spawn();
                match child {
                    Ok(c) => reply(&out, &id, json!({"pid": c.id()})),
                    Err(e) => reply_error(&out, &id, -32603, &e.to_string()),
                }
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
