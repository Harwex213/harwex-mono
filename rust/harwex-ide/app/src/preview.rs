//! Editable code preview shared by the Find in Files popup and the Find tool window.
//!
//! A preview shows one file around a result: the match is selected and its line is the caret
//! line. The text is editable, like IDEA's preview:
//! - The file is open in an editor tab: the preview edits that tab's `Document` (through its own
//!   `EditorState`, so scroll and carets stay separate). Undo is the tab's undo.
//! - The file is not open: the preview loads a hidden `Document` on a worker and edits it.
//!
//! Both are saved on a short debounce after the last preview edit, or at once when the preview
//! loses the focus (IDEA auto-saves). `tick` must run every frame for each preview (the Find
//! window calls it from `AppState::tick_workspaces`), so a pending save also lands while the
//! preview is not drawn.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::{Duration, Instant};

use egui::{vec2, Rect, RichText, Sense, Ui, UiBuilder};
use ide_editor::{Document, EditorState, EditorView, Position};

use crate::state::AppState;
use crate::tabs::TabId;
use crate::theme::T;

/// How long the preview waits after its last edit before it saves.
pub const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);

/// One preview pane. Keep one per place that shows a preview (popup, each Find tab).
pub struct FilePreview {
    pub path: Option<PathBuf>,
    /// 0-based line to center and mark.
    pub line: usize,
    /// Char columns of the match on `line` to highlight.
    pub highlight: Option<(usize, usize)>,
    view: EditorState,
    /// Which document `view` was last drawn with; a change starts a fresh `EditorState`.
    source: Source,
    /// The file when it is not open in a tab.
    hidden: Option<Hidden>,
    /// The path a worker is loading.
    loading: Option<PathBuf>,
    /// A load failed; shown instead of the code.
    error: Option<(PathBuf, String)>,
    /// `show_match` moved the target: reveal it on the next draw.
    target_dirty: bool,
    /// The match selection, applied one frame after the reveal (a reveal resets the carets).
    pending_select: Option<(Position, Position)>,
    /// The preview made an edit that is not saved yet.
    edited_at: Option<Instant>,
    had_focus: bool,
    tx: Sender<Msg>,
    rx: Receiver<Msg>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Source {
    None,
    Tab(TabId),
    Hidden(PathBuf),
}

struct Hidden {
    path: PathBuf,
    doc: Document,
    saving: bool,
}

enum Msg {
    Loaded(PathBuf, Result<Box<Document>, String>),
    Saved(PathBuf, u64),
}

impl Default for FilePreview {
    fn default() -> Self {
        let (tx, rx) = channel();
        FilePreview {
            path: None,
            line: 0,
            highlight: None,
            view: EditorState::new(),
            source: Source::None,
            hidden: None,
            loading: None,
            error: None,
            target_dirty: false,
            pending_select: None,
            edited_at: None,
            had_focus: false,
            tx,
            rx,
        }
    }
}

impl FilePreview {
    /// Point the preview at a match. Loading happens on a worker; the UI never waits. Calling
    /// it again with the same target changes nothing, so a caller may call it every frame.
    pub fn show_match(&mut self, path: PathBuf, line: usize, highlight: Option<(usize, usize)>) {
        if self.path.as_ref() == Some(&path) && self.line == line && self.highlight == highlight {
            return;
        }
        self.path = Some(path);
        self.line = line;
        self.highlight = highlight;
        self.target_dirty = true;
        self.pending_select = None;
    }

    /// Shows nothing (no result selected).
    pub fn clear(&mut self) {
        self.path = None;
        self.target_dirty = false;
        self.pending_select = None;
    }

    /// A load or a save is in flight or due. Part of `AppState::is_idle`.
    pub fn is_pending(&self) -> bool {
        self.loading.is_some()
            || self.edited_at.is_some()
            || self.hidden.as_ref().is_some_and(|h| h.saving)
    }

    /// The hidden document of a file that is not open in a tab (tests read it).
    pub fn hidden_doc(&self) -> Option<&Document> {
        self.hidden.as_ref().map(|h| &h.doc)
    }

    /// The preview's view state (tests read the caret and the selection).
    pub fn view(&self) -> &EditorState {
        &self.view
    }

    /// Puts the keyboard focus into the preview's editor on the next frame.
    pub fn request_focus(&mut self) {
        self.view.request_focus();
    }
}

/// Applies worker results and saves a due edit. Call every frame, drawn or not.
pub fn tick(state: &mut AppState, preview: &mut FilePreview) {
    while let Ok(msg) = preview.rx.try_recv() {
        match msg {
            Msg::Loaded(path, result) => {
                if preview.loading.as_ref() != Some(&path) {
                    continue;
                }
                preview.loading = None;
                match result {
                    Ok(doc) => {
                        preview.error = None;
                        preview.hidden = Some(Hidden {
                            path,
                            doc: *doc,
                            saving: false,
                        });
                    }
                    Err(e) => preview.error = Some((path, e)),
                }
                state.ctx.request_repaint();
            }
            Msg::Saved(path, token) => {
                if let Some(h) = preview.hidden.as_mut().filter(|h| h.path == path) {
                    h.saving = false;
                    h.doc.mark_saved(token);
                }
            }
        }
    }
    if let Some(at) = preview.edited_at {
        let rest = at.elapsed();
        if rest >= SAVE_DEBOUNCE {
            flush(state, preview);
        } else {
            state.ctx.request_repaint_after(SAVE_DEBOUNCE - rest);
        }
    }
}

/// Saves the preview's unsaved edits now (focus left, the preview closes or moves on).
pub fn flush(state: &mut AppState, preview: &mut FilePreview) {
    if preview.edited_at.take().is_none() {
        return;
    }
    match preview.source.clone() {
        Source::Tab(id) => state.save_tab(id, false),
        Source::Hidden(_) => save_hidden(state, preview),
        Source::None => {}
    }
}

fn save_hidden(state: &mut AppState, preview: &mut FilePreview) {
    let Some(h) = preview.hidden.as_mut() else {
        return;
    };
    if !h.doc.is_dirty() || crate::lang::is_library_path(&h.path) {
        return;
    }
    h.saving = true;
    let (text, token) = h.doc.save_snapshot();
    let path = h.path.clone();
    let tx = preview.tx.clone();
    state.jobs.spawn_quiet(
        move || {
            let res = std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()));
            // The receiver may be gone (the preview closed); the file is written either way.
            let _ = tx.send(Msg::Saved(path.clone(), token));
            (path, res)
        },
        |state, (path, res)| match res {
            Ok(()) => {
                // No watcher in tests, and the watcher is slow: refresh status and gutters now.
                let paths = std::iter::once(path).collect();
                state.on_fs_batch(crate::watcher::FsBatch {
                    paths,
                    structure_changed: false,
                    git_changed: true,
                });
            }
            Err(e) => state.notifications.error("Save failed", e),
        },
    );
}

/// Draws the preview (file name + path header, editable code) into `ui`'s rect.
pub fn show(state: &mut AppState, preview: &mut FilePreview, ui: &mut Ui) {
    tick(state, preview);
    let full = ui.available_rect_before_wrap();
    ui.allocate_rect(full, Sense::hover());
    let Some(path) = preview.path.clone() else {
        attach(state, preview, Source::None);
        hint(ui, full, "Select a result to preview");
        return;
    };
    let source = match state.ws.tabs.editor_by_path(&path) {
        Some(id) => Source::Tab(id),
        None => {
            if preview.hidden.as_ref().is_none_or(|h| h.path != path) {
                start_load(state, preview, &path);
            }
            if preview.hidden.is_some() {
                Source::Hidden(path.clone())
            } else {
                Source::None
            }
        }
    };
    attach(state, preview, source);

    let header_h = T.space.row_h + 4.0;
    let header = Rect::from_min_size(full.min, vec2(full.width(), header_h));
    paint_header(state, ui, header, &path);
    let body = Rect::from_min_max(header.left_bottom() + vec2(0.0, 2.0), full.max);
    if preview.source == Source::None {
        match &preview.error {
            Some((p, e)) if *p == path => hint(ui, body, &format!("Cannot open: {e}")),
            _ => hint(ui, body, "Loading..."),
        }
        return;
    }
    if std::mem::take(&mut preview.target_dirty) {
        let start = preview.highlight.map_or(0, |h| h.0);
        preview.view.reveal(Position::new(preview.line, start));
        preview.pending_select = preview.highlight.map(|(s, e)| {
            (
                Position::new(preview.line, s),
                Position::new(preview.line, e),
            )
        });
        ui.ctx().request_repaint();
    } else if let Some((a, h)) = preview.pending_select.take() {
        preview.view.set_selection(a, h);
        ui.ctx().request_repaint();
    }

    let read_only = crate::lang::is_library_path(&path);
    let AppState {
        ws, editor_theme, ..
    } = &mut *state;
    let mut child = ui.new_child(UiBuilder::new().max_rect(body).id_salt("preview-editor"));
    child.set_clip_rect(body.intersect(ui.clip_rect()));
    let (changed, has_focus) = match &preview.source {
        Source::Tab(id) => {
            let Some(e) = ws.tabs.editor_mut(*id) else {
                return;
            };
            let r = EditorView::new(&mut e.doc, &mut preview.view)
                .problems(&e.problems.marks)
                .theme(editor_theme)
                .read_only(read_only || e.read_only)
                .show(&mut child);
            if r.changed {
                e.last_edit = Instant::now();
                e.problems.refresh(&e.doc);
            }
            (r.changed, r.has_focus)
        }
        Source::Hidden(_) => {
            let Some(h) = preview.hidden.as_mut() else {
                return;
            };
            let r = EditorView::new(&mut h.doc, &mut preview.view)
                .theme(editor_theme)
                .read_only(read_only)
                .show(&mut child);
            (r.changed, r.has_focus)
        }
        Source::None => return,
    };
    if changed {
        preview.edited_at = Some(Instant::now());
        state.ctx.request_repaint_after(SAVE_DEBOUNCE);
    }
    if preview.had_focus && !has_focus {
        flush(state, preview);
    }
    preview.had_focus = has_focus;
}

/// Switches the view to another document. A fresh `EditorState` keeps one document's caches
/// (highlights are keyed by doc version) away from the other's.
fn attach(state: &mut AppState, preview: &mut FilePreview, source: Source) {
    if preview.source == source {
        return;
    }
    flush(state, preview);
    if let Source::Tab(_) = source {
        // The tab owns the text now; a hidden copy would go stale. Its edits were saved above.
        preview.hidden = None;
    }
    preview.view = EditorState::new();
    preview.source = source;
    preview.had_focus = false;
    preview.target_dirty = preview.path.is_some();
    preview.pending_select = None;
}

fn start_load(state: &mut AppState, preview: &mut FilePreview, path: &Path) {
    if preview.loading.as_deref() == Some(path)
        || preview.error.as_ref().is_some_and(|(p, _)| p == path)
    {
        return;
    }
    if preview.hidden.as_ref().is_some_and(|h| h.path != path) {
        // Leaving a file: its last edits go to disk first.
        flush(state, preview);
        if preview.hidden.as_ref().is_some_and(|h| !h.saving) {
            preview.hidden = None;
        }
    }
    preview.loading = Some(path.to_path_buf());
    let tx = preview.tx.clone();
    let path = path.to_path_buf();
    state.jobs.spawn_quiet(
        move || {
            let doc = Document::open(&path)
                .map(Box::new)
                .map_err(|e| e.to_string());
            let _ = tx.send(Msg::Loaded(path, doc));
        },
        |_, ()| {},
    );
}

fn paint_header(state: &AppState, ui: &mut Ui, rect: Rect, path: &Path) {
    let t = &T;
    let root = state
        .ws
        .project
        .as_ref()
        .map(|p| p.root.clone())
        .unwrap_or_default();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let rel = crate::nav::display_path(&root, path);
    let dir = rel
        .rsplit_once('/')
        .map(|(d, _)| d.to_string())
        .unwrap_or_default();
    let painter = ui.painter_at(rect);
    let icon_c = rect.left_center() + vec2(12.0, 0.0);
    crate::icons::file(&painter, icon_c, t.space.icon, &name);
    let name_g = painter.layout_no_wrap(
        name.clone(),
        egui::FontId::proportional(t.font.ui),
        t.text_bright,
    );
    let x = icon_c.x + 12.0;
    painter.galley(
        egui::pos2(x, rect.center().y - name_g.size().y / 2.0),
        name_g.clone(),
        t.text_bright,
    );
    if !dir.is_empty() {
        let dir_g =
            painter.layout_no_wrap(dir, egui::FontId::proportional(t.font.small), t.text_dim);
        painter.galley(
            egui::pos2(
                x + name_g.size().x + 8.0,
                rect.center().y - dir_g.size().y / 2.0,
            ),
            dir_g,
            t.text_dim,
        );
    }
    let resp = ui.interact(
        rect,
        crate::workspace::wid(("preview-header", path)),
        Sense::hover(),
    );
    crate::util::label_widget(&resp, egui::WidgetType::Label, format!("Preview {rel}"));
}

fn hint(ui: &mut Ui, rect: Rect, text: &str) {
    let mut child = ui.new_child(UiBuilder::new().max_rect(rect.shrink(8.0)));
    child.label(RichText::new(text).color(T.text_dim));
}
