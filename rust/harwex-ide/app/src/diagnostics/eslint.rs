//! ESLint as a lint source: one node process per workspace root runs `eslint_server.js`,
//! started on the first linted file and stopped when idle.
//!
//! Why our own small server and not `vscode-eslint`'s: the script keeps one `ESLint`
//! instance per config directory, so the config loads once and a warm lint only parses and
//! runs rules. It speaks the LSP subset `ide-lsp` already has (full-text sync, pull
//! diagnostics), needs no package beyond the project's own `eslint`, and no settings
//! handshake. The app finds the config directory (`strategy::detect`) and sends it with each
//! request, so a monorepo with a config per package still runs one process.
//!
//! The first lint for a config directory or TS project loads the config and, with
//! typescript-eslint's `projectService`, builds a TS program. That shows in the status bar as
//! "ESLint: loading <dir>".

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ide_lsp::{ClientConfig, Diagnostic, LineBreaks, LineIndex, LspClient};
use serde_json::json;

use super::strategy::EslintPlan;
use super::{LintSource, LintTarget, SourceId};
use crate::jobs::Jobs;
use crate::lang::lock;

/// A cold type-aware lint builds a TS program; on a big package that takes seconds.
const TIMEOUT: Duration = Duration::from_secs(60);
/// Crashes in a row before the server is left stopped until the settings change.
const MAX_CRASHES: u32 = 3;

pub const SERVER_JS: &str = include_str!("eslint_server.js");

struct Server {
    client: LspClient,
    crashes: u32,
    broken: Option<String>,
    /// (config dir, project) pairs linted since the process started: their next lint is warm.
    warm: HashSet<(PathBuf, PathBuf)>,
}

pub struct EslintSource {
    /// Keyed by the workspace root.
    servers: Mutex<HashMap<PathBuf, Arc<Mutex<Server>>>>,
    /// Which server each linted file was opened in, so `close` reaches it.
    files: Mutex<HashMap<PathBuf, PathBuf>>,
    jobs: Option<Jobs>,
}

impl EslintSource {
    pub fn new(jobs: Option<Jobs>) -> EslintSource {
        EslintSource { servers: Mutex::default(), files: Mutex::default(), jobs }
    }

    fn server(&self, plan: &EslintPlan) -> Result<Arc<Mutex<Server>>, String> {
        let root = &plan.install.root;
        if let Some(s) = lock(&self.servers).get(root) {
            return Ok(s.clone());
        }
        let node = ide_ts::find_node().ok_or("node not found: ESLint runs with node")?;
        let mut config = ClientConfig::new("eslint", node.clone());
        // `--expose-gc`: the server collects at once after it drops the TS projects.
        config.args = vec!["--expose-gc".into(), "-e".into(), SERVER_JS.into()];
        config.cwd = Some(root.clone());
        config.root = Some(root.clone());
        if let Some(dir) = node.parent() {
            let path = std::env::var_os("PATH").map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
            config.env.push(("PATH".into(), format!("{}:{path}", dir.display())));
        }
        // A config can leave out its type-aware rules in the IDE (docs/usage.md).
        config.env.push(("HARWEX_IDE".into(), "1".into()));
        config.language_id = super::oxlint::language_id;
        let server = Arc::new(Mutex::new(Server { client: LspClient::new(config), crashes: 0, broken: None, warm: HashSet::new() }));
        lock(&self.servers).insert(root.clone(), server.clone());
        Ok(server)
    }
}

/// The status bar label of a cold lint: the project relative to the root.
fn loading_label(plan: &EslintPlan) -> String {
    let rel = plan.project.strip_prefix(&plan.install.root).ok().filter(|r| !r.as_os_str().is_empty());
    let name = rel.unwrap_or_else(|| Path::new(plan.project.file_name().unwrap_or_default()));
    format!("ESLint: loading {}", name.display())
}

impl LintSource for EslintSource {
    fn id(&self) -> SourceId {
        SourceId::Eslint
    }

    fn lint(&self, target: &LintTarget, path: &Path, text: &str) -> Result<Vec<Diagnostic>, String> {
        let LintTarget::Eslint(plan) = target else { return Err("not an ESLint target".into()) };
        let server = self.server(plan)?;
        lock(&self.files).insert(path.to_path_buf(), plan.install.root.clone());
        let mut s = lock(&server);
        if let Some(why) = &s.broken {
            return Err(why.clone());
        }
        if !s.client.is_running() {
            s.warm.clear();
        }
        let key = (plan.config_dir.clone(), plan.project.clone());
        let _busy = (!s.warm.contains(&key)).then(|| self.jobs.as_ref().map(|j| j.busy(loading_label(plan))));
        s.client.change(path, text, TIMEOUT);
        let params = json!({
            "textDocument": {"uri": ide_lsp::path_to_uri(path)},
            "harwex": {"configDir": plan.config_dir, "legacy": plan.legacy},
        });
        match s.client.request("textDocument/diagnostic", params, TIMEOUT) {
            Ok(result) => {
                s.crashes = 0;
                s.warm.insert(key);
                // The server converted ESLint's lines to LSP lines of the text it was sent.
                let index = LineIndex::with_breaks(text, LineBreaks::Lsp);
                Ok(ide_lsp::parse_diagnostics(&result["items"], &index))
            }
            Err(e @ ide_lsp::Error::ServerDied(_)) => {
                s.crashes += 1;
                let msg = format!("ESLint server exited ({}x): {e}", s.crashes);
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
        let Some(root) = lock(&self.files).remove(path) else { return };
        let server = lock(&self.servers).get(&root).cloned();
        let Some(s) = server else { return };
        let mut s = lock(&s);
        s.client.close(path);
        // With no open file left the server drops its ESLint instances and TS projects.
        if !lock(&self.files).values().any(|r| *r == root) {
            s.warm.clear();
        }
    }

    fn stop_idle(&self, idle: Duration) -> Vec<String> {
        let open: Vec<PathBuf> = lock(&self.files).values().cloned().collect();
        let servers: Vec<(PathBuf, Arc<Mutex<Server>>)> = lock(&self.servers).iter().map(|(k, s)| (k.clone(), s.clone())).collect();
        let mut stopped = Vec::new();
        for (root, s) in servers {
            if open.contains(&root) {
                continue;
            }
            let mut s = lock(&s);
            if s.client.idle_for().is_some_and(|d| d >= idle) {
                s.client.shutdown();
                s.warm.clear();
                stopped.push(format!("ESLint for {}", root.display()));
            }
        }
        stopped
    }

    fn running(&self) -> usize {
        let servers: Vec<Arc<Mutex<Server>>> = lock(&self.servers).values().cloned().collect();
        servers.iter().filter(|s| lock(s).client.is_running()).count()
    }

    fn shutdown(&self) {
        let servers: Vec<Arc<Mutex<Server>>> = lock(&self.servers).drain().map(|(_, s)| s).collect();
        for s in servers {
            lock(&s).client.shutdown();
        }
        lock(&self.files).clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::strategy::EslintInstall;

    #[test]
    fn loading_label_names_the_project_under_the_root() {
        let plan = |project: &str| EslintPlan {
            install: EslintInstall { root: "/w".into(), package: "/w/node_modules/eslint".into(), version: "10.12.0".into() },
            config_dir: "/w".into(),
            legacy: false,
            project: project.into(),
        };
        assert_eq!(loading_label(&plan("/w/packages/a")), "ESLint: loading packages/a");
        assert_eq!(loading_label(&plan("/w")), "ESLint: loading w");
    }
}
