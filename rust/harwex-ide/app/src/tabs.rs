//! Editor tabs and custom (non-editor) tabs such as the diff viewer.
//!
//! Editor tabs are keyed by canonical path, because tsserver reports canonical paths and a
//! symlinked workspace package would otherwise open twice.

use std::any::Any;
use std::path::{Path, PathBuf};
use std::time::Instant;

use egui::{Color32, CursorIcon, Rect, ScrollArea, Sense, Stroke, Ui, Vec2};
use ide_editor::{Document, EditorState, GutterMark};

use crate::state::TabEnv;
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
    /// The file lives under `node_modules`. The editor ignores edits and the tab shows a lock.
    pub read_only: bool,
    /// Doc version the gutter marks were last requested for. `None` forces a recompute.
    pub(crate) marks_for: Option<u64>,
    pub(crate) marks_in_flight: bool,
    /// Doc version tsserver has seen. `None` means tsserver does not track this file.
    pub(crate) ts_version: Option<u64>,
    pub(crate) last_edit: Instant,
    pub(crate) saving: bool,
}

impl EditorTab {
    pub fn new(path: PathBuf, doc: Document) -> EditorTab {
        let read_only = path.components().any(|c| c.as_os_str() == "node_modules");
        EditorTab {
            path,
            doc,
            view: EditorState::new(),
            marks: Vec::new(),
            annotations: Vec::new(),
            read_only,
            marks_for: None,
            marks_in_flight: false,
            ts_version: None,
            last_edit: Instant::now(),
            saving: false,
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

#[derive(Default)]
pub struct Tabs {
    pub list: Vec<Tab>,
    pub active: Option<TabId>,
    /// Most recently used first; closing a tab activates the previous one, like IDEA.
    mru: Vec<TabId>,
    next_id: TabId,
}

pub enum TabBarEvent {
    Activate(TabId),
    Close(TabId),
}

impl Tabs {
    pub fn add(&mut self, content: TabContent) -> TabId {
        self.next_id += 1;
        let id = self.next_id;
        // New tabs open right after the active one, like IDEA.
        let at = self.active.and_then(|a| self.index(a)).map_or(self.list.len(), |i| i + 1);
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
        self.mru.retain(|&t| t != id);
        if self.active == Some(id) {
            self.active = self.mru.first().copied();
        }
        Some(tab)
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

    /// The tab strip. Middle-click closes, like IDEA.
    pub fn show_bar(&self, ui: &mut Ui) -> Option<TabBarEvent> {
        let mut event = None;
        let height = 28.0;
        let (bar, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::hover());
        ui.painter().rect_filled(bar, 0.0, theme::TAB_BAR_BG);
        ui.painter().hline(bar.x_range(), bar.max.y - 0.5, Stroke::new(1.0_f32, theme::BORDER));
        let mut child = ui.new_child(egui::UiBuilder::new().max_rect(bar));
        ScrollArea::horizontal().id_salt("tab-bar").scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden).show(&mut child, |ui| {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 0.0;
                for tab in &self.list {
                    if let Some(e) = tab_button(ui, tab, self.active == Some(tab.id), height) {
                        event = Some(e);
                    }
                }
            });
        });
        event
    }
}

fn tab_button(ui: &mut Ui, tab: &Tab, active: bool, height: f32) -> Option<TabBarEvent> {
    let title = tab.title();
    let font = egui::FontId::proportional(13.0);
    let color = if active { theme::TEXT_BRIGHT } else { theme::TEXT };
    let galley = ui.painter().layout_no_wrap(title, font, color);
    let pad = 12.0;
    let dot_w = 10.0;
    let close_w = 16.0;
    let width = pad + dot_w + galley.size().x + 6.0 + close_w + 6.0;
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    crate::util::label_selectable(&resp, format!("Tab {}", tab.title()), active);
    let painter = ui.painter();
    if active {
        painter.rect_filled(rect, 0.0, theme::TAB_ACTIVE_BG);
        painter.hline(rect.x_range(), rect.max.y - 1.5, Stroke::new(3.0_f32, theme::TAB_ACTIVE_LINE));
    } else if resp.hovered() {
        painter.rect_filled(rect, 0.0, theme::HOVER);
    }
    painter.vline(rect.max.x - 0.5, rect.y_range(), Stroke::new(1.0_f32, theme::BORDER));
    let text_pos = egui::pos2(rect.min.x + pad + dot_w, rect.center().y - galley.size().y / 2.0);
    let read_only = tab.editor().is_some_and(|e| e.read_only);
    if read_only {
        draw_lock(painter, egui::pos2(rect.min.x + pad + 3.0, rect.center().y), theme::TEXT_DIM);
    } else if tab.is_dirty() {
        painter.circle_filled(egui::pos2(rect.min.x + pad + 3.0, rect.center().y), 3.0, theme::TEXT);
    }
    painter.galley(text_pos, galley, color);

    let close_rect = Rect::from_center_size(egui::pos2(rect.max.x - 6.0 - close_w / 2.0, rect.center().y), Vec2::splat(14.0));
    let close_hovered = ui.rect_contains_pointer(close_rect);
    if resp.hovered() || active {
        let c = if close_hovered { theme::TEXT_BRIGHT } else { Color32::from_gray(130) };
        if close_hovered {
            painter.rect_filled(close_rect, 3.0, theme::HOVER);
        }
        let r = close_rect.shrink(4.0);
        painter.line_segment([r.left_top(), r.right_bottom()], Stroke::new(1.2_f32, c));
        painter.line_segment([r.right_top(), r.left_bottom()], Stroke::new(1.2_f32, c));
    }
    let resp = resp.on_hover_text(match &tab.content {
        TabContent::Editor(e) if e.read_only => format!("{} (read-only)", e.path.display()),
        TabContent::Editor(e) => e.path.display().to_string(),
        TabContent::Custom(c) => c.tooltip(),
    });
    if close_hovered {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    if resp.middle_clicked() || (resp.clicked() && close_hovered) {
        return Some(TabBarEvent::Close(tab.id));
    }
    if resp.clicked() || resp.drag_started() {
        return Some(TabBarEvent::Activate(tab.id));
    }
    None
}

/// A small padlock: the default fonts have no lock glyph.
fn draw_lock(painter: &egui::Painter, center: egui::Pos2, color: Color32) {
    let body = Rect::from_center_size(center + Vec2::new(0.0, 1.5), Vec2::new(8.0, 6.0));
    painter.rect_filled(body, 1.0, color);
    let r = 2.5;
    let top = body.min.y;
    let pts: Vec<egui::Pos2> = (0..=8)
        .map(|i| {
            let a = std::f32::consts::PI * (i as f32 / 8.0);
            egui::pos2(center.x - r * a.cos(), top - r * a.sin())
        })
        .collect();
    painter.add(egui::Shape::line(pts, Stroke::new(1.3_f32, color)));
}
