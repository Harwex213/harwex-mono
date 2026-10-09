//! The npm registry: which one (`.npmrc`), HTTP through `curl`, and the on-disk cache.
//!
//! Everything here blocks; call it only from worker threads.
//!
//! HTTP goes through the system `curl`, the way git network goes through the git CLI: no TLS
//! stack to build, and curl already knows the system's certificates and proxy settings.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::versions::PackageInfo;

pub const DEFAULT_REGISTRY: &str = "https://registry.npmjs.org";
/// A cached package document this young is used without asking the registry.
pub const FRESH: Duration = Duration::from_secs(60 * 60);
/// The whole request, connection included.
const TIMEOUT_SECS: u32 = 8;
const CONNECT_TIMEOUT_SECS: u32 = 4;
/// Rows a name search asks for.
const SEARCH_SIZE: usize = 20;

/// The registry for one package.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Registry {
    /// Without the trailing slash.
    pub url: String,
    /// `_authToken` from `.npmrc` for this registry. It never goes on a command line.
    pub token: Option<String>,
}

/// One row of a name search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchHit {
    pub name: String,
    pub version: String,
    pub description: String,
}

/// The `.npmrc` settings that matter here: key to value, the nearest file winning.
#[derive(Clone, Debug, Default)]
pub struct Npmrc {
    values: HashMap<String, String>,
}

impl Npmrc {
    /// The project `.npmrc` (the nearest one from `dir` up to `root`), over the user's
    /// `$HOME/.npmrc`.
    pub fn load(dir: &Path, root: &Path, home: Option<&Path>) -> Npmrc {
        let mut rc = Npmrc::default();
        if let Some(home) = home {
            rc.merge(&std::fs::read_to_string(home.join(".npmrc")).unwrap_or_default());
        }
        let mut d = Some(dir);
        while let Some(cur) = d {
            if let Ok(text) = std::fs::read_to_string(cur.join(".npmrc")) {
                rc.merge(&text);
                break;
            }
            if cur == root {
                break;
            }
            d = cur.parent();
        }
        rc
    }

    pub fn parse(text: &str) -> Npmrc {
        let mut rc = Npmrc::default();
        rc.merge(text);
        rc
    }

    fn merge(&mut self, text: &str) {
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
                continue;
            }
            let Some((k, v)) = line.split_once('=') else { continue };
            let v = v.trim().trim_matches('"');
            self.values.insert(k.trim().to_string(), expand_env(v));
        }
    }

    /// The registry for `package`: its scope's `@scope:registry`, else `registry`, else npmjs.
    pub fn registry_for(&self, package: &str) -> Registry {
        let scoped = package.strip_prefix('@').and_then(|p| p.split_once('/')).and_then(|(scope, _)| self.values.get(&format!("@{scope}:registry")));
        let url = scoped.or_else(|| self.values.get("registry")).map(|u| u.trim_end_matches('/').to_string()).filter(|u| !u.is_empty());
        let url = url.unwrap_or_else(|| DEFAULT_REGISTRY.to_string());
        // `//host/path/:_authToken`: the longest key that the registry URL starts with.
        let bare = format!("{}/", url.split_once("//").map_or(url.as_str(), |(_, rest)| rest));
        let token = self
            .values
            .iter()
            .filter_map(|(k, v)| Some((k.strip_prefix("//")?.strip_suffix(":_authToken")?, v)))
            .filter(|(prefix, _)| bare.starts_with(&format!("{}/", prefix.trim_end_matches('/'))))
            .max_by_key(|(prefix, _)| prefix.len())
            .map(|(_, v)| v.clone());
        Registry { url, token }
    }
}

/// `${NAME}` becomes the env variable's value, as npm does.
fn expand_env(v: &str) -> String {
    let mut out = String::new();
    let mut rest = v;
    while let Some(i) = rest.find("${") {
        out.push_str(&rest[..i]);
        let Some(j) = rest[i..].find('}') else {
            out.push_str(&rest[i..]);
            return out;
        };
        out.push_str(&std::env::var(&rest[i + 2..i + j]).unwrap_or_default());
        rest = &rest[i + j + 1..];
    }
    out.push_str(rest);
    out
}

/// A package name as one URL path segment (`@scope%2Fname`).
fn encode_name(name: &str) -> String {
    name.replace('/', "%2F")
}

fn encode_query(q: &str) -> String {
    let mut out = String::new();
    for b in q.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn curl_bin() -> PathBuf {
    let system = Path::new("/usr/bin/curl");
    if system.exists() {
        system.to_path_buf()
    } else {
        PathBuf::from("curl")
    }
}

/// A curl config string: quotes and backslashes escaped.
fn quoted(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn is_loopback(url: &str) -> bool {
    let host = url.split_once("//").map_or(url, |(_, r)| r);
    let host = host.split(['/', ':']).next().unwrap_or("");
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

/// GET `url` with `accept`; the body on a 2xx answer.
fn get(reg: &Registry, url: &str, accept: &str) -> Result<Vec<u8>, String> {
    // The URL and headers go through `--config -` on stdin, so a token never shows in `ps`.
    let mut config = format!("url = {}\nheader = {}\n", quoted(url), quoted(&format!("Accept: {accept}")));
    if let Some(token) = &reg.token {
        config.push_str(&format!("header = {}\n", quoted(&format!("Authorization: Bearer {token}"))));
    }
    if is_loopback(url) {
        // A local registry never goes through the user's proxy.
        config.push_str("noproxy = \"*\"\n");
    }
    let mut child = Command::new(curl_bin())
        .args(["--silent", "--show-error", "--fail", "--location", "--compressed"])
        .args(["--max-time", &TIMEOUT_SECS.to_string(), "--connect-timeout", &CONNECT_TIMEOUT_SECS.to_string()])
        .args(["--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("curl: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(config.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| format!("curl: {e}"))?;
    if out.status.success() {
        return Ok(out.stdout);
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let err = err.trim().trim_start_matches("curl: ").trim_start_matches(|c: char| c == '(' || c.is_ascii_digit() || c == ')').trim();
    Err(if err.contains("404") { "not found".to_string() } else if err.is_empty() { "request failed".to_string() } else { err.to_string() })
}

/// Parses a package document (the abbreviated `application/vnd.npm.install-v1+json` form or the
/// full one).
pub fn parse_package(body: &[u8]) -> Result<PackageInfo, String> {
    let v: serde_json::Value = serde_json::from_slice(body).map_err(|e| format!("bad registry answer: {e}"))?;
    let versions = v.get("versions").and_then(|o| o.as_object()).map(|o| o.keys().cloned().collect()).unwrap_or_default();
    let tags = v
        .get("dist-tags")
        .and_then(|o| o.as_object())
        .map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
        .unwrap_or_default();
    Ok(PackageInfo::new(versions, tags))
}

pub fn parse_search(body: &[u8]) -> Result<Vec<SearchHit>, String> {
    let v: serde_json::Value = serde_json::from_slice(body).map_err(|e| format!("bad registry answer: {e}"))?;
    let objects = v.get("objects").and_then(|o| o.as_array()).ok_or("bad registry answer: no objects")?;
    Ok(objects
        .iter()
        .filter_map(|o| {
            let p = o.get("package")?;
            let s = |k: &str| p.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
            Some(SearchHit { name: p.get("name")?.as_str()?.to_string(), version: s("version"), description: s("description") })
        })
        .collect())
}

pub fn fetch_package(reg: &Registry, name: &str) -> Result<PackageInfo, String> {
    let body = get(reg, &format!("{}/{}", reg.url, encode_name(name)), "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8")?;
    parse_package(&body)
}

pub fn search(reg: &Registry, query: &str) -> Result<Vec<SearchHit>, String> {
    let body = get(reg, &format!("{}/-/v1/search?text={}&size={SEARCH_SIZE}", reg.url, encode_query(query)), "application/json")?;
    parse_search(&body)
}

/// The cache folder of a project: `<root>/.harwex/cache/npm`, ignored by git.
pub fn cache_dir(root: &Path) -> PathBuf {
    root.join(".harwex").join("cache").join("npm")
}

fn cache_file(root: &Path, name: &str) -> PathBuf {
    cache_dir(root).join(format!("{}.json", encode_name(name)))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// A cached package from the disk and its age; `None` when missing, unreadable or from
/// another registry.
fn read_cache(root: &Path, name: &str, registry: &str) -> Option<(PackageInfo, Duration)> {
    let text = std::fs::read(cache_file(root, name)).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&text).ok()?;
    if v.get("registry")?.as_str()? != registry {
        return None;
    }
    let fetched = v.get("fetched")?.as_u64()?;
    let versions = v.get("versions")?.as_array()?.iter().filter_map(|x| Some(x.as_str()?.to_string())).collect();
    let tags = v.get("dist_tags")?.as_object()?.iter().filter_map(|(k, x)| Some((k.clone(), x.as_str()?.to_string()))).collect();
    Some((PackageInfo::new(versions, tags), Duration::from_secs(now_secs().saturating_sub(fetched))))
}

fn write_cache(root: &Path, name: &str, registry: &str, info: &PackageInfo) {
    let dir = cache_dir(root);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    // The parent `.harwex/cache` holds only caches: keep all of it out of git.
    let ignore = dir.parent().unwrap_or(&dir).join(".gitignore");
    if !ignore.exists() {
        let _ = std::fs::write(&ignore, "*\n");
    }
    let tags: serde_json::Map<String, serde_json::Value> = info.dist_tags.iter().map(|(k, v)| (k.clone(), v.clone().into())).collect();
    let doc = serde_json::json!({ "registry": registry, "fetched": now_secs(), "dist_tags": tags, "versions": info.versions });
    // Written aside and renamed, so a reader never sees half a file.
    let path = cache_file(root, name);
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    if std::fs::write(&tmp, doc.to_string()).is_ok() && std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// A package's versions: a fresh disk cache, else the registry (which refreshes the cache),
/// else a stale disk cache.
pub fn load_package(root: &Path, dir: &Path, name: &str, home: Option<&Path>) -> Result<PackageInfo, String> {
    let reg = Npmrc::load(dir, root, home).registry_for(name);
    let cached = read_cache(root, name, &reg.url);
    if let Some((info, age)) = &cached {
        if *age < FRESH {
            return Ok(info.clone());
        }
    }
    match fetch_package(&reg, name) {
        Ok(info) => {
            write_cache(root, name, &reg.url, &info);
            Ok(info)
        }
        Err(e) => cached.map(|(info, _)| info).ok_or(e),
    }
}

pub fn search_names(root: &Path, dir: &Path, query: &str, home: Option<&Path>) -> Result<Vec<SearchHit>, String> {
    let reg = Npmrc::load(dir, root, home).registry_for(query);
    search(&reg, query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npmrc_registry_and_token() {
        let rc = Npmrc::parse("; comment\nregistry = https://npm.corp.example/repo/\n@acme:registry=https://acme.example/npm\n//npm.corp.example/repo/:_authToken=abc\n//acme.example/:_authToken=\"xyz\"\n");
        assert_eq!(rc.registry_for("lodash"), Registry { url: "https://npm.corp.example/repo".into(), token: Some("abc".into()) });
        assert_eq!(rc.registry_for("@acme/ui"), Registry { url: "https://acme.example/npm".into(), token: Some("xyz".into()) });
        assert_eq!(Npmrc::parse("").registry_for("@types/node"), Registry { url: DEFAULT_REGISTRY.into(), token: None });
        // A token for another path on the same host does not leak.
        let rc = Npmrc::parse("registry=https://h.example/a/\n//h.example/b/:_authToken=t\n");
        assert_eq!(rc.registry_for("x").token, None);
    }

    #[test]
    fn nearest_project_npmrc_wins_over_home() {
        let dir = tempfile::tempdir().expect("tmp");
        let root = dir.path().join("root");
        let pkg = root.join("packages/a");
        let home = dir.path().join("home");
        std::fs::create_dir_all(&pkg).expect("mkdir");
        std::fs::create_dir_all(&home).expect("mkdir");
        std::fs::write(home.join(".npmrc"), "registry=http://home.example/\n@x:registry=http://x.example\n").expect("write");
        std::fs::write(root.join(".npmrc"), "registry=http://root.example/\n").expect("write");
        let rc = Npmrc::load(&pkg, &root, Some(&home));
        assert_eq!(rc.registry_for("a").url, "http://root.example");
        assert_eq!(rc.registry_for("@x/y").url, "http://x.example");
    }

    #[test]
    fn parses_registry_answers() {
        let info = parse_package(br#"{"name":"a","dist-tags":{"latest":"1.2.0","next":"2.0.0-rc.1"},"versions":{"1.0.0":{},"1.2.0":{},"2.0.0-rc.1":{}}}"#).expect("doc");
        assert_eq!(info.versions, ["2.0.0-rc.1", "1.2.0", "1.0.0"]);
        assert_eq!(info.dist_tags[0], ("latest".to_string(), "1.2.0".to_string()));
        let hits = parse_search(br#"{"objects":[{"package":{"name":"react","version":"19.0.0","description":"UI"}}],"total":1}"#).expect("search");
        assert_eq!(hits, [SearchHit { name: "react".into(), version: "19.0.0".into(), description: "UI".into() }]);
        assert_eq!(encode_name("@types/node"), "@types%2Fnode");
        assert_eq!(encode_query("@types/no de"), "%40types%2Fno%20de");
    }

    #[test]
    fn disk_cache_round_trip() {
        let dir = tempfile::tempdir().expect("tmp");
        let info = PackageInfo::new(vec!["1.0.0".into(), "1.1.0".into()], vec![("latest".into(), "1.1.0".into())]);
        write_cache(dir.path(), "@s/p", "http://r", &info);
        let (back, age) = read_cache(dir.path(), "@s/p", "http://r").expect("cached");
        assert_eq!(back, info);
        assert!(age < FRESH);
        assert!(read_cache(dir.path(), "@s/p", "http://other").is_none());
        assert_eq!(std::fs::read_to_string(dir.path().join(".harwex/cache/.gitignore")).expect("ignore"), "*\n");
    }
}
