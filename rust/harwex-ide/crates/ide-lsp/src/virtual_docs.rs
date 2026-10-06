//! Read-only documents that a server serves under a non-file URI: Roslyn's
//! `roslyn-source-generated://` (source generator output), JDT's `jdt://` (class files).
//!
//! The editor works on paths, so the client writes such a document once to
//! `<temp>/harwex-ide-virtual/<kind>/<hash of the URI>/<name>` (never into a project) and keeps
//! the path -> URI pair in a process-wide table. `path_to_uri` maps the path back, so every
//! request about the file (`didOpen`, definition, hover) names the server's own URI again.
//! An adapter turns a URI into the server request that returns its text
//! (`ClientConfig::virtual_text`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;

use crate::client::LspClient;

/// How to get the text of a virtual document from the server.
#[derive(Clone, Debug, PartialEq)]
pub struct VirtualRequest {
    /// A short word for the tab title and the folder, e.g. `generated` or `decompiled`.
    pub kind: &'static str,
    pub method: String,
    pub params: Value,
    /// The file name to show (its extension picks the highlighting). `None` takes the last
    /// segment of the URI path.
    pub name: Option<String>,
}

/// Maps a non-file URI to the request for its text; `None` when the adapter does not know
/// the scheme.
pub type VirtualTextHandler = Arc<dyn Fn(&str) -> Option<VirtualRequest> + Send + Sync>;

/// A virtual document the client wrote to disk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VirtualDocument {
    pub uri: String,
    pub kind: String,
}

/// Canonical path -> document. Filled on worker threads; read by `path_to_uri` and the app.
fn table() -> &'static Mutex<HashMap<PathBuf, VirtualDocument>> {
    static TABLE: OnceLock<Mutex<HashMap<PathBuf, VirtualDocument>>> = OnceLock::new();
    TABLE.get_or_init(Mutex::default)
}

/// `<temp>/harwex-ide-virtual`, not canonical (the files under it are registered canonical).
pub fn virtual_root() -> PathBuf {
    std::env::temp_dir().join("harwex-ide-virtual")
}

/// The virtual document written at `path`, if any. Cheap: one lookup in a small table.
pub fn virtual_document(path: &Path) -> Option<VirtualDocument> {
    crate::client::lock(table()).get(path).cloned()
}

/// The path written for `uri`, if the client wrote one.
pub fn path_for_uri(uri: &str) -> Option<PathBuf> {
    crate::client::lock(table()).iter().find(|(_, d)| d.uri == uri).map(|(p, _)| p.clone())
}

/// A virtual document gets this long to arrive; it is one server-side text lookup.
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

impl LspClient {
    /// Writes every non-file `uri` / `targetUri` of a result that the adapter knows how to
    /// fetch, so parsing the result finds a file for it. A failed fetch only drops that
    /// location.
    pub(crate) fn fetch_virtual_documents(&self, result: &Value) {
        let Some(handler) = self.config().virtual_text.clone() else { return };
        let mut uris = Vec::new();
        collect_uris(result, &mut uris);
        uris.sort();
        uris.dedup();
        for uri in uris {
            let Some(request) = handler(&uri) else { continue };
            let Ok(answer) = self.request(&request.method, request.params.clone(), FETCH_TIMEOUT) else { continue };
            if let Some(text) = response_text(&answer) {
                let _ = materialize(&request, &uri, text);
            }
        }
    }
}

fn collect_uris(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Array(items) => items.iter().for_each(|i| collect_uris(i, out)),
        Value::Object(map) => {
            for (k, v) in map {
                match (k.as_str(), v) {
                    ("uri" | "targetUri", Value::String(u)) if !u.starts_with("file:") => out.push(u.clone()),
                    _ => collect_uris(v, out),
                }
            }
        }
        _ => {}
    }
}

/// The text of the response to a `VirtualRequest`: a plain string (`java/classFileContents`)
/// or an object with `text` (`sourceGeneratedDocument/_roslyn_getText`).
pub(crate) fn response_text(result: &Value) -> Option<&str> {
    result.as_str().or_else(|| result["text"].as_str())
}

/// Writes the text and registers the path. Called again for the same URI it rewrites the
/// file, so a generated document follows the latest server answer.
pub(crate) fn materialize(request: &VirtualRequest, uri: &str, text: &str) -> std::io::Result<PathBuf> {
    let name = request.name.clone().unwrap_or_else(|| name_of(uri));
    let dir = virtual_root().join(sanitize(request.kind)).join(format!("{:016x}", fnv1a(uri.as_bytes())));
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(sanitize(&name));
    std::fs::write(&file, text)?;
    let path = crate::features::canonical(&file);
    crate::client::lock(table()).insert(path.clone(), VirtualDocument { uri: uri.to_string(), kind: request.kind.to_string() });
    Ok(path)
}

/// The last segment of the URI's path, percent-decoded, without query or fragment.
fn name_of(uri: &str) -> String {
    let rest = uri.split(['?', '#']).next().unwrap_or_default();
    let last = rest.trim_end_matches('/').rsplit('/').next().unwrap_or_default();
    let decoded = crate::uri::percent_decode(last).unwrap_or_else(|| last.to_string());
    if decoded.is_empty() {
        "document".to_string()
    } else {
        decoded
    }
}

/// Keeps a file name a single, harmless path segment.
fn sanitize(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '+') { c } else { '_' }).collect();
    let s = s.trim_matches('.').to_string();
    if s.is_empty() {
        "_".to_string()
    } else {
        s
    }
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_non_file_uris_are_collected() {
        let mut out = Vec::new();
        collect_uris(&json!([{"uri": "file:///a.cs"}, {"targetUri": "gen://x/A.cs", "nested": {"uri": "gen://y/B.cs"}}]), &mut out);
        out.sort();
        assert_eq!(out, ["gen://x/A.cs", "gen://y/B.cs"]);
    }

    #[test]
    fn names_come_from_the_uri_path() {
        assert_eq!(name_of("roslyn-source-generated://p/Gen%20Thing.g.cs?assembly=x"), "Gen Thing.g.cs");
        assert_eq!(name_of("jdt://contents/rt.jar/java.util/ArrayList.class?=abc"), "ArrayList.class");
        assert_eq!(name_of("weird:"), "weird:");
        assert_eq!(sanitize("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(sanitize(".."), "_");
    }

    #[test]
    fn a_materialized_document_maps_back_to_its_uri() {
        let request = VirtualRequest { kind: "generated", method: "m".into(), params: json!({}), name: None };
        let uri = "test-virtual://unit/a_materialized_document/Thing.cs";
        let path = materialize(&request, uri, "class Thing {}").unwrap();
        assert!(path.starts_with(crate::features::canonical(&virtual_root())), "{}", path.display());
        assert_eq!(path.file_name().unwrap(), "Thing.cs");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "class Thing {}");
        assert_eq!(virtual_document(&path).unwrap().uri, uri);
        assert_eq!(crate::uri::path_to_uri(&path), uri);
        assert_eq!(path_for_uri(uri), Some(path.clone()));
        assert_eq!(response_text(&json!({"text": "x"})), Some("x"));
        assert_eq!(response_text(&json!("y")), Some("y"));
    }
}
