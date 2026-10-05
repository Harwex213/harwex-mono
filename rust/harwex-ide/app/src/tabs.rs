//! Editor tabs and custom (non-editor) tabs such as the diff viewer.
//!
//! Editor tabs are keyed by canonical path, because tsserver reports canonical paths and a
//! symlinked workspace package would otherwise open twice.

use std::any::Any;
use std::path::{Path, PathBuf};
use std::time::Instant;

use std::collections::HashMap;

use egui::{CursorIcon, Rect, Sense, Ui, Vec2};
use ide_editor::{Document, EditorState, GutterMark, Position, ViewState};

use crate::state::TabEnv;
use crate::icons::{self, Icon};
use crate::theme;

pub type TabId = u64;

pub struct EditorTab {
    /// Canonical path; the tab's identity.
    pub path: PathBuf,
    pub doc: Document,
    pub view: EditorState,
    /// Git change bars, recomputed on a worker after edits.
    pub marks: Vec<(usize, GutterMark)>,
    /// Per-line annotation column (git blame). Empty hides it. Owned by the Git UI.
    pub annotations: Vec<String>,
    /// The file is a dependency source (`node_modules`, the Cargo registry, `rust-src`). The
    /// editor ignores edits and the tab shows a lock.
    pub read_only: bool,
    /// Doc version the gutter marks were last requested for. `None` forces a recompute.
    pub(crate) marks_for: Option<u64>,
    pub(crate) marks_in_flight: bool,
    /// The language server that tracks this file. `None` for plain files and disabled languages.
    pub lang: Option<crate::lang::LangId>,
    /// Doc version the language server has seen.
    pub(crate) lsp_version: Option<u64>,
    pub(crate) last_edit: Instant,
    pub(crate) saving: bool,
    /// Errors and warnings from the TS server and the linters.
    pub problems: crate::diagnostics::FileProblems,
}

impl EditorTab {
    pub fn new(path: PathBuf, doc: Document) -> EditorTab {
        let read_only = crate::lang::is_library_path(&path);
        let mut view = EditorState::new();
        view.set_soft_wrap(ide_editor::wrap::default_for(&path, doc.language()));
        EditorTab {
            path,
            doc,
            view,
            marks: Vec::new(),
            annotations: Vec::new(),
            read_only,
            marks_for: None,
            marks_in_flight: false,
            lang: None,
            lsp_version: None,
            last_edit: Instant::now(),
            saving: false,
            problems: Default::default(),
        }
    }

    /// Forces the gutter bars to be recomputed, e.g. after a commit or rollback.
    pub fn invalidate_marks(&mut self) {
        self.marks_for = None;
    }

    pub fn file_name(&self) -> String {
        self.path.file_name().map_or_else(|| self.path.display().to_string(), |n| n.to_string_lossy().into_owned())
    }
}

/// A tab that is not a text editor: the diff viewer, a commit view, a merge view.
///
/// Results of background jobs reach a custom tab through `Tabs::custom_mut::<T>(key)` inside a
/// `Jobs` callback, or through the tab's own channel polled in `ui`.
pub trait CustomTab: Any {
    /// Unique key. Opening a tab with a key that is already open activates the existing one.
    fn key(&self) -> String;
    fn title(&self) -> String;
    fn tooltip(&self) -> String {
        self.title()
    }
    fn ui(&mut self, ui: &mut Ui, env: &mut TabEnv);
    fn is_dirty(&self) -> bool {
        false
    }
    /// The absolute path of the file the tab shows, for the status bar breadcrumbs.
    fn file_path(&self) -> Option<PathBuf> {
        None
    }
    /// Called once when the tab closes.
    fn on_close(&mut self, _env: &mut TabEnv) {}
    #[allow(dead_code)] // Extension surface for the Git UI phase.
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

pub enum TabContent {
    Editor(Box<EditorTab>),
    Custom(Box<dyn CustomTab>),
}

pub struct Tab {
    pub id: TabId,
    pub content: TabContent,
}

impl Tab {
    pub fn title(&self) -> String {
        match &self.content {
            TabContent::Editor(e) => e.file_name(),
            TabContent::Custom(c) => c.title(),
        }
    }

    pub fn is_dirty(&self) -> bool {
        match &self.content {
            TabContent::Editor(e) => e.doc.is_dirty(),
            TabContent::Custom(c) => c.is_dirty(),
        }
    }

    /// The file the tab shows: the editor's path or a custom tab's `file_path`.
    pub fn file_path(&self) -> Option<PathBuf> {
        match &self.content {
            TabContent::Editor(e) => Some(e.path.clone()),
            TabContent::Custom(c) => c.file_path(),
        }
    }

    pub fn editor(&self) -> Option<&EditorTab> {
        match &self.content {
            TabContent::Editor(e) => Some(e),
            TabContent::Custom(_) => None,
        }
    }

    pub fn editor_mut(&mut self) -> Option<&mut EditorTab> {
        match &mut self.content {
            TabContent::Editor(e) => Some(e),
            TabContent::Custom(_) => None,
        }
    }
}

/// How many closed editor tabs Cmd+Shift+T can bring back.
pub const CLOSED_HISTORY: usize = 20;

/// An editor tab that was closed, for Cmd+Shift+T.
#[derive(Clone, Debug, PartialEq)]
pub struct ClosedTab {
    pub path: PathBuf,
    pub caret: Position,
    /// Where the tab was scrolled; `None` when it closed before its first frame.
    pub view: Option<ViewState>,
    /// The tab's index in the strip when it closed.
    pub index: usize,
}

#[derive(Default)]
pub struct Tabs {
    pub list: Vec<Tab>,
    pub active: Option<TabId>,
    /// Most recently used first; closing a tab activates the previous one, like IDEA.
    mru: Vec<TabId>,
    next_id: TabId,
    /// Closed editor tabs, oldest first. Custom tabs (diffs, merges) are not kept: they need
    /// the job that built them.
    closed: Vec<ClosedTab>,
    /// Strip indexes and scroll positions for files that Cmd+Shift+T is opening; `add` puts
    /// the tab back there.
    reopen_at: HashMap<PathBuf, (usize, Option<ViewState>)>,
}

pub enum TabBarEvent {
    Activate(TabId),
    Close(TabId),
}

impl Tabs {
    pub fn add(&mut self, mut content: TabContent) -> TabId {
        self.next_id += 1;
        let id = self.next_id;
        let reopened = match &mut content {
            TabContent::Editor(e) => self.reopen_at.remove(&e.path).map(|(i, view)| {
                if let Some(v) = view {
                    e.view.restore_view(v);
                }
                i
            }),
            TabContent::Custom(_) => None,
        };
        // New tabs open right after the active one, like IDEA. A reopened tab goes back to
        // its old place.
        let at = reopened.map(|i| i.min(self.list.len())).unwrap_or_else(|| self.active.and_then(|a| self.index(a)).map_or(self.list.len(), |i| i + 1));
        self.list.insert(at, Tab { id, content });
        self.activate(id);
        id
    }

    /// Opens a custom tab, or activates the open tab with the same key.
    pub fn open_custom(&mut self, tab: Box<dyn CustomTab>) -> TabId {
        let key = tab.key();
        if let Some(id) = self.custom_by_key(&key) {
            self.activate(id);
            return id;
        }
        self.add(TabContent::Custom(tab))
    }

    pub fn custom_by_key(&self, key: &str) -> Option<TabId> {
        self.list.iter().find_map(|t| match &t.content {
            TabContent::Custom(c) if c.key() == key => Some(t.id),
            _ => None,
        })
    }

    /// Typed access to a custom tab, for job callbacks that deliver results to it.
    #[allow(dead_code)] // Extension surface for the Git UI phase.
    pub fn custom_mut<T: CustomTab>(&mut self, key: &str) -> Option<&mut T> {
        self.list.iter_mut().find_map(|t| match &mut t.content {
            TabContent::Custom(c) if c.key() == key => c.as_any_mut().downcast_mut::<T>(),
            _ => None,
        })
    }

    pub fn activate(&mut self, id: TabId) {
        if self.index(id).is_some() {
            self.active = Some(id);
            self.mru.retain(|&t| t != id);
            self.mru.insert(0, id);
        }
    }

    pub fn index(&self, id: TabId) -> Option<usize> {
        self.list.iter().position(|t| t.id == id)
    }

    pub fn get(&self, id: TabId) -> Option<&Tab> {
        self.list.iter().find(|t| t.id == id)
    }

    pub fn get_mut(&mut self, id: TabId) -> Option<&mut Tab> {
        self.list.iter_mut().find(|t| t.id == id)
    }

    pub fn remove(&mut self, id: TabId) -> Option<Tab> {
        let i = self.index(id)?;
        let tab = self.list.remove(i);
        if let Some(e) = tab.editor() {
            self.closed.retain(|c| c.path != e.path);
            if self.closed.len() == CLOSED_HISTORY {
                self.closed.remove(0);
            }
            self.closed.push(ClosedTab { path: e.path.clone(), caret: e.view.cursor(), view: e.view.view_state(&e.doc), index: i });
        }
        self.mru.retain(|&t| t != id);
        if self.active == Some(id) {
            self.active = self.mru.first().copied();
        }
        Some(tab)
    }

    /// Closed editor tabs, oldest first.
    pub fn closed(&self) -> &[ClosedTab] {
        &self.closed
    }

    /// Takes the most recently closed tab whose file is not open again.
    fn pop_closed(&mut self) -> Option<ClosedTab> {
        while let Some(c) = self.closed.pop() {
            if self.editor_by_path(&c.path).is_none() {
                return Some(c);
            }
        }
        None
    }

    pub fn editor_by_path(&self, path: &Path) -> Option<TabId> {
        self.list.iter().find(|t| t.editor().is_some_and(|e| e.path == path)).map(|t| t.id)
    }

    pub fn editor_mut(&mut self, id: TabId) -> Option<&mut EditorTab> {
        self.get_mut(id).and_then(|t| t.editor_mut())
    }

    pub fn active_tab(&self) -> Option<&Tab> {
        self.active.and_then(|id| self.get(id))
    }

    pub fn active_editor(&self) -> Option<&EditorTab> {
        self.active_tab().and_then(|t| t.editor())
    }

    pub fn active_editor_mut(&mut self) -> Option<&mut EditorTab> {
        let id = self.active?;
        self.editor_mut(id)
    }

    #[allow(dead_code)] // Extension surface for the Git UI phase.
    pub fn editors(&self) -> impl Iterator<Item = &EditorTab> {
        self.list.iter().filter_map(|t| t.editor())
    }

    pub fn editors_mut(&mut self) -> impl Iterator<Item = (TabId, &mut EditorTab)> {
        self.list.iter_mut().filter_map(|t| {
            let id = t.id;
            t.editor_mut().map(|e| (id, e))
        })
    }

    /// Tabs to close because the strip holds more than `TAB_LIMIT`: the least recently used
    /// editor tabs that are neither modified nor active. Custom tabs count but never close:
    /// Cmd+Shift+T cannot bring them back. When too few tabs qualify, the strip stays
    /// over the limit rather than closing unsaved work.
    pub fn over_limit(&self) -> Vec<TabId> {
        let excess = self.list.len().saturating_sub(TAB_LIMIT);
        if excess == 0 {
            return Vec::new();
        }
        self.mru.iter().rev().copied().filter(|&id| self.active != Some(id) && self.get(id).is_some_and(|t| t.editor().is_some() && !t.is_dirty())).take(excess).collect()
    }

    /// The tab strip. Tabs wrap onto as many rows as the width needs, in strip order, so a
    /// click never moves a tab to another row. Middle-click closes, like IDEA. Flat tabs; the
    /// active one is a lighter rounded fill, with no underline.
    pub fn show_bar(&self, ui: &mut Ui) -> Option<TabBarEvent> {
        let t = &theme::T;
        let row_h = t.space.tab_h;
        let width = ui.available_width();
        let max_w = (width - 2.0 * TAB_GAP).max(1.0);
        let painter = ui.painter().clone();
        let galleys: Vec<_> = self.list.iter().map(|tab| tab_galley(&painter, tab, self.active == Some(tab.id), max_w)).collect();
        let widths: Vec<f32> = galleys.iter().map(|g| tab_width(g.size().x).min(max_w)).collect();
        let (slots, rows) = flow(&widths, width, row_h);
        let (bar, _) = ui.allocate_exact_size(Vec2::new(width, rows as f32 * row_h), Sense::hover());
        let mut event = None;
        for ((tab, galley), slot) in self.list.iter().zip(galleys).zip(slots) {
            let rect = slot.translate(bar.min.to_vec2());
            if let Some(e) = tab_button(ui, tab, self.active == Some(tab.id), rect, galley) {
                event = Some(e);
            }
        }
        event
    }
}

/// The most tabs a strip keeps, like IDEA's "Tab limit". Opening one more closes the least
/// recently used clean tab (`Tabs::over_limit`).
pub const TAB_LIMIT: usize = 50;

/// Space between tabs and at the strip's left and right ends.
const TAB_GAP: f32 = 2.0;
const TAB_PAD: f32 = 10.0;
const TAB_ICON_W: f32 = 20.0;
const TAB_CLOSE_W: f32 = 16.0;

fn tab_width(text_w: f32) -> f32 {
    TAB_PAD + TAB_ICON_W + text_w + 6.0 + TAB_CLOSE_W + 6.0
}

/// Places tabs of `widths` left to right in rows of `row_h` inside `width`, starting a new row
/// when the next tab does not fit. Returns the tab rects relative to the strip's top left
/// corner and the row count (at least 1).
fn flow(widths: &[f32], width: f32, row_h: f32) -> (Vec<Rect>, usize) {
    let mut slots = Vec::with_capacity(widths.len());
    let mut x = TAB_GAP;
    let mut row = 0;
    for &w in widths {
        if x > TAB_GAP && x + w > width - TAB_GAP {
            row += 1;
            x = TAB_GAP;
        }
        // The same 4 pt above and below a tab as the old single row had.
        slots.push(Rect::from_min_size(egui::pos2(x, row as f32 * row_h + 4.0), Vec2::new(w, row_h - 8.0)));
        x += w + TAB_GAP;
    }
    (slots, row + 1)
}

/// The tab title, cut with an ellipsis when the tab would be wider than the strip.
fn tab_galley(painter: &egui::Painter, tab: &Tab, active: bool, max_w: f32) -> std::sync::Arc<egui::Galley> {
    let t = &theme::T;
    let color = if active { t.text_bright } else { t.text };
    let mut job = egui::text::LayoutJob::simple_singleline(tab.title(), t.ui_font(), color);
    job.wrap = egui::text::TextWrapping::truncate_at_width((max_w - tab_width(0.0)).max(1.0));
    painter.layout_job(job)
}

/// The saved files that a restart reopens: the first `TAB_LIMIT` of them, and always the
/// active one. Files over the limit are not even read.
pub fn restore_set(mut files: Vec<PathBuf>, active: Option<&Path>) -> Vec<PathBuf> {
    if files.len() <= TAB_LIMIT {
        return files;
    }
    let keep_active = active.and_then(|a| files.iter().position(|f| f == a)).filter(|&i| i >= TAB_LIMIT);
    let active_file = keep_active.map(|i| files[i].clone());
    files.truncate(if active_file.is_some() { TAB_LIMIT - 1 } else { TAB_LIMIT });
    files.extend(active_file);
    files
}

/// Closes the tabs over `TAB_LIMIT` (`Tabs::over_limit`). They go into the closed-tab history,
/// so Cmd+Shift+T brings them back.
pub fn enforce_limit(state: &mut crate::state::AppState) {
    for id in state.ws.tabs.over_limit() {
        state.close_tab(id, true);
    }
}

/// Cmd+Shift+T: reopens the most recently closed editor tab at its caret, scroll position and
/// old strip position. A file that is gone is skipped, and the next older one is tried.
pub fn reopen_closed(state: &mut crate::state::AppState) {
    let Some(c) = state.ws.tabs.pop_closed() else { return };
    let path = c.path.clone();
    // A stat is disk work: it runs on a worker, like every other file access.
    state.jobs.spawn_quiet(
        move || path.is_file(),
        move |state, exists| {
            if !exists {
                reopen_closed(state);
                return;
            }
            if state.ws.tabs.editor_by_path(&c.path).is_some() {
                // Opened another way in the meantime; the press goes to the next older tab.
                reopen_closed(state);
                return;
            }
            state.ws.tabs.reopen_at.insert(c.path.clone(), (c.index, c.view));
            state.open_location(&c.path, Some(c.caret), false);
        },
    );
}

fn tab_button(ui: &mut Ui, tab: &Tab, active: bool, rect: Rect, galley: std::sync::Arc<egui::Galley>) -> Option<TabBarEvent> {
    let t = &theme::T;
    let color = if active { t.text_bright } else { t.text };
    let resp = ui.interact(rect, crate::workspace::wid(("editor-tab", tab.id)), Sense::click());
    crate::util::label_selectable(&resp, format!("Tab {}", tab.title()), active);
    let painter = ui.painter();
    if active {
        painter.rect_filled(rect, t.radius.button, t.tab_active_bg);
    } else if resp.hovered() {
        painter.rect_filled(rect, t.radius.button, t.hover);
    }
    let icon_c = egui::pos2(rect.min.x + TAB_PAD + 7.0, rect.center().y);
    let read_only = tab.editor().is_some_and(|e| e.read_only);
    match &tab.content {
        TabContent::Editor(e) => icons::file(painter, icon_c, 14.0, &e.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
        TabContent::Custom(_) => icons::paint(painter, Rect::from_center_size(icon_c, Vec2::splat(14.0)), Icon::Branch, t.icon),
    }
    if read_only {
        icons::paint(painter, Rect::from_center_size(icon_c + Vec2::new(5.0, 4.0), Vec2::splat(9.0)), Icon::Lock, t.text_dim);
    }
    let text_pos = egui::pos2(rect.min.x + TAB_PAD + TAB_ICON_W, rect.center().y - galley.size().y / 2.0);
    painter.galley(text_pos, galley, color);

    let close_rect = Rect::from_center_size(egui::pos2(rect.max.x - 6.0 - TAB_CLOSE_W / 2.0, rect.center().y), Vec2::splat(TAB_CLOSE_W));
    let close_hovered = ui.rect_contains_pointer(close_rect);
    if tab.is_dirty() && !close_hovered {
        // IDEA marks a modified tab with a dot where the close button sits.
        painter.circle_filled(close_rect.center(), 3.5, t.text);
    } else if resp.hovered() || active {
        let c = if close_hovered { t.icon_active } else { t.text_dim };
        if close_hovered {
            painter.rect_filled(close_rect, t.radius.small, t.button_hover);
        }
        icons::paint(painter, close_rect.shrink(3.0), Icon::Close, c);
    }
    let resp = resp.on_hover_text(match &tab.content {
        TabContent::Editor(e) if e.read_only => format!("{} (read-only)", e.path.display()),
        TabContent::Editor(e) => e.path.display().to_string(),
        TabContent::Custom(c) => c.tooltip(),
    });
    if close_hovered {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    // Act on the press: a close re-flows the rows, and the release must not land on the tab
    // that moved under the pointer.
    let pressed = crate::clicks::pressed(&resp);
    if resp.middle_clicked() || (pressed && close_hovered) {
        return Some(TabBarEvent::Close(tab.id));
    }
    if pressed {
        return Some(TabBarEvent::Activate(tab.id));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn editor(path: &str) -> TabContent {
        TabContent::Editor(Box::new(EditorTab::new(PathBuf::from(path), Document::from_text("x\n", ide_editor::Language::Plain))))
    }

    #[test]
    fn closed_history_is_capped_and_keeps_one_entry_per_file() {
        let mut tabs = Tabs::default();
        for i in 0..CLOSED_HISTORY + 5 {
            let id = tabs.add(editor(&format!("/p/{i}.txt")));
            tabs.remove(id);
        }
        assert_eq!(tabs.closed().len(), CLOSED_HISTORY);
        assert_eq!(tabs.closed()[0].path, PathBuf::from("/p/5.txt"), "the oldest entries drop out");

        let id = tabs.add(editor("/p/5.txt"));
        tabs.remove(id);
        assert_eq!(tabs.closed().len(), CLOSED_HISTORY);
        assert_eq!(tabs.closed().last().map(|c| c.path.clone()), Some(PathBuf::from("/p/5.txt")));
        assert_eq!(tabs.closed().iter().filter(|c| c.path == Path::new("/p/5.txt")).count(), 1);
    }

    #[test]
    fn a_reopened_tab_goes_back_to_its_index() {
        let mut tabs = Tabs::default();
        let a = tabs.add(editor("/p/a"));
        tabs.add(editor("/p/b"));
        tabs.add(editor("/p/c"));
        tabs.remove(a);
        let c = tabs.pop_closed().expect("closed a");
        assert_eq!(c.index, 0);
        tabs.reopen_at.insert(c.path.clone(), (c.index, c.view));
        tabs.add(editor("/p/a"));
        let titles: Vec<String> = tabs.list.iter().map(|t| t.title()).collect();
        assert_eq!(titles, ["a", "b", "c"]);
    }

    #[test]
    fn over_limit_picks_the_least_recently_used_clean_inactive_tabs() {
        let mut tabs = Tabs::default();
        let ids: Vec<TabId> = (0..TAB_LIMIT).map(|i| tabs.add(editor(&format!("/p/{i}")))).collect();
        assert!(tabs.over_limit().is_empty());
        tabs.activate(ids[0]);
        tabs.add(editor("/p/new"));
        // ids[0] was used last before the new tab, so ids[1] is the oldest.
        assert_eq!(tabs.over_limit(), [ids[1]]);
        if let Some(e) = tabs.editor_mut(ids[1]) {
            e.doc.replace(Position::new(0, 0), Position::new(0, 0), "y");
        }
        assert_eq!(tabs.over_limit(), [ids[2]], "a modified tab is skipped");
    }

    #[test]
    fn flow_wraps_tabs_that_do_not_fit() {
        let (slots, rows) = flow(&[100.0, 100.0, 100.0, 300.0], 250.0, 34.0);
        assert_eq!(rows, 3);
        assert_eq!(slots[0].min, egui::pos2(TAB_GAP, 4.0));
        assert_eq!(slots[1].min.y, 4.0, "two tabs fit in the first row");
        assert_eq!(slots[2].min, egui::pos2(TAB_GAP, 38.0));
        assert_eq!(slots[3].min, egui::pos2(TAB_GAP, 72.0));
        assert!(slots.iter().all(|r| r.height() == 26.0));
        let (_, rows) = flow(&[], 310.0, 34.0);
        assert_eq!(rows, 1);
    }

    #[test]
    fn restore_keeps_the_limit_and_the_active_file() {
        let files: Vec<PathBuf> = (0..TAB_LIMIT + 10).map(|i| PathBuf::from(format!("/p/{i}"))).collect();
        let kept = restore_set(files.clone(), Some(Path::new("/p/55")));
        assert_eq!(kept.len(), TAB_LIMIT);
        assert_eq!(kept.last().map(PathBuf::as_path), Some(Path::new("/p/55")));
        assert_eq!(kept[..TAB_LIMIT - 1], files[..TAB_LIMIT - 1]);
        assert_eq!(restore_set(files.clone(), Some(Path::new("/p/3"))), files[..TAB_LIMIT]);
        assert_eq!(restore_set(files[..3].to_vec(), None), files[..3]);
    }
}
