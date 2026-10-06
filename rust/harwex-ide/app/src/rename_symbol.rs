//! Rename Symbol (Shift+F6 in an editor, like IDEA): the language server computes the edits,
//! and a dialog shows them before anything changes. Open documents get one undo step each and
//! are saved; closed files are edited on disk on workers. Languages whose server has no rename
//! answer with a reason (`LanguageServer::rename_symbol`).

use std::collections::HashSet;
use std::path::PathBuf;

use egui::{Context, Key, Modal, RichText, ScrollArea, TextEdit};
use ide_editor::Position;

use crate::lang::{FileEdit, LangId};
use crate::notifications::Level;
use crate::state::AppState;
use crate::tabs::TabId;
use crate::theme;
use crate::watcher::FsBatch;

pub enum Phase {
    Edit,
    Computing { generation: u64 },
    Preview { edits: Vec<FileEdit> },
}

pub struct RenameSymbol {
    pub path: PathBuf,
    pub pos: Position,
    pub lang: LangId,
    /// The name under the caret when the dialog opened.
    pub old: String,
    pub name: String,
    pub error: Option<String>,
    pub phase: Phase,
    focus: bool,
    generation: u64,
}

impl RenameSymbol {
    /// Every edit of the preview.
    pub fn edit_count(&self) -> usize {
        match &self.phase {
            Phase::Preview { edits } => edits.iter().map(|f| f.edits.len()).sum(),
            _ => 0,
        }
    }
}

/// Opens the dialog for the symbol at `pos` of an editor tab.
pub fn start(state: &mut AppState, tab: TabId, pos: Position) {
    if state.ws.langs.is_off() {
        return;
    }
    let Some(e) = state.ws.tabs.editor_mut(tab) else { return };
    if e.read_only {
        return;
    }
    let lang = match (e.lang, state.ws.langs.lang_for(&e.path)) {
        (Some(lang), _) | (None, Ok(lang)) => lang,
        (None, Err(why)) => {
            state.notifications.warn("Rename Symbol", why);
            return;
        }
    };
    let Some(word) = e.doc.word_at(pos) else {
        state.notifications.info("Rename Symbol", "Put the caret on a name to rename it.");
        return;
    };
    let old = e.doc.slice(e.doc.position_to_char(word.start)..e.doc.position_to_char(word.end));
    let path = e.path.clone();
    let generation = state.ws.nav.rename.as_ref().map_or(0, |r| r.generation) + 1;
    state.ws.nav.rename = Some(RenameSymbol { path, pos: word.start, lang, name: old.clone(), old, error: None, phase: Phase::Edit, focus: true, generation });
}

#[derive(Clone, Copy)]
enum Action {
    Next,
    Back,
    Apply,
    Close,
}

/// Draws the dialog while one is open.
pub fn show(state: &mut AppState, ctx: &Context) {
    let Some(r) = &mut state.ws.nav.rename else { return };
    let root = state.ws.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    let enter = ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, Key::Enter));
    let t = &theme::T;
    let mut action: Option<Action> = None;
    let modal = Modal::new(crate::workspace::wid("rename-symbol")).area(Modal::default_area(crate::workspace::wid("rename-symbol-area")).anchor(egui::Align2::CENTER_TOP, [0.0, 90.0])).show(ctx, |ui| {
        ui.set_width(520.0);
        ui.label(RichText::new("Rename Symbol").strong());
        match &r.phase {
            Phase::Edit => {
                ui.label(RichText::new(format!("Rename `{}` and every reference to it.", r.old)).color(t.text_dim).size(t.font.small));
                let edit = ui.add(TextEdit::singleline(&mut r.name).desired_width(f32::INFINITY));
                if std::mem::take(&mut r.focus) {
                    edit.request_focus();
                    if let Some(mut st) = egui::TextEdit::load_state(ui.ctx(), edit.id) {
                        let all = r.name.chars().count();
                        st.cursor.set_char_range(Some(egui::text::CCursorRange::two(egui::text::CCursor::new(0), egui::text::CCursor::new(all))));
                        st.store(ui.ctx(), edit.id);
                    }
                }
                if edit.changed() {
                    r.error = None;
                }
                if let Some(e) = &r.error {
                    ui.label(RichText::new(e).color(t.error));
                }
                buttons(ui, &mut action, &[("Refactor", Action::Next), ("Cancel", Action::Close)]);
                if enter {
                    action = Some(Action::Next);
                }
            }
            Phase::Computing { .. } => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label(RichText::new(format!("Looking for references to `{}`…", r.old)).color(t.text_dim));
                });
                buttons(ui, &mut action, &[("Cancel", Action::Back)]);
            }
            Phase::Preview { edits } => {
                let n: usize = edits.iter().map(|f| f.edits.len()).sum();
                let files = edits.len();
                ui.label(RichText::new(format!("Rename `{}` to `{}`: {n} {} in {files} {}", r.old, r.name.trim(), plural(n, "occurrence", "occurrences"), plural(files, "file", "files"))).color(t.text_bright));
                ScrollArea::vertical().max_height(200.0).id_salt("rename-symbol-files").show(ui, |ui| {
                    for f in edits {
                        ui.label(RichText::new(format!("{}  ({})", crate::nav::display_path(&root, &f.path), f.edits.len())).monospace().size(t.font.small));
                    }
                });
                buttons(ui, &mut action, &[("Rename", Action::Apply), ("Back", Action::Back), ("Cancel", Action::Close)]);
                if enter {
                    action = Some(Action::Apply);
                }
            }
        }
    });
    if action.is_none() && modal.should_close() {
        action = Some(Action::Close);
    }
    let Some(action) = action else { return };
    match action {
        Action::Close => close(state),
        Action::Back => {
            if let Some(r) = &mut state.ws.nav.rename {
                r.generation += 1;
                r.phase = Phase::Edit;
                r.focus = true;
            }
        }
        Action::Next => compute(state),
        Action::Apply => {
            let Some(r) = state.ws.nav.rename.take() else { return };
            if let Phase::Preview { edits } = r.phase {
                apply(state, &r.old, r.name.trim(), edits);
            }
            refocus(state, &r.path);
        }
    }
}

fn close(state: &mut AppState) {
    if let Some(r) = state.ws.nav.rename.take() {
        refocus(state, &r.path);
    }
}

fn refocus(state: &mut AppState, path: &std::path::Path) {
    if let Some(id) = state.ws.tabs.editor_by_path(path) {
        if let Some(e) = state.ws.tabs.editor_mut(id) {
            e.view.request_focus();
        }
    }
}

/// Asks the language server for the edits of the typed name.
fn compute(state: &mut AppState) {
    let Some(r) = &mut state.ws.nav.rename else { return };
    let name = r.name.trim().to_string();
    if name.is_empty() || name.chars().any(char::is_whitespace) {
        r.error = Some("Enter a name without spaces.".into());
        return;
    }
    if name == r.old {
        close(state);
        return;
    }
    r.generation += 1;
    let generation = r.generation;
    r.phase = Phase::Computing { generation };
    let (path, pos, lang) = (r.path.clone(), r.pos, r.lang);
    if let Some(id) = state.ws.tabs.editor_by_path(&path) {
        crate::nav::flush_lsp(state, id);
    }
    let jobs = state.jobs.clone();
    state.ws.langs.bridge(lang).run(move |server| {
        let _busy = jobs.busy(format!("Rename Symbol: {name}"));
        let result = server.rename_symbol(&path, pos.line, pos.column, &name);
        jobs.post(move |state| {
            let Some(r) = &mut state.ws.nav.rename else { return };
            if r.generation != generation {
                return;
            }
            match result {
                Ok(edits) if edits.iter().all(|f| f.edits.is_empty()) => {
                    r.phase = Phase::Edit;
                    r.error = Some("The server found nothing to rename here.".into());
                }
                Ok(mut edits) => {
                    edits.retain(|f| !f.edits.is_empty());
                    edits.sort_by(|a, b| a.path.cmp(&b.path));
                    r.phase = Phase::Preview { edits };
                }
                Err(e) => {
                    r.phase = Phase::Edit;
                    r.focus = true;
                    r.error = Some(e);
                }
            }
        });
    });
}

/// Applies the edits: open documents through the edit API (one undo step each, then saved),
/// closed files on disk on workers.
fn apply(state: &mut AppState, old: &str, new: &str, edits: Vec<FileEdit>) {
    let (open, closed): (Vec<FileEdit>, Vec<FileEdit>) = edits.into_iter().partition(|f| state.ws.tabs.editor_by_path(&f.path).is_some());
    let mut count = 0;
    for f in &open {
        if let Some(id) = state.ws.tabs.editor_by_path(&f.path) {
            count += f.edits.len();
            crate::tree_menu::apply_to_tab(state, id, &f.edits);
            state.save_tab(id, false);
        }
    }
    let files = open.len() + closed.len();
    let closed_count: usize = closed.iter().map(|f| f.edits.len()).sum();
    let what = format!("Renamed {old} to {new}");
    let generation = state.project_generation();
    state.jobs.spawn(
        format!("Renaming {old}"),
        move || {
            let errors = crate::tree_menu::apply_closed(&closed);
            (closed.into_iter().map(|f| f.path).collect::<Vec<PathBuf>>(), errors)
        },
        move |state, (paths, errors)| {
            if state.project_generation() != generation {
                return;
            }
            let paths: HashSet<PathBuf> = paths.into_iter().collect();
            state.on_fs_batch(FsBatch { paths, structure_changed: false, git_changed: false });
            for e in &errors {
                state.notifications.error("Rename failed", e.clone());
            }
            state.notifications.log_only(Level::Info, what, format!("Updated {} occurrences in {files} files.", count + closed_count));
        },
    );
}

fn buttons(ui: &mut egui::Ui, action: &mut Option<Action>, items: &[(&str, Action)]) {
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        for (label, a) in items {
            if ui.button(*label).clicked() {
                *action = Some(*a);
            }
        }
    });
}

fn plural<'a>(n: usize, one: &'a str, many: &'a str) -> &'a str {
    if n == 1 {
        one
    } else {
        many
    }
}
