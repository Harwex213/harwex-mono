//! oxlint as a lint source: one `oxlint --lsp` per (workspace root, oxlint install,
//! type-aware flag), started on the first linted file and stopped when idle.
//!
//! oxlint's npm package starts with `#!/usr/bin/env node`, so it runs as
//! `node <package>/bin/oxlint --lsp`. The type-aware backend is found through
//! `OXLINT_TSGOLINT_PATH`, so a symlinked install works too.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ide_lsp::{ClientConfig, Diagnostic, LspClient};
use serde_json::{json, Value};

use super::strategy::OxlintPlan;
use super::{LintSource, LintTarget, SourceId};
use crate::lang::lock;

const TIMEOUT: Duration = Duration::from_secs(30);
/// Crashes in a row before the server is left stopped until the settings change.
const MAX_CRASHES: u32 = 3;

type Key = (PathBuf, PathBuf, bool);

struct Server {
    client: LspClient,
    crashes: u32,
    /// The last crash message once `MAX_CRASHES` was reached.
    broken: Option<String>,
}

#[derive(Default)]
pub struct OxlintSource {
    servers: Mutex<HashMap<Key, Arc<Mutex<Server>>>>,
    /// Pid cells of the servers' clients: readable while a lint holds a server's lock.
    pids: Mutex<Vec<Arc<std::sync::atomic::AtomicU32>>>,
    /// Which server each linted file was opened in, so `close` reaches it.
    files: Mutex<HashMap<PathBuf, Key>>,
}

impl OxlintSource {
    fn server(&self, plan: &OxlintPlan) -> Result<(Key, Arc<Mutex<Server>>), String> {
        let key: Key = (plan.install.root.clone(), plan.install.package.clone(), plan.type_aware);
        if let Some(s) = lock(&self.servers).get(&key) {
            return Ok((key, s.clone()));
        }
        let node = ide_ts::find_node().ok_or("node not found: oxlint runs with node")?;
        let mut config = ClientConfig::new("oxlint", node.clone());
        config.args = vec![plan.install.package.join("bin/oxlint").display().to_string(), "--lsp".into()];
        config.cwd = Some(plan.install.root.clone());
        config.root = Some(plan.install.root.clone());
        if let Some(dir) = node.parent() {
            let path = std::env::var_os("PATH").map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
            config.env.push(("PATH".into(), format!("{}:{path}", dir.display())));
        }
        if let Some(t) = &plan.install.tsgolint {
            config.env.push(("OXLINT_TSGOLINT_PATH".into(), t.display().to_string()));
        }
        config.language_id = language_id;
        let options = settings(plan.type_aware);
        config.initialization_options = Some(json!([{"workspaceUri": ide_lsp::path_to_uri(&plan.install.root), "options": options}]));
        let answer = options.clone();
        config.configuration = Some(Arc::new(move |_item: &Value| answer.clone()));
        let client = LspClient::new(config);
        lock(&self.pids).push(client.pid_cell());
        let server = Arc::new(Mutex::new(Server { client, crashes: 0, broken: None }));
        lock(&self.servers).insert(key.clone(), server.clone());
        Ok((key, server))
    }
}

/// The oxc language server's workspace options. Diagnostics run on every change (`onType`):
/// the app already debounces.
pub fn settings(type_aware: bool) -> Value {
    json!({
        "run": "onType",
        "configPath": null,
        "tsConfigPath": null,
        "unusedDisableDirectives": "allow",
        "typeAware": type_aware,
        "disableNestedConfig": false,
        "fixKind": "safe_fix",
    })
}

pub(crate) fn language_id(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or_default() {
        "tsx" => "typescriptreact",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "javascriptreact",
        _ => "typescript",
    }
}

impl LintSource for OxlintSource {
    fn id(&self) -> SourceId {
        SourceId::Oxlint
    }

    fn lint(&self, target: &LintTarget, path: &Path, text: &str) -> Result<Vec<Diagnostic>, String> {
        let LintTarget::Oxlint(plan) = target else { return Err("not an oxlint target".into()) };
        let (key, server) = self.server(plan)?;
        lock(&self.files).insert(path.to_path_buf(), key);
        let mut s = lock(&server);
        if let Some(why) = &s.broken {
            return Err(why.clone());
        }
        s.client.change(path, text, TIMEOUT);
        match s.client.diagnostics(path, TIMEOUT) {
            Ok(d) => {
                s.crashes = 0;
                Ok(d)
            }
            Err(e @ ide_lsp::Error::ServerDied(_)) => {
                s.crashes += 1;
                let msg = format!("oxlint language server exited ({}x): {e}", s.crashes);
                if s.crashes >= MAX_CRASHES {
                    s.broken = Some(format!("{msg}. It stays off until .harwex/ide.toml changes or the project reopens."));
                    return Err(s.broken.clone().unwrap_or_default());
                }
                Err(msg)
            }
            Err(e) => Err(e.to_string()),
        }
    }

    fn close(&self, path: &Path) {
        let Some(key) = lock(&self.files).remove(path) else { return };
        let server = lock(&self.servers).get(&key).cloned();
        if let Some(s) = server {
            lock(&s).client.close(path);
        }
    }

    fn stop_idle(&self, idle: Duration) -> Vec<String> {
        let open: Vec<Key> = lock(&self.files).values().cloned().collect();
        let mut stopped = Vec::new();
        let servers: Vec<(Key, Arc<Mutex<Server>>)> = lock(&self.servers).iter().map(|(k, s)| (k.clone(), s.clone())).collect();
        for (key, s) in servers {
            let s = lock(&s);
            if open.contains(&key) {
                continue;
            }
            if s.client.idle_for().is_some_and(|d| d >= idle) {
                s.client.shutdown();
                stopped.push(format!("oxlint for {}", key.0.display()));
            }
        }
        stopped
    }

    fn running(&self) -> usize {
        let servers: Vec<Arc<Mutex<Server>>> = lock(&self.servers).values().cloned().collect();
        servers.iter().filter(|s| lock(s).client.is_running()).count()
    }

    fn pids(&self) -> Vec<u32> {
        // Never waits: a cell list being extended right now is skipped for this call.
        let Ok(cells) = self.pids.try_lock() else { return Vec::new() };
        cells.iter().map(|c| c.load(std::sync::atomic::Ordering::Relaxed)).filter(|&p| p != 0).collect()
    }

    fn shutdown(&self) {
        lock(&self.pids).clear();
        let servers: Vec<Arc<Mutex<Server>>> = lock(&self.servers).drain().map(|(_, s)| s).collect();
        for s in servers {
            lock(&s).client.shutdown();
        }
        lock(&self.files).clear();
    }
}
