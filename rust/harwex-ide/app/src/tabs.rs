//! Editor tabs and custom (non-editor) tabs such as the diff viewer.
//!
//! Editor tabs are keyed by canonical path, because tsserver reports canonical paths and a
//! symlinked workspace package would otherwise open twice.

use std::any::Any;
use std::path::{Path, PathBuf};
use std::time::Instant;

use egui::{CursorIcon, Rect, ScrollArea, Sense, Ui, Vec2};
use ide_editor::{Document, EditorState, GutterMark};

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
}

impl EditorTab {
    pub fn new(path: PathBuf, doc: Document) -> EditorTab {
        let read_only = crate::lang::is_library_path(&path);
        EditorTab {
            path,
            doc,
            view: EditorState::new(),
            marks: Vec::new(),
            annotations: Vec::new(),
            read_only,
            marks_for: None,
            marks_in_flight: false,
            lang: None,
            lsp_version: None,
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

    /// The tab strip. Middle-click closes, like IDEA. Flat tabs; the active one is a lighter
    /// rounded fill, with no underline.
    pub fn show_bar(&self, ui: &mut Ui) -> Option<TabBarEvent> {
        let t = &theme::T;
        let mut event = None;
        let height = t.space.tab_h;
        let (bar, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::hover());
        let mut child = ui.new_child(egui::UiBuilder::new().max_rect(bar));
        ScrollArea::horizontal().id_salt("tab-bar").scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden).show(&mut child, |ui| {
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                ui.add_space(2.0);
                for tab in &self.list {
                    if let Some(e) = tab_button(ui, tab, self.active == Some(tab.id), height - 8.0) {
                        event = Some(e);
                    }
                }
            });
        });
        event
    }
}

fn tab_button(ui: &mut Ui, tab: &Tab, active: bool, height: f32) -> Option<TabBarEvent> {
    let t = &theme::T;
    let title = tab.title();
    let color = if active { t.text_bright } else { t.text };
    let galley = ui.painter().layout_no_wrap(title, t.ui_font(), color);
    let pad = 10.0;
    let icon_w = 20.0;
    let close_w = 16.0;
    let width = pad + icon_w + galley.size().x + 6.0 + close_w + 6.0;
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    crate::util::label_selectable(&resp, format!("Tab {}", tab.title()), active);
    let painter = ui.painter();
    if active {
        painter.rect_filled(rect, t.radius.button, t.tab_active_bg);
    } else if resp.hovered() {
        painter.rect_filled(rect, t.radius.button, t.hover);
    }
    let icon_c = egui::pos2(rect.min.x + pad + 7.0, rect.center().y);
    let read_only = tab.editor().is_some_and(|e| e.read_only);
    match &tab.content {
        TabContent::Editor(e) => icons::file(painter, icon_c, 14.0, &e.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
        TabContent::Custom(_) => icons::paint(painter, Rect::from_center_size(icon_c, Vec2::splat(14.0)), Icon::Branch, t.icon),
    }
    if read_only {
        icons::paint(painter, Rect::from_center_size(icon_c + Vec2::new(5.0, 4.0), Vec2::splat(9.0)), Icon::Lock, t.text_dim);
    }
    let text_pos = egui::pos2(rect.min.x + pad + icon_w, rect.center().y - galley.size().y / 2.0);
    painter.galley(text_pos, galley, color);

    let close_rect = Rect::from_center_size(egui::pos2(rect.max.x - 6.0 - close_w / 2.0, rect.center().y), Vec2::splat(close_w));
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
    if resp.middle_clicked() || (resp.clicked() && close_hovered) {
        return Some(TabBarEvent::Close(tab.id));
    }
    if resp.clicked() || resp.drag_started() {
        return Some(TabBarEvent::Activate(tab.id));
    }
    None
}

