//! TypeScript and JavaScript through `ide-ts` (native `tsc --lsp` or tsserver). `ide-ts`
//! already keeps one server per TypeScript installation (rule 6); this adapter adds the
//! status label and the idle stop.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use ide_ts::TsService;

use super::{lock, HoverInfo, LanguageServer, Location, Reference, RenameEdits};
use crate::nav::NavKind;

pub struct TsServer {
    pub service: TsService,
    /// Backend label per open file ("TS 7.0.2 native"), for the status bar.
    labels: Mutex<HashMap<PathBuf, String>>,
    /// When the service was last used; `None` while no server was started since the last stop.
    last_used: Mutex<Option<Instant>>,
}

impl Default for TsServer {
    fn default() -> Self {
        TsServer::new()
    }
}

impl TsServer {
    pub fn new() -> TsServer {
        let service = TsService::new();
        // The first request loads the whole project; in a big workspace that can exceed 5 s.
        service.set_timeout(Duration::from_secs(20));
        TsServer { service, labels: Mutex::default(), last_used: Mutex::default() }
    }

    fn touch(&self) {
        *lock(&self.last_used) = Some(Instant::now());
    }
}

impl LanguageServer for TsServer {
    fn open(&self, path: &Path, text: &str) {
        self.touch();
        self.service.open(path, text);
        // The lookup is cached by then, so this costs no file system walk.
        let label = self.service.backend(path).map(|b| b.label()).unwrap_or_else(|_| "no TypeScript".into());
        lock(&self.labels).insert(path.to_path_buf(), label);
    }

    fn change(&self, path: &Path, text: &str) {
        self.touch();
        self.service.change(path, text);
    }

    fn close(&self, path: &Path) {
        self.touch();
        self.service.close(path);
        lock(&self.labels).remove(path);
    }

    fn locations(&self, kind: NavKind, path: &Path, line: usize, column: usize) -> Result<Vec<Location>, String> {
        self.touch();
        let r = match kind {
            NavKind::SourceDefinition => self.service.source_definition(path, line, column),
            NavKind::TypeDefinition => self.service.type_definition(path, line, column),
            NavKind::Declaration | NavKind::Usages => self.service.definition(path, line, column),
            // ide-ts has no implementation request yet.
            NavKind::Implementation => Ok(Vec::new()),
        };
        r.map_err(|e| e.to_string())
    }

    fn references(&self, path: &Path, line: usize, column: usize) -> Result<Vec<Reference>, String> {
        self.touch();
        self.service.references(path, line, column).map_err(|e| e.to_string())
    }

    fn hover(&self, path: &Path, line: usize, column: usize) -> Result<Option<HoverInfo>, String> {
        self.touch();
        let info = self.service.quick_info(path, line, column).map_err(|e| e.to_string())?;
        Ok(info.map(|i| HoverInfo { display: i.display, documentation: i.documentation, tags: i.tags.into_iter().map(|t| (t.name, t.text)).collect() }))
    }

    fn diagnostics(&self, path: &Path) -> Result<Option<Vec<ide_lsp::Diagnostic>>, String> {
        self.touch();
        self.service.diagnostics(path).map(Some).map_err(|e| e.to_string())
    }

    fn rename_edits(&self, old: &Path, new: &Path, candidates: &[PathBuf]) -> Result<RenameEdits, String> {
        self.touch();
        let found = self.service.edits_for_file_rename(old, new, candidates).map_err(|e| e.to_string())?;
        Ok(RenameEdits { edits: found.edits, projects_loaded: found.projects_loaded })
    }

    fn file_references(&self, path: &Path, candidates: &[PathBuf]) -> Result<Vec<Reference>, String> {
        self.touch();
        self.service.file_references(path, candidates).map_err(|e| e.to_string())
    }

    fn files_renamed(&self, old: &Path, new: &Path) {
        self.service.files_renamed(old, new);
        lock(&self.labels).retain(|p, _| !p.starts_with(old));
    }

    fn files_deleted(&self, path: &Path) {
        self.service.files_deleted(path);
        lock(&self.labels).retain(|p, _| !p.starts_with(path));
    }

    fn status(&self, path: &Path) -> Option<String> {
        lock(&self.labels).get(path).cloned()
    }

    fn stop_idle(&self, idle: Duration) -> Vec<String> {
        let used = *lock(&self.last_used);
        let Some(used) = used else { return Vec::new() };
        if !lock(&self.labels).is_empty() || used.elapsed() < idle {
            return Vec::new();
        }
        self.service.shutdown();
        *lock(&self.last_used) = None;
        vec!["the TypeScript server".to_string()]
    }

    fn running(&self) -> usize {
        // `ide-ts` starts its processes lazily; "used since the last stop" is the best proxy
        // without asking it, and asking could wait on a starting server.
        usize::from(lock(&self.last_used).is_some())
    }

    fn take_notice(&self) -> Option<(String, String)> {
        None
    }

    fn pids(&self) -> Vec<u32> {
        self.service.pids()
    }

    fn shutdown(&self) {
        self.service.shutdown();
        *lock(&self.last_used) = None;
    }
}
