//! The Project tree's context menu, its keys and the dialogs behind them: New File, Cut /
//! Copy / Paste, paths, Find Usages, Find and Replace in Files, Rename with import updates,
//! safe Delete to the Trash, Open In, Git, Reload from Disk and folder exclusion.
//!
//! Disk work runs in `fileops` on workers. Rename, move and safe delete ask the language
//! servers through `state.ws.langs`: first a text pre-filter over the file index finds candidate
//! importers (so a TypeScript server loads their projects), then the servers answer. A
//! running question shows its progress in the dialog and can be cancelled; a cancelled or
//! stale answer is dropped by its generation.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use egui::{Context, Key, Modal, RichText, ScrollArea, TextEdit, Ui};
use ide_editor::{EditKind, Position};

use crate::fileops::{self, Collision};
use crate::lang::{lock, FileEdit, LangId, LanguageServer, Reference, TextEdit as Edit};
use crate::notifications::Level;
use crate::state::AppState;
use crate::tabs::TabId;
use crate::theme;
use crate::watcher::FsBatch;

/// A tree row the menu or a key acts on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub path: PathBuf,
    pub is_dir: bool,
}

impl Target {
    /// The folder a new entry, a paste or a scoped search goes into.
    pub fn dir(&self) -> PathBuf {
        if self.is_dir {
            self.path.clone()
        } else {
            self.path.parent().unwrap_or(&self.path).to_path_buf()
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TreeCommand {
    NewFile,
    NewDir,
    Cut,
    Copy,
    Paste,
    CopyAbsPath,
    CopyProjectPath,
    FindUsages,
    FindInFiles,
    ReplaceInFiles,
    Rename,
    Delete,
    OpenInFinder,
    OpenInTerminal,
    GitRollback,
    GitHistory,
    ReloadFromDisk,
    Exclude,
    CancelExclusion,
    CancelCut,
    /// Reveals the item in the Project tree. Only menus outside the tree offer it.
    SelectInProject,
}

impl TreeCommand {
    /// Commands that need exactly one item; the menu disables them for several.
    pub fn single_only(self) -> bool {
        !matches!(self, TreeCommand::Cut | TreeCommand::Copy | TreeCommand::CancelCut | TreeCommand::CopyAbsPath | TreeCommand::CopyProjectPath | TreeCommand::Delete | TreeCommand::GitRollback | TreeCommand::ReloadFromDisk)
    }
}

/// The Cut or Copy mark. Cut items draw grey until they are pasted or Escape cancels them.
#[derive(Clone, Debug)]
pub struct Clip {
    pub paths: Vec<PathBuf>,
    pub cut: bool,
}

/// Progress text a worker updates and the dialog shows.
pub type Progress = Arc<Mutex<String>>;

pub struct NewEntry {
    pub dir: PathBuf,
    pub is_dir: bool,
    pub name: String,
    pub error: Option<String>,
    focus: bool,
    busy: bool,
}

pub enum RenamePhase {
    Edit,
    Computing { generation: u64, progress: Progress },
    Preview { new: PathBuf, result: Box<QueryResult> },
}

pub struct Rename {
    pub target: Target,
    pub name: String,
    pub error: Option<String>,
    /// Opt-in: also list plain text occurrences of the name (never edited).
    pub text_occurrences: bool,
    pub phase: RenamePhase,
    focus: bool,
}

pub enum Usages {
    Off,
    Searching { generation: u64, progress: Progress },
    Found(Vec<Reference>),
}

pub struct Delete {
    /// One or more items; none inside another.
    pub targets: Vec<Target>,
    pub safe: bool,
    pub usages: Usages,
}

/// One item of a move: Cut + Paste or a drop.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Move {
    pub src: PathBuf,
    pub dst: PathBuf,
    /// Trash an existing `dst` first.
    pub overwrite: bool,
}

pub enum MovePhase {
    /// `since` is the input time of the start: the dialog shows only when the servers take a
    /// while, so a move without imports does not flash a dialog.
    Computing { generation: u64, progress: Progress, since: f64 },
    Preview(Box<QueryResult>),
}

/// The answer to one "already exists" dialog.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Clash {
    Policy(Collision),
    /// Leave this item where it is.
    Skip,
}

/// The import preview of a move, like Rename's: Move or Cancel before anything is written.
pub struct MoveDialog {
    pub moves: Vec<Move>,
    pub dir: PathBuf,
    pub phase: MovePhase,
}

/// The Computing phase of a move stays hidden this long (input time).
pub const MOVE_DIALOG_DELAY: f64 = 0.3;

pub enum Dialog {
    NewEntry(NewEntry),
    Rename(Rename),
    Delete(Delete),
    Move(MoveDialog),
    /// The paste target of `srcs[at]` exists on disk or is the target of an earlier item of the
    /// same paste: Overwrite, Keep Both, Skip (several items) or Cancel. One dialog per clash;
    /// `decided` holds the answers so far, one slot per item.
    Collision { srcs: Vec<PathBuf>, dir: PathBuf, cut: bool, decided: Vec<Option<Clash>>, at: usize },
    Rollback { paths: Vec<PathBuf>, files: Vec<PathBuf> },
    /// Dirty tabs to reload from disk after a confirmation.
    Reload { tabs: Vec<TabId>, names: Vec<String> },
}

#[derive(Default)]
pub struct TreeOps {
    pub clip: Option<Clip>,
    pub dialog: Option<Dialog>,
    generation: u64,
    cancel: Option<Arc<AtomicBool>>,
}

impl TreeOps {
    /// True while a cut item waits for Paste (Escape cancels it).
    pub fn has_cut(&self) -> bool {
        self.clip.as_ref().is_some_and(|c| c.cut)
    }

    /// Whether `path` is a cut item or inside one (drawn grey).
    pub fn is_cut(&self, path: &Path) -> bool {
        self.clip.as_ref().is_some_and(|c| c.cut && c.paths.iter().any(|p| path.starts_with(p)))
    }

    /// Forgets clip items at or under `path` (deleted or moved away).
    fn unclip_under(&mut self, path: &Path) {
        if let Some(c) = &mut self.clip {
            c.paths.retain(|p| !p.starts_with(path));
            if c.paths.is_empty() {
                self.clip = None;
            }
        }
    }

    fn next_generation(&mut self) -> (u64, Arc<AtomicBool>) {
        if let Some(c) = self.cancel.take() {
            c.store(true, Ordering::Relaxed);
        }
        self.generation += 1;
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancel = Some(cancel.clone());
        (self.generation, cancel)
    }

    fn cancel_running(&mut self) {
        if let Some(c) = self.cancel.take() {
            c.store(true, Ordering::Relaxed);
        }
        self.generation += 1;
    }
}

/// What the menu needs to know about the row and the app.
pub struct MenuInfo {
    pub can_paste: bool,
    pub excluded: bool,
    pub has_changes: bool,
    pub has_repo: bool,
    /// The items the menu acts on: the selection when the row is part of it.
    pub count: usize,
}

/// Draws the menu items. Returns the picked command. With several items the commands that
/// need one item are disabled.
pub fn menu(ui: &mut Ui, target: &Target, info: &MenuInfo) -> Option<TreeCommand> {
    ui.set_min_width(260.0);
    let mut picked = None;
    let several = info.count > 1;
    let mut item = |ui: &mut Ui, label: &str, shortcut: &str, enabled: bool, cmd: TreeCommand| {
        let enabled = enabled && !(several && cmd.single_only());
        if ui.add_enabled(enabled, egui::Button::new(label).shortcut_text(shortcut)).clicked() {
            picked = Some(cmd);
            ui.close_menu();
        }
    };
    item(ui, "New File...", "⌘.", true, TreeCommand::NewFile);
    item(ui, "New Directory...", "", true, TreeCommand::NewDir);
    ui.separator();
    item(ui, "Cut", "⌘X", true, TreeCommand::Cut);
    item(ui, "Copy", "⌘C", true, TreeCommand::Copy);
    item(ui, "Paste", "⌘V", info.can_paste, TreeCommand::Paste);
    item(ui, "Copy Absolute Path", "⇧⌘C", true, TreeCommand::CopyAbsPath);
    item(ui, "Copy Project Path", "⌥C", true, TreeCommand::CopyProjectPath);
    ui.separator();
    item(ui, "Find Usages", "⌥F7", true, TreeCommand::FindUsages);
    item(ui, "Find in Files...", "⇧⌘F", true, TreeCommand::FindInFiles);
    item(ui, "Replace in Files...", "⇧⌘R", true, TreeCommand::ReplaceInFiles);
    ui.separator();
    item(ui, "Rename...", "⇧F6", true, TreeCommand::Rename);
    item(ui, "Delete...", "⌫", true, TreeCommand::Delete);
    ui.separator();
    item(ui, "Open In Finder", "", true, TreeCommand::OpenInFinder);
    item(ui, "Open In Terminal", "", true, TreeCommand::OpenInTerminal);
    ui.separator();
    item(ui, "Git Rollback...", "", info.has_repo && info.has_changes, TreeCommand::GitRollback);
    item(ui, "Git Show History", "", info.has_repo, TreeCommand::GitHistory);
    ui.separator();
    item(ui, "Reload from Disk", "", true, TreeCommand::ReloadFromDisk);
    if target.is_dir && !several {
        if info.excluded {
            item(ui, "Cancel Exclusion", "", true, TreeCommand::CancelExclusion);
        } else {
            item(ui, "Mark Directory as Excluded", "", true, TreeCommand::Exclude);
        }
    }
    picked
}

/// The file menu outside the tree (a breadcrumb): Select in Project, then the tree's own items,
/// so both menus list the same file commands.
pub fn file_menu(ui: &mut Ui, target: &Target, info: &MenuInfo) -> Option<TreeCommand> {
    let mut picked = None;
    if ui.add(egui::Button::new("Select in Project").shortcut_text("⌥F1")).clicked() {
        picked = Some(TreeCommand::SelectInProject);
        ui.close_menu();
    }
    ui.separator();
    menu(ui, target, info).or(picked)
}

/// The menu state of one item that is not a tree row (a breadcrumb).
pub fn menu_info(state: &AppState, target: &Target) -> MenuInfo {
    let git = &state.ws.git;
    let has_changes = if target.is_dir { git.dirty_dirs.contains(&target.path) } else { git.status.get(&target.path).is_some_and(|k| *k != ide_git::ChangeKind::Untracked) };
    MenuInfo { can_paste: state.ws.tree_ops.clip.is_some(), excluded: state.ws.tree.excluded.contains(&target.path), has_changes, has_repo: git.repo.is_some(), count: 1 }
}

/// Runs a menu command or a tree key on `targets` (the selection, at least one item). A
/// command that needs one item does nothing for several.
pub fn run(state: &mut AppState, cmd: TreeCommand, targets: Vec<Target>) {
    let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) else { return };
    let Some(target) = targets.first().cloned() else { return };
    if targets.len() > 1 && cmd.single_only() {
        return;
    }
    let paths: Vec<PathBuf> = targets.iter().map(|t| t.path.clone()).collect();
    match cmd {
        TreeCommand::NewFile | TreeCommand::NewDir => {
            let is_dir = cmd == TreeCommand::NewDir;
            state.ws.tree_ops.dialog = Some(Dialog::NewEntry(NewEntry { dir: target.dir(), is_dir, name: String::new(), error: None, focus: true, busy: false }));
        }
        TreeCommand::Cut | TreeCommand::Copy => {
            let paths = crate::tree::top_level(&paths);
            // The names go to the clipboard too: macOS sends ⌘V as a paste event only when
            // the clipboard holds text.
            let names: Vec<String> = paths.iter().map(|p| fileops::file_name(p)).collect();
            state.platform.copy_text(&state.ctx, &names.join("\n"));
            state.ws.tree_ops.clip = Some(Clip { paths, cut: cmd == TreeCommand::Cut });
        }
        TreeCommand::CancelCut => state.ws.tree_ops.clip = None,
        TreeCommand::Paste => {
            if let Some(clip) = state.ws.tree_ops.clip.clone() {
                paste(state, clip.paths, target.dir(), clip.cut, Vec::new());
            }
        }
        TreeCommand::CopyAbsPath => {
            let lines: Vec<String> = paths.iter().map(|p| p.display().to_string()).collect();
            state.platform.copy_text(&state.ctx, &lines.join("\n"));
        }
        TreeCommand::CopyProjectPath => {
            let lines: Vec<String> = paths.iter().map(|p| fileops::relative(&root, p)).collect();
            state.platform.copy_text(&state.ctx, &lines.join("\n"));
        }
        TreeCommand::FindUsages => find_file_usages(state, target.path, None),
        TreeCommand::FindInFiles => state.ws.find.open_scoped(Some(target.dir()), false),
        TreeCommand::ReplaceInFiles => state.ws.find.open_scoped(Some(target.dir()), true),
        TreeCommand::Rename => {
            let name = fileops::file_name(&target.path);
            state.ws.tree_ops.cancel_running();
            state.ws.tree_ops.dialog = Some(Dialog::Rename(Rename { target, name, error: None, text_occurrences: false, phase: RenamePhase::Edit, focus: true }));
        }
        TreeCommand::Delete => {
            // The project root itself is never deleted from the tree.
            let top = crate::tree::top_level(&paths);
            let targets: Vec<Target> = targets.into_iter().filter(|t| top.contains(&t.path) && t.path != root).collect();
            if targets.is_empty() {
                return;
            }
            state.ws.tree_ops.dialog = Some(Dialog::Delete(Delete { targets, safe: true, usages: Usages::Off }));
            start_delete_search(state);
        }
        TreeCommand::OpenInFinder => {
            let platform = state.platform.clone();
            let path = target.path;
            state.jobs.spawn_quiet(
                move || platform.reveal(&path),
                |state, res| {
                    if let Err(e) = res {
                        state.notifications.error("Cannot open Finder", e);
                    }
                },
            );
        }
        TreeCommand::OpenInTerminal => crate::terminal::open_at(state, target.dir()),
        TreeCommand::GitRollback => {
            let Some(workdir) = state.ws.git.repo.as_ref().map(|r| r.workdir().to_path_buf()) else { return };
            let files: Vec<PathBuf> = state.ws.git.changes.iter().filter(|c| !c.is_untracked()).map(|c| workdir.join(&c.path)).filter(|p| paths.iter().any(|t| p.starts_with(t))).collect();
            if files.is_empty() {
                let names: Vec<String> = paths.iter().map(|p| fileops::relative(&root, p)).collect();
                state.notifications.info("Nothing to roll back", format!("{} {} no changes.", names.join(", "), plural(names.len(), "has", "have")));
            } else {
                state.ws.tree_ops.dialog = Some(Dialog::Rollback { paths, files });
            }
        }
        TreeCommand::GitHistory => crate::git::log::show_file_history(state, &target.path),
        TreeCommand::SelectInProject => crate::tree::select_path(state, &target.path),
        TreeCommand::ReloadFromDisk => reload_from_disk(state, &targets),
        TreeCommand::Exclude | TreeCommand::CancelExclusion => {
            let rel = fileops::relative(&root, &target.path);
            let exclude = cmd == TreeCommand::Exclude;
            let generation = state.project_generation();
            state.jobs.spawn(
                if exclude { "Excluding folder" } else { "Cancelling exclusion" },
                move || fileops::set_excluded(&root, &rel, exclude).map(|_| crate::lang::IdeConfig::load(&root)),
                move |state, res| match res {
                    Ok(config) if state.project_generation() == generation => state.apply_ide_config(config),
                    Ok(_) => {}
                    Err(e) => state.notifications.error("Cannot change .harwex/ide.toml", e),
                },
            );
        }
    }
}

// ---------------------------------------------------------------------------------------
// Asking the language servers

/// What the servers (and the fallbacks) said.
#[derive(Default)]
pub struct QueryResult {
    pub edits: Vec<FileEdit>,
    pub refs: Vec<Reference>,
    /// Plain text hits of the name (opt-in, never edited).
    pub text_hits: Vec<Reference>,
    pub scanned: usize,
    pub candidates: usize,
    pub projects: usize,
    pub errors: Vec<String>,
    /// Servers that answered without an error.
    pub answered: usize,
}

impl QueryResult {
    pub fn edit_count(&self) -> usize {
        self.edits.iter().map(|f| f.edits.len()).sum()
    }
}

#[derive(Clone)]
enum Question {
    Rename { new: PathBuf, text_occurrences: bool },
    Usages,
}

type Done = Box<dyn FnOnce(&mut AppState, QueryResult) + Send>;

/// Languages of a file, or of the files inside a folder (a bounded walk).
fn langs_at(path: &Path) -> Vec<LangId> {
    if !path.is_dir() {
        return LangId::for_path(path).into_iter().collect();
    }
    let mut found: Vec<LangId> = Vec::new();
    let walker = ignore::WalkBuilder::new(path).hidden(false).filter_entry(|e| e.file_name() != ".git" && e.file_name() != "node_modules" && e.file_name() != "target").build();
    for e in walker.filter_map(Result::ok).take(20_000) {
        if let Some(l) = LangId::for_path(e.path()) {
            if !found.contains(&l) {
                found.push(l);
                if found.len() == LangId::ALL.len() {
                    break;
                }
            }
        }
    }
    found
}

/// Code files of the file index, absolute.
fn code_files(root: &Path, index: &[String]) -> Vec<PathBuf> {
    index.iter().filter(|f| LangId::for_path(Path::new(f.as_str())) == Some(LangId::TypeScript)).map(|f| root.join(f)).collect()
}

fn set_progress(progress: &Progress, ctx: &Context, text: String) {
    *lock(progress) = text;
    ctx.request_repaint();
}

/// The pipeline behind Rename, Paste after Cut, Delete and Find Usages: the pre-filter on a
/// worker, then each language's server on its queue, then the fallbacks. `done` runs on the
/// UI thread unless `cancel` was set.
fn ask(state: &mut AppState, target: PathBuf, question: Question, progress: Progress, cancel: Arc<AtomicBool>, done: Done) {
    let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) else { return };
    // The servers must see the editor text, not an older copy.
    let ids: Vec<TabId> = state.ws.tabs.editors_mut().map(|(id, _)| id).collect();
    for id in ids {
        crate::nav::flush_lsp(state, id);
    }
    let index = state.ws.index.files.clone();
    let excluded = state.ws.tree.excluded.clone();
    let ctx = state.ctx.clone();
    let name = fileops::file_name(&target);
    let label = match &question {
        Question::Rename { .. } => format!("Preparing rename of {name}"),
        Question::Usages => format!("Finding usages of {name}"),
    };
    let t = target.clone();
    let p = progress.clone();
    let c = cancel.clone();
    let r = root.clone();
    state.jobs.spawn(
        label,
        move || {
            let langs = langs_at(&t);
            let files = code_files(&r, &index);
            let candidates = if langs.contains(&LangId::TypeScript) {
                set_progress(&p, &ctx, format!("Scanning {} code files for imports of {name}...", files.len()));
                ide_ts::import_candidates(&files, &t, &c)
            } else {
                Vec::new()
            };
            (langs, files.len(), candidates)
        },
        move |state, (langs, scanned, candidates)| {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            let langs: Vec<LangId> = langs.into_iter().filter(|l| state.ws.langs.config.enabled(*l)).collect();
            let result = QueryResult { scanned, candidates: candidates.len(), ..Default::default() };
            ask_servers(state, target, question, langs, candidates, result, progress, cancel, root, excluded, done);
        },
    );
}

type DoneMany = Box<dyn FnOnce(&mut AppState, Vec<QueryResult>) + Send>;

/// `ask` for several items, one after the other (each language has one queue anyway). `done`
/// gets one result per question, in order, unless `cancel` was set.
fn ask_many(state: &mut AppState, questions: Vec<(PathBuf, Question)>, progress: Progress, cancel: Arc<AtomicBool>, done: DoneMany) {
    fn next(state: &mut AppState, mut rest: std::collections::VecDeque<(PathBuf, Question)>, mut acc: Vec<QueryResult>, progress: Progress, cancel: Arc<AtomicBool>, done: DoneMany) {
        let Some((target, question)) = rest.pop_front() else {
            done(state, acc);
            return;
        };
        let (p, c) = (progress.clone(), cancel.clone());
        ask(state, target, question, progress, cancel, Box::new(move |state, result| {
            acc.push(result);
            next(state, rest, acc, p, c, done);
        }));
    }
    next(state, questions.into(), Vec::new(), progress, cancel, done);
}

#[allow(clippy::too_many_arguments)]
fn ask_servers(state: &mut AppState, target: PathBuf, question: Question, langs: Vec<LangId>, candidates: Vec<PathBuf>, result: QueryResult, progress: Progress, cancel: Arc<AtomicBool>, root: PathBuf, excluded: Vec<PathBuf>, done: Done) {
    let ctx = state.ctx.clone();
    let shared = Arc::new(Mutex::new(Some(result)));
    let left = Arc::new(AtomicUsize::new(langs.len()));
    let finish: Arc<Mutex<Option<Done>>> = Arc::new(Mutex::new(Some(done)));
    // After the servers: the fallbacks and the text occurrences, on a worker.
    let jobs = state.jobs.clone();
    let after = {
        let (shared, finish, target, question, progress, cancel, ctx) = (shared.clone(), finish.clone(), target.clone(), question.clone(), progress.clone(), cancel.clone(), ctx.clone());
        move || {
            let Some(mut result) = lock(&shared).take() else { return };
            let Some(done) = lock(&finish).take() else { return };
            if matches!(question, Question::Usages) && result.answered == 0 && !cancel.load(Ordering::Relaxed) {
                set_progress(&progress, &ctx, "Searching imports as text...".into());
                result.refs = fileops::text_import_search(&root, &target, &excluded);
            }
            if let Question::Rename { text_occurrences: true, .. } = &question {
                set_progress(&progress, &ctx, "Searching text occurrences...".into());
                result.text_hits = text_occurrences(&root, &target, &excluded, &result.edits);
            }
            result.refs.retain(|r| !r.location.path.starts_with(&target));
            result.refs.sort_by(|a, b| (&a.location.path, a.location.line).cmp(&(&b.location.path, b.location.line)));
            result.refs.dedup_by(|a, b| a.location == b.location);
            let c = cancel.clone();
            jobs.post(move |state| {
                if !c.load(Ordering::Relaxed) {
                    done(state, result);
                }
            });
        }
    };
    if langs.is_empty() {
        state.jobs.spawn_quiet(after, |_, ()| {});
        return;
    }
    let after = Arc::new(Mutex::new(Some(after)));
    for lang in langs {
        let (shared, left, after, target, question, progress, candidates, cancel, ctx, jobs) =
            (shared.clone(), left.clone(), after.clone(), target.clone(), question.clone(), progress.clone(), candidates.clone(), cancel.clone(), ctx.clone(), state.jobs.clone());
        state.ws.langs.bridge(lang).run(move |server: &dyn LanguageServer| {
            if !cancel.load(Ordering::Relaxed) {
                let _busy = jobs.busy(format!("{}: {}", lang.spec().name, fileops::file_name(&target)));
                let n = candidates.len();
                set_progress(&progress, &ctx, if n > 0 { format!("Loading the projects of {n} candidate files in the {} server...", lang.spec().name) } else { format!("Asking the {} server...", lang.spec().name) });
                match &question {
                    Question::Rename { new, .. } => match server.rename_edits(&target, new, &candidates) {
                        Ok(found) => {
                            if let Some(r) = lock(&shared).as_mut() {
                                r.edits.extend(found.edits);
                                r.projects += found.projects_loaded;
                                r.answered += 1;
                            }
                        }
                        Err(e) => {
                            if let Some(r) = lock(&shared).as_mut() {
                                r.errors.push(e);
                            }
                        }
                    },
                    Question::Usages => match server.file_references(&target, &candidates) {
                        Ok(refs) => {
                            if let Some(r) = lock(&shared).as_mut() {
                                r.refs.extend(refs);
                                r.answered += 1;
                            }
                        }
                        Err(e) => {
                            if let Some(r) = lock(&shared).as_mut() {
                                r.errors.push(e);
                            }
                        }
                    },
                }
            }
            if left.fetch_sub(1, Ordering::SeqCst) == 1 {
                if let Some(after) = lock(&after).take() {
                    // Off the language queue: the text searches must not hold it up.
                    let jobs2 = jobs.clone();
                    jobs2.spawn_quiet(after, |_, ()| {});
                }
            }
        });
    }
}

/// Plain text hits of the file or folder name in every indexed file, minus the places the
/// servers edit. Listed for the user only.
fn text_occurrences(root: &Path, target: &Path, excluded: &[PathBuf], edits: &[FileEdit]) -> Vec<Reference> {
    let name = fileops::file_name(target);
    let edited: HashSet<(PathBuf, usize)> = edits.iter().flat_map(|f| f.edits.iter().map(move |e| (f.path.clone(), e.start_line))).collect();
    let mut out = Vec::new();
    let skip = excluded.to_vec();
    let walker = ignore::WalkBuilder::new(root).hidden(false).filter_entry(move |e| e.file_name() != ".git" && !skip.iter().any(|s| e.path() == s)).build();
    for e in walker.filter_map(Result::ok) {
        if !e.file_type().is_some_and(|t| t.is_file()) || e.path() == target {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        if !text.contains(&name) {
            continue;
        }
        for (line, l) in text.lines().enumerate() {
            if let Some(byte) = l.find(&name) {
                if edited.contains(&(e.path().to_path_buf(), line)) {
                    continue;
                }
                let column = l[..byte].chars().count();
                out.push(Reference {
                    location: crate::lang::Location { path: e.path().to_path_buf(), line, column },
                    end_line: line,
                    end_column: column + name.chars().count(),
                    line_text: l.to_string(),
                    is_definition: false,
                    is_write: false,
                });
            }
        }
        if out.len() > 500 {
            break;
        }
    }
    out
}

// ---------------------------------------------------------------------------------------
// Rename, move, paste, delete

fn start_rename_query(state: &mut AppState) {
    let (generation, cancel) = state.ws.tree_ops.next_generation();
    let Some(Dialog::Rename(r)) = &mut state.ws.tree_ops.dialog else { return };
    let new = r.target.path.with_file_name(r.name.trim());
    let progress: Progress = Arc::new(Mutex::new("Preparing...".into()));
    r.phase = RenamePhase::Computing { generation, progress: progress.clone() };
    let target = r.target.path.clone();
    let text_occurrences = r.text_occurrences;
    let started = Instant::now();
    let new2 = new.clone();
    ask(
        state,
        target.clone(),
        Question::Rename { new: new.clone(), text_occurrences },
        progress,
        cancel,
        Box::new(move |state, result| {
            let Some(Dialog::Rename(r)) = &mut state.ws.tree_ops.dialog else { return };
            if !matches!(&r.phase, RenamePhase::Computing { generation: g, .. } if *g == generation) {
                return;
            }
            state.timings.log(format!(
                "rename preview {}: {} files scanned, {} candidates, {} projects loaded, {} edits in {} files, {:.0} ms",
                fileops::file_name(&target),
                result.scanned,
                result.candidates,
                result.projects,
                result.edit_count(),
                result.edits.len(),
                started.elapsed().as_secs_f64() * 1000.0
            ));
            if result.edits.is_empty() && result.text_hits.is_empty() && result.errors.is_empty() {
                state.ws.tree_ops.dialog = None;
                state.ws.tree.focus_pending();
                relocate(state, target, new2, Vec::new(), false);
            } else {
                r.phase = RenamePhase::Preview { new, result: Box::new(result) };
            }
        }),
    );
}

/// Moves `old` to `new` (a rename) and applies the import edits.
fn relocate(state: &mut AppState, old: PathBuf, new: PathBuf, edits: Vec<FileEdit>, overwrite: bool) {
    relocate_all(state, vec![Move { src: old, dst: new, overwrite }], edits);
}

/// Where `path` ends up after `moves`.
fn after_moves(path: &Path, moves: &[Move]) -> Option<PathBuf> {
    moves.iter().find_map(|m| fileops::moved_path(path, &m.src, &m.dst))
}

/// Moves items (a rename, a paste after Cut, a drop) and applies the import edits: closed
/// files in parallel on workers, open documents through the edit API, one undo step each.
/// A move that fails stops the rest; the moves before it stay done.
fn relocate_all(state: &mut AppState, moves: Vec<Move>, edits: Vec<FileEdit>) {
    let Some(first) = moves.first().map(|m| m.src.clone()) else { return };
    let (open, closed): (Vec<FileEdit>, Vec<FileEdit>) = edits.into_iter().partition(|f| state.ws.tabs.editor_by_path(&f.path).is_some());
    let closed: Vec<FileEdit> = closed.into_iter().map(|f| FileEdit { path: after_moves(&f.path, &moves).unwrap_or(f.path), edits: f.edits }).collect();
    let platform = state.platform.clone();
    let generation = state.project_generation();
    let todo = moves.clone();
    let closed_paths: Vec<PathBuf> = closed.iter().map(|f| f.path.clone()).collect();
    let closed_edits: usize = closed.iter().map(|f| f.edits.len()).sum();
    let label = if moves.len() == 1 { format!("Moving {}", fileops::file_name(&first)) } else { format!("Moving {} items", moves.len()) };
    state.jobs.spawn(
        label,
        move || -> (usize, Option<String>, Vec<String>) {
            for (i, m) in todo.iter().enumerate() {
                let res = if m.overwrite { platform.trash(&m.dst) } else { Ok(()) }.and_then(|()| fileops::move_path(&m.src, &m.dst));
                if let Err(e) = res {
                    return (i, Some(e), Vec::new());
                }
            }
            // Edits for files that did not move stay valid; all moves went through here.
            (todo.len(), None, apply_closed(&closed))
        },
        move |state, (done_count, error, errors)| {
            if state.project_generation() != generation {
                return;
            }
            // After a failed move no import edit is applied: the edits assume every move.
            let failed = error.is_some();
            if let Some(e) = error {
                let name = fileops::file_name(&moves[done_count].src);
                state.notifications.error(format!("Cannot move {name}"), e);
            }
            let moves: Vec<Move> = moves.into_iter().take(done_count).collect();
            if moves.is_empty() {
                return;
            }
            for m in &moves {
                for lang in LangId::ALL {
                    let (o, n) = (m.src.clone(), m.dst.clone());
                    state.ws.langs.bridge(lang).run(move |s| s.files_renamed(&o, &n));
                }
                retarget_tabs(state, &m.src, &m.dst);
            }
            let (mut edited, mut files) = if failed { (0, 0) } else { (closed_edits, closed_paths.len()) };
            for f in open.into_iter().filter(|_| !failed) {
                let path = after_moves(&f.path, &moves).unwrap_or(f.path);
                if let Some(id) = state.ws.tabs.editor_by_path(&path) {
                    edited += f.edits.len();
                    files += 1;
                    apply_to_tab(state, id, &f.edits);
                    state.save_tab(id, false);
                }
            }
            for m in &moves {
                state.ws.tree.rekey(&m.src, &m.dst);
                state.ws.tree_ops.unclip_under(&m.src);
            }
            if let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) {
                let news: Vec<PathBuf> = moves.iter().map(|m| m.dst.clone()).collect();
                state.ws.tree.reveal(&root, &news[0]);
                if news.len() > 1 {
                    for n in &news[1..] {
                        state.ws.tree.expand_to(&root, n);
                    }
                    let lead = news[0].clone();
                    state.ws.tree.select_many(news, lead);
                }
            }
            let mut paths: HashSet<PathBuf> = closed_paths.into_iter().collect();
            for m in &moves {
                for p in [&m.src, &m.dst] {
                    paths.insert(p.clone());
                    if let Some(parent) = p.parent() {
                        paths.insert(parent.to_path_buf());
                    }
                }
            }
            state.on_fs_batch(FsBatch { paths, structure_changed: true, git_changed: false });
            for e in &errors {
                state.notifications.error("Import update failed", e.clone());
            }
            let what = if moves.len() == 1 { format!("Moved {} to {}", fileops::file_name(&moves[0].src), fileops::file_name(&moves[0].dst)) } else { format!("Moved {} items", moves.len()) };
            state.notifications.log_only(Level::Info, what, format!("Updated {edited} imports in {files} files."));
        },
    );
}

/// Applies edits to closed files on all cores. Returns one message per failed file.
fn apply_closed(files: &[FileEdit]) -> Vec<String> {
    if files.is_empty() {
        return Vec::new();
    }
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).min(8);
    let chunk = files.len().div_ceil(threads).max(1);
    let errors: Mutex<Vec<String>> = Mutex::default();
    std::thread::scope(|scope| {
        for part in files.chunks(chunk) {
            let errors = &errors;
            scope.spawn(move || {
                for f in part {
                    if let Err(e) = fileops::apply_edits_on_disk(&f.path, &f.edits) {
                        lock(errors).push(e);
                    }
                }
            });
        }
    });
    errors.into_inner().unwrap_or_default()
}

/// One undoable step per document. Ranges are taken from the current text and applied last
/// first, so each stays valid.
fn apply_to_tab(state: &mut AppState, id: TabId, edits: &[Edit]) {
    let Some(e) = state.ws.tabs.editor_mut(id) else { return };
    let mut sorted: Vec<&Edit> = edits.iter().collect();
    sorted.sort_by_key(|t| std::cmp::Reverse((t.start_line, t.start_column)));
    let ranges: Vec<(std::ops::Range<usize>, String)> = sorted
        .iter()
        .map(|t| {
            let s = e.doc.position_to_char(Position::new(t.start_line, t.start_column));
            let end = e.doc.position_to_char(Position::new(t.end_line, t.end_column)).max(s);
            (s..end, t.new_text.clone())
        })
        .collect();
    let sel = e.view.selection();
    e.doc.seal_undo_group();
    e.doc.transact(ranges, sel, sel, EditKind::Other);
    e.doc.seal_undo_group();
    e.last_edit = Instant::now();
}

/// Editor tabs under `old` follow the move: new path, language server re-open.
fn retarget_tabs(state: &mut AppState, old: &Path, new: &Path) {
    let moved: Vec<(TabId, PathBuf)> = state.ws.tabs.editors_mut().filter_map(|(id, e)| fileops::moved_path(&e.path, old, new).map(|p| (id, p))).collect();
    for (id, path) in moved {
        let lang = state.ws.langs.lang_for(&path).ok();
        let Some(e) = state.ws.tabs.editor_mut(id) else { continue };
        if let Some(l) = e.lang {
            state.ws.langs.bridge(l).close(&e.path);
        }
        e.path = path.clone();
        e.read_only = crate::lang::is_library_path(&path);
        e.invalidate_marks();
        e.lang = lang;
        e.lsp_version = None;
        if let Some(l) = lang {
            state.ws.langs.bridge(l).open(&path, e.doc.text());
            e.lsp_version = Some(e.doc.version());
        }
    }
}

/// A drop in the Project tree: the same move (with import updates) or copy as Paste after Cut
/// or Copy. Items already in `dir` do not move.
pub fn drop_into(state: &mut AppState, srcs: Vec<PathBuf>, dir: PathBuf, copy: bool) {
    if srcs.iter().any(|s| dir.starts_with(s)) {
        return;
    }
    paste(state, srcs, dir, !copy, Vec::new());
}

/// Paste: resolves the targets on a worker, in order. A target that exists on disk, or that
/// an earlier item of the same paste already takes (two items with one name from different
/// folders), is a clash: without an answer in `decided` it opens the dialog, and the answer
/// re-runs the paste. A move asks the servers for import edits first (`start_move`).
fn paste(state: &mut AppState, srcs: Vec<PathBuf>, dir: PathBuf, cut: bool, decided: Vec<Option<Clash>>) {
    enum Plan {
        Choose(usize),
        Go(Vec<Move>),
    }
    let (s, d, answers) = (srcs.clone(), dir.clone(), decided.clone());
    state.jobs.spawn_quiet(
        move || -> Result<Plan, String> {
            let mut moves: Vec<Move> = Vec::new();
            let mut taken: HashSet<PathBuf> = HashSet::new();
            for (i, src) in s.iter().enumerate() {
                let target = fileops::paste_target(src, &d)?;
                let name = fileops::file_name(src);
                if target == *src && !taken.contains(&target) {
                    // A move into its own folder does nothing; a copy there keeps both.
                    if !cut {
                        let dst = fileops::keep_both_path_avoiding(&d, &name, &taken);
                        taken.insert(dst.clone());
                        moves.push(Move { src: src.clone(), dst, overwrite: false });
                    } else {
                        taken.insert(target);
                    }
                    continue;
                }
                let on_disk = target != *src && target.symlink_metadata().is_ok();
                if !on_disk && !taken.contains(&target) {
                    taken.insert(target.clone());
                    moves.push(Move { src: src.clone(), dst: target, overwrite: false });
                    continue;
                }
                match answers.get(i).copied().flatten() {
                    None => return Ok(Plan::Choose(i)),
                    Some(Clash::Skip) => {}
                    Some(Clash::Policy(Collision::KeepBoth)) => {
                        let dst = fileops::keep_both_path_avoiding(&d, &name, &taken);
                        taken.insert(dst.clone());
                        moves.push(Move { src: src.clone(), dst, overwrite: false });
                    }
                    // The overwritten item goes to the Trash, also when an earlier item of this
                    // paste put it there: the items run in order.
                    Some(Clash::Policy(Collision::Overwrite)) => {
                        let overwrite = on_disk || taken.contains(&target);
                        moves.push(Move { src: src.clone(), dst: target, overwrite });
                    }
                }
            }
            Ok(Plan::Go(moves))
        },
        move |state, plan| match plan {
            Err(e) => state.notifications.error("Cannot paste", e),
            Ok(Plan::Choose(at)) => {
                let mut decided = decided;
                decided.resize(srcs.len(), None);
                state.ws.tree_ops.dialog = Some(Dialog::Collision { srcs, dir, cut, decided, at });
            }
            Ok(Plan::Go(moves)) if moves.is_empty() => {}
            Ok(Plan::Go(moves)) if cut => start_move(state, moves, dir),
            Ok(Plan::Go(copies)) => copy_all(state, copies, dir),
        },
    );
}

fn copy_all(state: &mut AppState, copies: Vec<Move>, dir: PathBuf) {
    let platform = state.platform.clone();
    let todo = copies.clone();
    let label = if copies.len() == 1 { format!("Copying {}", fileops::file_name(&copies[0].src)) } else { format!("Copying {} items", copies.len()) };
    state.jobs.spawn(
        label,
        move || -> Result<(), String> {
            for c in &todo {
                if c.overwrite {
                    platform.trash(&c.dst)?;
                }
                fileops::copy_path(&c.src, &c.dst)?;
            }
            Ok(())
        },
        move |state, res| {
            if let Err(e) = res {
                state.notifications.error("Cannot paste", e);
            }
            // Some copies may exist even after an error.
            let mut paths: HashSet<PathBuf> = copies.iter().map(|c| c.dst.clone()).collect();
            paths.insert(dir);
            state.on_fs_batch(FsBatch { paths, structure_changed: true, git_changed: false });
            if let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) {
                let news: Vec<PathBuf> = copies.into_iter().map(|c| c.dst).collect();
                state.ws.tree.reveal(&root, &news[0]);
                if news.len() > 1 {
                    let lead = news[0].clone();
                    state.ws.tree.select_many(news, lead);
                }
            }
        },
    );
}

/// A move keeps imports working, like a rename: the servers answer for every item, then the
/// preview shows the combined edits. A move without edits goes ahead at once.
fn start_move(state: &mut AppState, moves: Vec<Move>, dir: PathBuf) {
    let (generation, cancel) = state.ws.tree_ops.next_generation();
    let progress: Progress = Arc::new(Mutex::new("Preparing...".into()));
    let since = state.ctx.input(|i| i.time);
    state.ws.tree_ops.dialog = Some(Dialog::Move(MoveDialog { moves: moves.clone(), dir, phase: MovePhase::Computing { generation, progress: progress.clone(), since } }));
    let questions: Vec<(PathBuf, Question)> = moves.iter().map(|m| (m.src.clone(), Question::Rename { new: m.dst.clone(), text_occurrences: false })).collect();
    let started = Instant::now();
    ask_many(state, questions, progress, cancel, Box::new(move |state, results| {
        let Some(Dialog::Move(d)) = &mut state.ws.tree_ops.dialog else { return };
        if !matches!(&d.phase, MovePhase::Computing { generation: g, .. } if *g == generation) {
            return;
        }
        let result = combine_moves(&moves, results);
        state.timings.log(format!(
            "move preview of {} items: {} candidates, {} projects loaded, {} edits in {} files, {:.0} ms",
            moves.len(),
            result.candidates,
            result.projects,
            result.edit_count(),
            result.edits.len(),
            started.elapsed().as_secs_f64() * 1000.0
        ));
        if result.edits.is_empty() {
            // Nothing to preview. A server that could not answer (none installed) must not
            // block a plain move: it moves, and a warning says the imports stayed.
            state.ws.tree_ops.dialog = None;
            state.ws.tree.focus_pending();
            for e in &result.errors {
                state.notifications.warn("Imports not updated", e.clone());
            }
            relocate_all(state, moves, Vec::new());
        } else {
            d.phase = MovePhase::Preview(Box::new(result));
        }
    }));
}

/// One result for a move of several items: the edits merged (`fileops::merge_move_edits`),
/// the counts added up.
fn combine_moves(moves: &[Move], results: Vec<QueryResult>) -> QueryResult {
    let mut out = QueryResult::default();
    let mut per_move = Vec::new();
    for r in results {
        out.scanned = out.scanned.max(r.scanned);
        out.candidates += r.candidates;
        out.projects += r.projects;
        out.answered += r.answered;
        for e in r.errors {
            if !out.errors.contains(&e) {
                out.errors.push(e);
            }
        }
        per_move.push(r.edits);
    }
    let pairs: Vec<(PathBuf, PathBuf)> = moves.iter().map(|m| (m.src.clone(), m.dst.clone())).collect();
    out.edits = fileops::merge_move_edits(&pairs, per_move);
    out
}

fn start_delete_search(state: &mut AppState) {
    let (generation, cancel) = state.ws.tree_ops.next_generation();
    let Some(Dialog::Delete(d)) = &mut state.ws.tree_ops.dialog else { return };
    if !d.safe {
        d.usages = Usages::Off;
        return;
    }
    let progress: Progress = Arc::new(Mutex::new("Preparing...".into()));
    d.usages = Usages::Searching { generation, progress: progress.clone() };
    let targets: Vec<PathBuf> = d.targets.iter().map(|t| t.path.clone()).collect();
    let questions = targets.iter().map(|t| (t.clone(), Question::Usages)).collect();
    ask_many(state, questions, progress, cancel, Box::new(move |state, results| {
        let Some(Dialog::Delete(d)) = &mut state.ws.tree_ops.dialog else { return };
        if matches!(&d.usages, Usages::Searching { generation: g, .. } if *g == generation) {
            // A usage inside another deleted item goes away with it.
            let mut refs: Vec<Reference> = results.into_iter().flat_map(|r| r.refs).filter(|r| !targets.iter().any(|t| r.location.path.starts_with(t))).collect();
            refs.sort_by(|a, b| (&a.location.path, a.location.line).cmp(&(&b.location.path, b.location.line)));
            refs.dedup_by(|a, b| a.location == b.location);
            d.usages = Usages::Found(refs);
        }
    }));
}

/// Moves the items to the Trash (through `state.platform`), one worker for all of them.
fn delete(state: &mut AppState, targets: Vec<Target>) {
    let platform = state.platform.clone();
    let paths: Vec<PathBuf> = targets.into_iter().map(|t| t.path).collect();
    let todo = paths.clone();
    let generation = state.project_generation();
    let label = if paths.len() == 1 { format!("Deleting {}", fileops::file_name(&paths[0])) } else { format!("Deleting {} items", paths.len()) };
    state.jobs.spawn(
        label,
        move || todo.iter().map(|p| platform.trash(p)).collect::<Vec<Result<(), String>>>(),
        move |state, results| {
            if state.project_generation() != generation {
                return;
            }
            let mut batch: HashSet<PathBuf> = HashSet::new();
            let mut trashed = Vec::new();
            for (path, res) in paths.into_iter().zip(results) {
                if let Err(e) = res {
                    state.notifications.error(format!("Cannot move {} to the Trash", fileops::file_name(&path)), e);
                    continue;
                }
                let ids: Vec<TabId> = state.ws.tabs.editors_mut().filter(|(_, e)| e.path.starts_with(&path)).map(|(id, _)| id).collect();
                for id in ids {
                    state.close_tab(id, true);
                }
                for lang in LangId::ALL {
                    let p = path.clone();
                    state.ws.langs.bridge(lang).run(move |s| s.files_deleted(&p));
                }
                state.ws.tree_ops.unclip_under(&path);
                state.ws.tree.deselect_under(&path);
                if let Some(parent) = path.parent() {
                    batch.insert(parent.to_path_buf());
                }
                batch.insert(path.clone());
                trashed.push(fileops::file_name(&path));
            }
            if trashed.is_empty() {
                return;
            }
            state.on_fs_batch(FsBatch { paths: batch, structure_changed: true, git_changed: false });
            state.notifications.log_only(Level::Info, format!("Moved {} to the Trash", trashed.join(", ")), String::new());
        },
    );
}

/// Find Usages of a file: its importers fill Find window tab `into` (a rerun) or a new tab.
pub fn find_file_usages(state: &mut AppState, path: PathBuf, into: Option<u64>) {
    let cancel = Arc::new(AtomicBool::new(false));
    let origin = crate::find_window::UsageOrigin::File { path: path.clone() };
    let (tab, generation) = crate::find_window::start_usages(state, origin, into);
    ask(state, path, Question::Usages, Arc::default(), cancel, Box::new(move |state, result| {
        for e in result.errors {
            state.notifications.log_only(Level::Warning, "Find Usages", e);
        }
        crate::find_window::finish_usages(state, tab, generation, Ok(result.refs));
    }));
}

fn reload_from_disk(state: &mut AppState, targets: &[Target]) {
    let tabs: Vec<(TabId, bool, String)> = state.ws.tabs.editors_mut().filter(|(_, e)| targets.iter().any(|t| e.path.starts_with(&t.path))).map(|(id, e)| (id, e.doc.is_dirty(), e.file_name())).collect();
    let clean: Vec<TabId> = tabs.iter().filter(|t| !t.1).map(|t| t.0).collect();
    reload_tabs(state, clean);
    let paths: HashSet<PathBuf> = targets.iter().filter(|t| t.is_dir).map(|t| t.path.clone()).collect();
    if !paths.is_empty() {
        state.on_fs_batch(FsBatch { paths, structure_changed: true, git_changed: false });
    }
    let dirty: Vec<(TabId, String)> = tabs.into_iter().filter(|t| t.1).map(|t| (t.0, t.2)).collect();
    if !dirty.is_empty() {
        state.ws.tree_ops.dialog = Some(Dialog::Reload { tabs: dirty.iter().map(|d| d.0).collect(), names: dirty.into_iter().map(|d| d.1).collect() });
    }
}

/// Re-reads the tabs' files on a worker and replaces their text, unsaved edits included.
fn reload_tabs(state: &mut AppState, ids: Vec<TabId>) {
    for id in ids {
        let Some(path) = state.ws.tabs.editor_mut(id).map(|e| e.path.clone()) else { continue };
        state.jobs.spawn_quiet(
            move || std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display())),
            move |state, res| match res {
                Ok(bytes) => {
                    let tracked = {
                        let Some(e) = state.ws.tabs.editor_mut(id) else { return };
                        e.doc.reload_from_bytes(&bytes);
                        e.invalidate_marks();
                        e.lsp_version.is_some()
                    };
                    if tracked {
                        crate::nav::flush_lsp(state, id);
                    }
                }
                Err(e) => state.notifications.error("Reload from Disk failed", e),
            },
        );
    }
}

fn create(state: &mut AppState) {
    let Some(Dialog::NewEntry(n)) = &mut state.ws.tree_ops.dialog else { return };
    if let Err(e) = fileops::check_new_name(&n.name) {
        n.error = Some(e);
        return;
    }
    n.busy = true;
    let (dir, name, is_dir) = (n.dir.clone(), n.name.trim().to_string(), n.is_dir);
    let generation = state.project_generation();
    state.jobs.spawn_quiet(
        move || fileops::create_entry(&dir, &name, is_dir).map(|p| (dir, p)),
        move |state, res| {
            if state.project_generation() != generation {
                return;
            }
            match res {
                Ok((dir, path)) => {
                    state.ws.tree_ops.dialog = None;
                    let mut paths: HashSet<PathBuf> = HashSet::new();
                    let mut p = Some(path.as_path());
                    while let Some(x) = p {
                        paths.insert(x.to_path_buf());
                        if x == dir {
                            break;
                        }
                        p = x.parent();
                    }
                    state.on_fs_batch(FsBatch { paths, structure_changed: true, git_changed: false });
                    if let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) {
                        state.ws.tree.reveal(&root, &path);
                    }
                    if is_dir {
                        state.ws.tree.focus_pending();
                    } else {
                        state.open_location(&path, None, true);
                    }
                }
                Err(e) => {
                    if let Some(Dialog::NewEntry(n)) = &mut state.ws.tree_ops.dialog {
                        n.busy = false;
                        n.error = Some(e);
                    }
                }
            }
        },
    );
}

// ---------------------------------------------------------------------------------------
// Dialogs

#[derive(Clone, Copy)]
enum Action {
    Close,
    Create,
    RenameNext,
    RenameApply,
    RenameBack,
    DeleteToggle,
    DeleteGo,
    MoveApply,
    Paste(Clash),
    Rollback,
    Reload,
}

/// Draws the open dialog, after the panels. Enter and Escape are read at the start, so they
/// never reach the editor behind the modal.
pub fn show_dialogs(state: &mut AppState, ctx: &Context) {
    let Some(dialog) = &mut state.ws.tree_ops.dialog else { return };
    if let Dialog::Move(MoveDialog { phase: MovePhase::Computing { since, .. }, .. }) = dialog {
        let wait = MOVE_DIALOG_DELAY - (ctx.input(|i| i.time) - *since);
        if wait > 0.0 {
            ctx.request_repaint_after(std::time::Duration::from_secs_f64(wait));
            return;
        }
    }
    let root = state.ws.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    let enter = ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, Key::Enter));
    let t = &theme::T;
    let mut action: Option<Action> = None;
    let modal = Modal::new(crate::workspace::wid("tree-dialog")).area(Modal::default_area(crate::workspace::wid("tree-dialog-area")).anchor(egui::Align2::CENTER_TOP, [0.0, 90.0])).show(ctx, |ui| {
        ui.set_width(520.0);
        match dialog {
            Dialog::NewEntry(n) => {
                ui.label(RichText::new(if n.is_dir { "New Directory" } else { "New File" }).strong());
                ui.label(RichText::new(format!("In {}", display_rel(&root, &n.dir))).color(t.text_dim).size(t.font.small));
                let edit = ui.add(TextEdit::singleline(&mut n.name).hint_text(if n.is_dir { "name or a/b/c" } else { "name.ts or a/b/c.ts" }).desired_width(f32::INFINITY));
                if std::mem::take(&mut n.focus) {
                    edit.request_focus();
                }
                if edit.changed() {
                    n.error = None;
                }
                if let Some(e) = &n.error {
                    ui.label(RichText::new(e).color(t.error));
                }
                buttons(ui, &mut action, &[("Create", !n.busy, Action::Create), ("Cancel", true, Action::Close)]);
                if enter && !n.busy {
                    action = Some(Action::Create);
                }
            }
            Dialog::Rename(r) => rename_ui(ui, r, &root, enter, &mut action),
            Dialog::Delete(d) => {
                match d.targets.as_slice() {
                    [one] => {
                        let kind = if one.is_dir { "directory" } else { "file" };
                        ui.label(RichText::new(if one.is_dir { "Delete Directory" } else { "Delete File" }).strong());
                        ui.label(format!("Move the {kind} \"{}\" to the Trash?", fileops::file_name(&one.path)));
                    }
                    many => {
                        ui.label(RichText::new(format!("Delete {} Items", many.len())).strong());
                        let names: Vec<String> = many.iter().map(|t| fileops::file_name(&t.path)).collect();
                        ui.label(format!("Move {} items to the Trash: {}?", many.len(), names.join(", ")));
                    }
                }
                let before = d.safe;
                ui.checkbox(&mut d.safe, "Search for usages (safe delete)");
                if d.safe != before {
                    action = Some(Action::DeleteToggle);
                }
                match &d.usages {
                    Usages::Off => {}
                    Usages::Searching { progress, .. } => {
                        ui.horizontal(|ui| {
                            ui.spinner();
                            ui.label(RichText::new(lock(progress).clone()).color(t.text_dim));
                        });
                    }
                    Usages::Found(refs) if refs.is_empty() => {
                        ui.label(RichText::new("No usages found.").color(t.text_dim));
                    }
                    Usages::Found(refs) => {
                        let files: HashSet<&Path> = refs.iter().map(|r| r.location.path.as_path()).collect();
                        let (n, f) = (refs.len(), files.len());
                        ui.label(RichText::new(format!("{n} {} in {f} {} still {} it:", plural(n, "usage", "usages"), plural(f, "file", "files"), plural(n, "refers to", "refer to"))).color(t.warning));
                        usage_list(ui, &root, refs, "delete-usages");
                    }
                }
                let searching = matches!(d.usages, Usages::Searching { .. });
                buttons(ui, &mut action, &[("Delete", true, Action::DeleteGo), ("Cancel", true, Action::Close)]);
                if enter && !searching {
                    action = Some(Action::DeleteGo);
                }
            }
            Dialog::Move(d) => move_ui(ui, d, &root, enter, &mut action),
            Dialog::Collision { srcs, dir, at, .. } => {
                ui.label(RichText::new("File Already Exists").strong());
                ui.label(format!("\"{}\" already exists in {}.", fileops::file_name(&srcs[*at]), display_rel(&root, dir)));
                if srcs.len() > 1 {
                    ui.label(RichText::new(format!("Item {} of {}: {}", *at + 1, srcs.len(), fileops::relative(&root, &srcs[*at]))).color(t.text_dim).size(t.font.small));
                }
                let mut items = vec![("Overwrite", true, Action::Paste(Clash::Policy(Collision::Overwrite))), ("Keep Both", true, Action::Paste(Clash::Policy(Collision::KeepBoth)))];
                if srcs.len() > 1 {
                    items.push(("Skip", true, Action::Paste(Clash::Skip)));
                }
                items.push(("Cancel", true, Action::Close));
                buttons(ui, &mut action, &items);
            }
            Dialog::Rollback { paths, files } => {
                ui.label(RichText::new("Rollback Changes").strong());
                let names: Vec<String> = paths.iter().map(|p| display_rel(&root, p)).collect();
                ui.label(format!("Roll back {} changed files in {}? Local changes are lost.", files.len(), names.join(", ")));
                ScrollArea::vertical().max_height(160.0).id_salt("rollback-files").show(ui, |ui| {
                    for f in files.iter() {
                        ui.label(RichText::new(fileops::relative(&root, f)).monospace().size(t.font.small));
                    }
                });
                buttons(ui, &mut action, &[("Rollback", true, Action::Rollback), ("Cancel", true, Action::Close)]);
                if enter {
                    action = Some(Action::Rollback);
                }
            }
            Dialog::Reload { names, .. } => {
                ui.label(RichText::new("Reload from Disk").strong());
                ui.label(format!("{} has unsaved changes. Reload from disk and lose them?", names.join(", ")));
                buttons(ui, &mut action, &[("Reload", true, Action::Reload), ("Cancel", true, Action::Close)]);
            }
        }
    });
    if action.is_none() && modal.should_close() {
        action = Some(Action::Close);
    }
    let Some(action) = action else { return };
    match action {
        Action::Close => {
            state.ws.tree_ops.cancel_running();
            state.ws.tree_ops.dialog = None;
            state.ws.tree.focus_pending();
        }
        Action::Create => create(state),
        Action::RenameNext => {
            let Some(Dialog::Rename(r)) = &mut state.ws.tree_ops.dialog else { return };
            match fileops::check_rename(&r.name) {
                Err(e) => r.error = Some(e),
                Ok(()) if r.name.trim() == fileops::file_name(&r.target.path) => {
                    state.ws.tree_ops.dialog = None;
                    state.ws.tree.focus_pending();
                }
                Ok(()) => start_rename_query(state),
            }
        }
        Action::RenameBack => {
            state.ws.tree_ops.cancel_running();
            if let Some(Dialog::Rename(r)) = &mut state.ws.tree_ops.dialog {
                r.phase = RenamePhase::Edit;
                r.focus = true;
            }
        }
        Action::RenameApply => {
            let Some(Dialog::Rename(r)) = state.ws.tree_ops.dialog.take() else { return };
            state.ws.tree.focus_pending();
            if let RenamePhase::Preview { new, result } = r.phase {
                relocate(state, r.target.path, new, result.edits, false);
            }
        }
        Action::DeleteToggle => start_delete_search(state),
        Action::DeleteGo => {
            state.ws.tree_ops.cancel_running();
            let Some(Dialog::Delete(d)) = state.ws.tree_ops.dialog.take() else { return };
            state.ws.tree.focus_pending();
            delete(state, d.targets);
        }
        Action::MoveApply => {
            let Some(Dialog::Move(d)) = state.ws.tree_ops.dialog.take() else { return };
            state.ws.tree.focus_pending();
            if let MovePhase::Preview(result) = d.phase {
                relocate_all(state, d.moves, result.edits);
            }
        }
        Action::Paste(policy) => {
            let Some(Dialog::Collision { srcs, dir, cut, mut decided, at }) = state.ws.tree_ops.dialog.take() else { return };
            state.ws.tree.focus_pending();
            decided[at] = Some(policy);
            paste(state, srcs, dir, cut, decided);
        }
        Action::Rollback => {
            let Some(Dialog::Rollback { files, .. }) = state.ws.tree_ops.dialog.take() else { return };
            state.ws.tree.focus_pending();
            let Some(repo) = state.ws.git.repo.clone() else { return };
            let f = files.clone();
            crate::git::refresh::write_started(state);
            state.jobs.spawn(
                "Rolling back",
                move || std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| repo.rollback(&f))).unwrap_or_else(|_| Err(ide_git::Error::Other("the git task panicked".into()))),
                move |state, res| {
                    if let Err(e) = res {
                        state.notifications.error("Rollback failed", e.to_string());
                    }
                    // The tree and open editors follow the disk; git status follows the write.
                    crate::git::refresh::write_done(state, crate::git::refresh::Refresh::Paths(files.clone()));
                    let paths: HashSet<PathBuf> = files.into_iter().collect();
                    state.on_fs_batch(FsBatch { paths, structure_changed: true, git_changed: false });
                },
            );
        }
        Action::Reload => {
            let Some(Dialog::Reload { tabs, .. }) = state.ws.tree_ops.dialog.take() else { return };
            state.ws.tree.focus_pending();
            reload_tabs(state, tabs);
        }
    }
}

fn rename_ui(ui: &mut Ui, r: &mut Rename, root: &Path, enter: bool, action: &mut Option<Action>) {
    let t = &theme::T;
    ui.label(RichText::new(if r.target.is_dir { "Rename Directory" } else { "Rename File" }).strong());
    match &r.phase {
        RenamePhase::Edit => {
            ui.label(RichText::new(format!("Rename {} and update its imports.", display_rel(root, &r.target.path))).color(t.text_dim).size(t.font.small));
            let edit = ui.add(TextEdit::singleline(&mut r.name).desired_width(f32::INFINITY));
            if std::mem::take(&mut r.focus) {
                edit.request_focus();
                // Select the name without the extension, like IDEA.
                let stem = if r.target.is_dir { r.name.chars().count() } else { r.name.rfind('.').filter(|i| *i > 0).map_or(r.name.chars().count(), |i| r.name[..i].chars().count()) };
                if let Some(mut st) = egui::TextEdit::load_state(ui.ctx(), edit.id) {
                    st.cursor.set_char_range(Some(egui::text::CCursorRange::two(egui::text::CCursor::new(0), egui::text::CCursor::new(stem))));
                    st.store(ui.ctx(), edit.id);
                }
            }
            if edit.changed() {
                r.error = None;
            }
            ui.checkbox(&mut r.text_occurrences, "Also list text occurrences (not changed)");
            if let Some(e) = &r.error {
                ui.label(RichText::new(e).color(t.error));
            }
            buttons(ui, action, &[("Refactor", true, Action::RenameNext), ("Cancel", true, Action::Close)]);
            if enter {
                *action = Some(Action::RenameNext);
            }
        }
        RenamePhase::Computing { progress, .. } => {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label(RichText::new(lock(progress).clone()).color(t.text_dim));
            });
            buttons(ui, action, &[("Cancel", true, Action::RenameBack)]);
        }
        RenamePhase::Preview { new, result } => {
            let n = result.edit_count();
            let files = result.edits.len();
            let to = fileops::file_name(new);
            ui.label(RichText::new(format!("Rename to \"{to}\" and update {n} {} in {files} {}", plural(n, "import", "imports"), plural(files, "file", "files"))).color(t.text_bright));
            let mut stats = format!("Scanned {} code files: {} candidates", result.scanned, result.candidates);
            if result.projects > 0 {
                stats.push_str(&format!(", {} projects loaded", result.projects));
            }
            ui.label(RichText::new(stats).color(t.text_dim).size(t.font.small));
            ScrollArea::vertical().max_height(200.0).id_salt("rename-files").show(ui, |ui| {
                for f in &result.edits {
                    ui.label(RichText::new(format!("{}  ({})", fileops::relative(root, &f.path), f.edits.len())).monospace().size(t.font.small));
                }
            });
            if !result.text_hits.is_empty() {
                ui.label(RichText::new(format!("{} text occurrences (not changed):", result.text_hits.len())).color(t.text_dim));
                usage_list(ui, root, &result.text_hits, "rename-text");
            }
            for e in &result.errors {
                ui.label(RichText::new(e).color(t.warning).size(t.font.small));
            }
            buttons(ui, action, &[("Rename", true, Action::RenameApply), ("Back", true, Action::RenameBack), ("Cancel", true, Action::Close)]);
            if enter {
                *action = Some(Action::RenameApply);
            }
        }
    }
}

/// The move preview: "Move N items to <dir> and update N imports in M files", Move / Cancel.
fn move_ui(ui: &mut Ui, d: &MoveDialog, root: &Path, enter: bool, action: &mut Option<Action>) {
    let t = &theme::T;
    let what = match d.moves.as_slice() {
        [one] => format!("\"{}\"", fileops::file_name(&one.src)),
        many => format!("{} items", many.len()),
    };
    ui.label(RichText::new("Move and Update Imports").strong());
    match &d.phase {
        MovePhase::Computing { progress, .. } => {
            ui.label(RichText::new(format!("Move {what} to {}", display_rel(root, &d.dir))).color(t.text_dim).size(t.font.small));
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label(RichText::new(lock(progress).clone()).color(t.text_dim));
            });
            buttons(ui, action, &[("Cancel", true, Action::Close)]);
        }
        MovePhase::Preview(result) => {
            let n = result.edit_count();
            let files = result.edits.len();
            ui.label(RichText::new(format!("Move {what} to {} and update {n} {} in {files} {}", display_rel(root, &d.dir), plural(n, "import", "imports"), plural(files, "file", "files"))).color(t.text_bright));
            if d.moves.len() > 1 {
                let names: Vec<String> = d.moves.iter().map(|m| fileops::relative(root, &m.src)).collect();
                ui.label(RichText::new(names.join(", ")).color(t.text_dim).size(t.font.small));
            }
            let mut stats = format!("Scanned {} code files: {} candidates", result.scanned, result.candidates);
            if result.projects > 0 {
                stats.push_str(&format!(", {} projects loaded", result.projects));
            }
            ui.label(RichText::new(stats).color(t.text_dim).size(t.font.small));
            ScrollArea::vertical().max_height(200.0).id_salt("move-files").show(ui, |ui| {
                for f in &result.edits {
                    ui.label(RichText::new(format!("{}  ({})", fileops::relative(root, &f.path), f.edits.len())).monospace().size(t.font.small));
                }
            });
            for e in &result.errors {
                ui.label(RichText::new(e).color(t.warning).size(t.font.small));
            }
            buttons(ui, action, &[("Move", true, Action::MoveApply), ("Cancel", true, Action::Close)]);
            if enter {
                *action = Some(Action::MoveApply);
            }
        }
    }
}

fn plural<'a>(n: usize, one: &'a str, many: &'a str) -> &'a str {
    if n == 1 {
        one
    } else {
        many
    }
}

fn display_rel(root: &Path, p: &Path) -> String {
    if p == root {
        return root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    }
    fileops::relative(root, p)
}

fn usage_list(ui: &mut Ui, root: &Path, refs: &[Reference], salt: &str) {
    let t = &theme::T;
    ScrollArea::vertical().max_height(180.0).id_salt(salt).show(ui, |ui| {
        for r in refs {
            let text = format!("{}:{}  {}", fileops::relative(root, &r.location.path), r.location.line + 1, r.line_text.trim());
            ui.add(egui::Label::new(RichText::new(text).monospace().size(t.font.small)).truncate());
        }
    });
}

fn buttons(ui: &mut Ui, action: &mut Option<Action>, items: &[(&str, bool, Action)]) {
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        for (label, enabled, a) in items {
            if ui.add_enabled(*enabled, egui::Button::new(*label)).clicked() {
                *action = Some(*a);
            }
        }
    });
}
