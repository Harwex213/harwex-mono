//! Bottom "Find" tool window, like IDEA's: one tab per Find Usages or Find in Files search, a
//! result tree (usage kind, folders, files, lines) with counts, a toolbar (rerun, previous/next
//! result, expand/collapse all) and an editable preview on the right (`preview.rs`).
//!
//! Producers: `nav::usages` (Alt+F7, the editor menu), `tree_menu` (Find Usages of a file) and
//! the Find in Files popup (`open_text_results`, task 044). Each search opens a new tab; the
//! tab's `generation` drops the answer of a search that a rerun replaced.

mod rows;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use egui::text::LayoutJob;
use egui::{
    pos2, vec2, Frame, Key, Margin, Rect, RichText, ScrollArea, Sense, TextFormat, Ui, UiBuilder,
};
use ide_editor::Position;

pub use rows::{NodeKey, ResultItem, Row, RowKind, UsageKind};

use crate::find::{FileHits, Query};
use crate::icons::{self, Icon};
use crate::layout::{self, ToolWindow};
use crate::preview::{self, FilePreview};
use crate::state::AppState;
use crate::theme::T;
use crate::workspace::wid;

/// Where a Find in Files search looked (task 044 fills it; shown in the tab title).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SearchScope {
    Project,
    Directory { path: PathBuf, recursive: bool },
    OpenFiles,
    ChangedFiles,
}

impl SearchScope {
    /// "Project Files", "Directory packages", like IDEA's tab titles.
    pub fn label(&self, root: &Path) -> String {
        match self {
            SearchScope::Project => "Project Files".into(),
            SearchScope::Directory { path, .. } => {
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(path)
                    .display()
                    .to_string();
                if rel.is_empty() {
                    "Project Files".into()
                } else {
                    format!("Directory {rel}")
                }
            }
            SearchScope::OpenFiles => "Open Files".into(),
            SearchScope::ChangedFiles => "Changed Files".into(),
        }
    }
}

/// What a usages tab searched for; a rerun asks again with it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UsageOrigin {
    /// The symbol at `pos` (the position the request was made at).
    Symbol {
        path: PathBuf,
        pos: Position,
        word: String,
    },
    /// Imports of a file (Project tree, Find Usages).
    File { path: PathBuf },
}

#[derive(Clone, Debug)]
pub enum TabKind {
    Usages(UsageOrigin),
    Text {
        query: Query,
        scope: SearchScope,
        mask: Option<String>,
    },
}

pub struct FindTab {
    pub id: u64,
    pub title: String,
    pub kind: TabKind,
    /// Sorted by `rows::sort_items`: group, display path, position.
    pub items: Vec<ResultItem>,
    pub searching: bool,
    pub error: Option<String>,
    /// Find in Files found more than `find::FIND_WINDOW_CAP` hits; the tab shows the first ones.
    pub truncated: bool,
    pub selected: Option<NodeKey>,
    pub preview: FilePreview,
    collapsed: HashSet<NodeKey>,
    generation: u64,
    next_item: u64,
    rows: Option<Vec<Row>>,
    /// Scroll the selected row into view on the next draw.
    reveal: bool,
    /// Last frame's scroll offset and viewport height of the tree.
    view: (f32, f32),
    cancel: Option<Arc<AtomicBool>>,
}

impl FindTab {
    fn new(id: u64, title: String, kind: TabKind) -> FindTab {
        FindTab {
            id,
            title,
            kind,
            items: Vec::new(),
            searching: false,
            error: None,
            truncated: false,
            selected: None,
            preview: FilePreview::default(),
            collapsed: HashSet::new(),
            generation: 0,
            next_item: 0,
            rows: None,
            reveal: false,
            view: (0.0, 0.0),
            cancel: None,
        }
    }

    pub fn is_usages(&self) -> bool {
        matches!(self.kind, TabKind::Usages(_))
    }

    /// Replaces the results and selects the first one, like IDEA.
    fn set_items(&mut self, root: &Path, mut items: Vec<ResultItem>) {
        for it in &mut items {
            it.id = self.next_item;
            self.next_item += 1;
        }
        rows::sort_items(root, &mut items);
        self.items = items;
        self.collapsed.clear();
        self.rows = None;
        self.selected = None;
        self.preview.clear();
        if !self.items.is_empty() {
            self.select_item(0);
        }
    }

    /// The visible rows, rebuilt only after a change.
    pub fn rows(&mut self, root: &Path) -> &[Row] {
        if self.rows.is_none() {
            self.rows = Some(rows::build(root, &self.items, &self.collapsed));
        }
        self.rows.as_deref().unwrap_or_default()
    }

    fn item_index(&self, id: u64) -> Option<usize> {
        self.items.iter().position(|i| i.id == id)
    }

    fn select_item(&mut self, index: usize) {
        let Some(item) = self.items.get(index) else {
            return;
        };
        self.selected = Some(NodeKey::Item(item.id));
        self.preview.show_match(
            item.path.clone(),
            item.line,
            Some((item.column, item.end_column)),
        );
        self.reveal = true;
    }

    /// Selects a row and points the preview at it (a file row shows its first result).
    fn select(&mut self, key: NodeKey) {
        let first = match &key {
            NodeKey::Item(id) => self.item_index(*id),
            NodeKey::File(kind, path) => self
                .items
                .iter()
                .position(|i| i.kind == *kind && i.path == *path),
            _ => None,
        };
        if let Some(i) = first {
            let item = &self.items[i];
            self.preview.show_match(
                item.path.clone(),
                item.line,
                Some((item.column, item.end_column)),
            );
        }
        self.selected = Some(key);
        self.reveal = true;
    }

    fn toggle(&mut self, key: &NodeKey) {
        if !self.collapsed.remove(key) {
            self.collapsed.insert(key.clone());
        }
        self.rows = None;
    }

    pub fn expand_all(&mut self) {
        self.collapsed.clear();
        self.rows = None;
    }

    pub fn collapse_all(&mut self, root: &Path) {
        self.collapsed = rows::all_keys(root, &self.items);
        self.rows = None;
        // The selection moves up to its top row, which stays visible.
        if let Some(sel) = &self.selected {
            let top = match sel {
                NodeKey::Group(_) => Some(sel.clone()),
                NodeKey::Item(id) => self
                    .item_index(*id)
                    .and_then(|i| rows::ancestors(root, &self.items[i]).into_iter().next()),
                NodeKey::Dir(k, _) | NodeKey::File(k, _) => match k {
                    Some(k) => Some(NodeKey::Group(*k)),
                    None => self
                        .rows(root)
                        .iter()
                        .find(|r| r.depth == 0 && r.expandable())
                        .map(|r| r.key.clone()),
                },
            };
            self.selected = top;
        }
    }

    /// Previous (`-1`) or next (`1`) result, expanding its folders; wraps around like IDEA.
    pub fn step(&mut self, root: &Path, dir: isize) {
        if self.items.is_empty() {
            return;
        }
        let n = self.items.len() as isize;
        let current = match &self.selected {
            Some(NodeKey::Item(id)) => self.item_index(*id).map(|i| i as isize),
            _ => None,
        };
        let next = match current {
            Some(i) => (i + dir).rem_euclid(n),
            None if dir > 0 => 0,
            None => n - 1,
        } as usize;
        for key in rows::ancestors(root, &self.items[next]) {
            if self.collapsed.remove(&key) {
                self.rows = None;
            }
        }
        self.select_item(next);
    }

    /// Delete: drops the results under `key` from the list (the files stay untouched).
    pub fn exclude(&mut self, root: &Path, key: &NodeKey) {
        let rows_before: Vec<NodeKey> = self.rows(root).iter().map(|r| r.key.clone()).collect();
        let at = rows_before.iter().position(|k| k == key);
        self.items.retain(|i| !under(root, i, key));
        self.rows = None;
        // The row now at the same place takes the selection (the one before at the end).
        let after: Vec<NodeKey> = self.rows(root).iter().map(|r| r.key.clone()).collect();
        let next = at
            .and_then(|at| after.get(at.min(after.len().saturating_sub(1))))
            .cloned();
        match next {
            Some(k) => self.select(k),
            None => {
                self.selected = None;
                self.preview.clear();
            }
        }
    }

    pub fn selected_item(&self) -> Option<&ResultItem> {
        match &self.selected {
            Some(NodeKey::Item(id)) => self.items.iter().find(|i| i.id == *id),
            _ => None,
        }
    }
}

/// `item` lies under the row `key`.
fn under(root: &Path, item: &ResultItem, key: &NodeKey) -> bool {
    match key {
        NodeKey::Group(k) => item.kind == Some(*k),
        NodeKey::Dir(k, prefix) => {
            item.kind == *k && rows::display(root, &item.path).starts_with(&format!("{prefix}/"))
        }
        NodeKey::File(k, path) => item.kind == *k && item.path == *path,
        NodeKey::Item(id) => item.id == *id,
    }
}

/// A tab drag in progress (the terminal tab pattern): the tab by id and the grab offset.
struct TabDrag {
    id: u64,
    grab: f32,
}

/// The Find window of one workspace.
#[derive(Default)]
pub struct FindWindow {
    pub tabs: Vec<FindTab>,
    pub active: usize,
    next_id: u64,
    drag: Option<TabDrag>,
}

impl FindWindow {
    pub fn active_tab(&self) -> Option<&FindTab> {
        self.tabs.get(self.active)
    }

    pub fn active_tab_mut(&mut self) -> Option<&mut FindTab> {
        self.tabs.get_mut(self.active)
    }

    pub fn tab(&self, id: u64) -> Option<&FindTab> {
        self.tabs.iter().find(|t| t.id == id)
    }

    pub fn tab_mut(&mut self, id: u64) -> Option<&mut FindTab> {
        self.tabs.iter_mut().find(|t| t.id == id)
    }

    /// A preview load or save is in flight or due. Part of `Workspace::is_idle`.
    pub fn is_pending(&self) -> bool {
        self.tabs.iter().any(|t| t.preview.is_pending())
    }

    /// State for a newly opened project; ids keep counting so late answers find no tab.
    pub fn reset(&mut self) {
        for t in &self.tabs {
            if let Some(c) = &t.cancel {
                c.store(true, Ordering::Relaxed);
            }
        }
        let next_id = self.next_id;
        *self = FindWindow {
            next_id,
            ..Default::default()
        };
    }

    fn push(&mut self, title: String, kind: TabKind) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        self.tabs.push(FindTab::new(id, title, kind));
        self.active = self.tabs.len() - 1;
        id
    }

    /// Moves the tab at `from` to `to` and makes it active.
    pub fn move_tab(&mut self, from: usize, to: usize) {
        if from >= self.tabs.len() {
            return;
        }
        let tab = self.tabs.remove(from);
        let to = to.min(self.tabs.len());
        self.tabs.insert(to, tab);
        self.active = to;
    }
}

fn project_root(state: &AppState) -> PathBuf {
    state
        .ws
        .project
        .as_ref()
        .map(|p| p.root.clone())
        .unwrap_or_default()
}

fn usages_title(origin: &UsageOrigin) -> String {
    match origin {
        UsageOrigin::Symbol { word, .. } => format!("{word} in Project Files"),
        UsageOrigin::File { path } => format!(
            "{} in Project Files",
            path.file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default()
        ),
    }
}

/// Opens (or, for a rerun, reuses) a usages tab in the searching state and shows the window.
/// Returns the tab id and the generation that `finish_usages` must bring back.
pub fn start_usages(state: &mut AppState, origin: UsageOrigin, into: Option<u64>) -> (u64, u64) {
    let fw = &mut state.ws.find_window;
    let id = match into.filter(|id| fw.tab(*id).is_some()) {
        Some(id) => id,
        None => fw.push(usages_title(&origin), TabKind::Usages(origin)),
    };
    let tab = fw.tab_mut(id).expect("tab exists");
    tab.generation += 1;
    tab.searching = true;
    tab.error = None;
    let generation = tab.generation;
    state.ws.layout.show(ToolWindow::Find);
    (id, generation)
}

/// The answer of a usages search. A tab that was closed or rerun meanwhile drops it.
pub fn finish_usages(
    state: &mut AppState,
    tab: u64,
    generation: u64,
    result: Result<Vec<crate::lang::Reference>, String>,
) {
    let root = project_root(state);
    let Some(t) = state
        .ws
        .find_window
        .tab_mut(tab)
        .filter(|t| t.generation == generation)
    else {
        return;
    };
    t.searching = false;
    match result {
        Ok(refs) => {
            let mut seen = HashSet::new();
            let items = refs
                .into_iter()
                .filter(|r| {
                    seen.insert((r.location.path.clone(), r.location.line, r.location.column))
                })
                .map(|r| {
                    let kind = Some(UsageKind::of(&r));
                    let end_column = if r.end_line == r.location.line {
                        r.end_column
                    } else {
                        r.line_text.chars().count()
                    };
                    ResultItem {
                        id: 0,
                        path: r.location.path,
                        line: r.location.line,
                        column: r.location.column,
                        end_column,
                        line_text: r.line_text,
                        kind,
                    }
                })
                .collect();
            t.set_items(&root, items);
        }
        Err(e) => t.error = Some(e),
    }
}

/// The language servers restarted: searches in flight never answer now.
pub fn cancel_searches(state: &mut AppState) {
    for t in &mut state.ws.find_window.tabs {
        if t.is_usages() && t.searching {
            t.searching = false;
            t.generation += 1;
        }
    }
}

fn text_title(query: &Query, scope: &SearchScope, root: &Path) -> String {
    format!("\"{}\" in {}", query.text, scope.label(root))
}

fn text_items(hits: FileHits) -> Vec<ResultItem> {
    hits.into_iter()
        .flat_map(|(_, h)| h)
        .map(|h| ResultItem {
            id: 0,
            path: h.path,
            line: h.line,
            column: h.column,
            end_column: h.end_column,
            line_text: h.line_text,
            kind: None,
        })
        .collect()
}

/// Opens a new Find tab with Find in Files results (or reuses the current one when
/// `new_tab` is false) and shows the Find tool window.
pub fn open_text_results(
    state: &mut AppState,
    query: Query,
    scope: SearchScope,
    mask: Option<String>,
    mut hits: FileHits,
    new_tab: bool,
) {
    let truncated = crate::find::cap_hits(&mut hits, crate::find::FIND_WINDOW_CAP);
    let root = project_root(state);
    let title = text_title(&query, &scope, &root);
    let kind = TabKind::Text { query, scope, mask };
    let fw = &mut state.ws.find_window;
    let reuse = if new_tab {
        None
    } else {
        fw.active_tab()
            .filter(|t| !t.is_usages() && !t.searching)
            .map(|t| t.id)
    };
    let id = match reuse {
        Some(id) => {
            let t = fw.tab_mut(id).expect("tab exists");
            t.title = title;
            t.kind = kind;
            t.generation += 1;
            id
        }
        None => fw.push(title, kind),
    };
    let t = fw.tab_mut(id).expect("tab exists");
    t.searching = false;
    t.error = None;
    t.truncated = truncated;
    t.set_items(&root, text_items(hits));
    state.ws.layout.show(ToolWindow::Find);
}

/// ⟳: runs the tab's search again on a worker (usages at the same position; text with the
/// same query, scope and mask).
pub fn rerun(state: &mut AppState, tab: u64) {
    let Some(kind) = state.ws.find_window.tab(tab).map(|t| t.kind.clone()) else {
        return;
    };
    match kind {
        TabKind::Usages(UsageOrigin::Symbol { path, pos, word }) => {
            crate::nav::usages(state, path, pos, word, Some(tab))
        }
        TabKind::Usages(UsageOrigin::File { path }) => {
            crate::tree_menu::find_file_usages(state, path, Some(tab))
        }
        TabKind::Text { query, scope, mask } => rerun_text(state, tab, query, scope, mask),
    }
}

fn rerun_text(
    state: &mut AppState,
    tab: u64,
    query: Query,
    scope: SearchScope,
    mask: Option<String>,
) {
    // The same files and rules as the Find in Files popup (`find::targets`, `find::Mask`).
    let Some(targets) = crate::find::targets(state, &scope) else {
        return;
    };
    let mask = mask.as_deref().map(crate::find::Mask::parse);
    let source = crate::find::unsaved_buffers(state);
    let skip = state.ws.tree.excluded.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    let Some(t) = state.ws.find_window.tab_mut(tab) else {
        return;
    };
    if let Some(c) = t.cancel.replace(cancel.clone()) {
        c.store(true, Ordering::Relaxed);
    }
    t.generation += 1;
    t.searching = true;
    t.error = None;
    let generation = t.generation;
    let label = query.text.clone();
    state.jobs.spawn(
        format!("Searching for \"{label}\""),
        move || {
            crate::find::search_with(
                &targets,
                &source,
                &query,
                mask.as_ref(),
                &skip,
                &cancel,
                // One past the cap tells the tab it was cut off.
                crate::find::FIND_WINDOW_CAP + 1,
                &|_, _| {},
            )
        },
        move |state, res| {
            let root = project_root(state);
            let Some(t) = state
                .ws
                .find_window
                .tab_mut(tab)
                .filter(|t| t.generation == generation)
            else {
                return;
            };
            t.searching = false;
            t.cancel = None;
            match res {
                Ok((mut hits, _)) => {
                    t.truncated = crate::find::cap_hits(&mut hits, crate::find::FIND_WINDOW_CAP);
                    t.set_items(&root, text_items(hits));
                }
                Err(e) => t.error = Some(e),
            }
        },
    );
}

/// Every frame, for every workspace: previews apply their loads and save due edits.
pub fn tick(state: &mut AppState) {
    let ids: Vec<u64> = state
        .ws
        .find_window
        .tabs
        .iter()
        .filter(|t| t.preview.is_pending())
        .map(|t| t.id)
        .collect();
    for id in ids {
        let Some(t) = state.ws.find_window.tab_mut(id) else {
            continue;
        };
        let mut p = std::mem::take(&mut t.preview);
        preview::tick(state, &mut p);
        if let Some(t) = state.ws.find_window.tab_mut(id) {
            t.preview = p;
        }
    }
}

/// Closes a tab; its preview saves its last edits first.
pub fn close_tab(state: &mut AppState, index: usize) {
    let fw = &mut state.ws.find_window;
    if index >= fw.tabs.len() {
        return;
    }
    let mut tab = fw.tabs.remove(index);
    if fw.active > index || fw.active >= fw.tabs.len() {
        fw.active = fw.active.saturating_sub(1);
    }
    if let Some(c) = &tab.cancel {
        c.store(true, Ordering::Relaxed);
    }
    preview::flush(state, &mut tab.preview);
    if state.ws.find_window.tabs.is_empty() && state.ws.layout.bottom == Some(ToolWindow::Find) {
        state.ws.layout.bottom = None;
    }
}

// ---------------------------------------------------------------------------------------------
// Header tabs

const TAB_GAP: f32 = 2.0;
const CLOSE_W: f32 = 16.0;

/// The tab strip in the window header: icon, title, cross. A press activates; a drag reorders.
pub fn header_tabs(state: &mut AppState, ui: &mut Ui) {
    let t = &T;
    let fw = &mut state.ws.find_window;
    let tabs: Vec<_> = fw
        .tabs
        .iter()
        .enumerate()
        .map(|(i, tab)| {
            let mut title = tab.title.clone();
            if title.chars().count() > 48 {
                title = format!("{}...", title.chars().take(46).collect::<String>());
            }
            let active = i == fw.active;
            let color = if active { t.text_bright } else { t.text };
            let galley = ui.painter().layout_no_wrap(title, t.small_font(), color);
            let width = 8.0 + 14.0 + 6.0 + galley.size().x + 4.0 + CLOSE_W + 4.0;
            (
                tab.id,
                tab.title.clone(),
                tab.is_usages(),
                active,
                color,
                galley,
                width,
            )
        })
        .collect();
    if tabs.is_empty() {
        return;
    }
    let total =
        tabs.iter().map(|tab| tab.6).sum::<f32>() + TAB_GAP * tabs.len().saturating_sub(1) as f32;
    let (strip, _) = ui.allocate_exact_size(vec2(total, 24.0), Sense::hover());
    let dragged = fw.drag.as_ref().and_then(|d| {
        tabs.iter()
            .position(|tab| tab.0 == d.id)
            .map(|i| (i, d.grab))
    });
    if fw.drag.is_some() && dragged.is_none() {
        fw.drag = None;
    }
    let pointer = ui.ctx().pointer_latest_pos();
    let zone = strip.expand2(vec2(24.0, 12.0));
    let preview = dragged.map(|(d, grab)| {
        let w = tabs[d].6;
        match pointer.filter(|p| zone.contains(*p)) {
            Some(p) => {
                let left = (p.x - grab).clamp(strip.min.x, (strip.max.x - w).max(strip.min.x));
                // The slot is the number of other tabs whose middle lies left of the pointer.
                // (The dragged tab's middle would never pass a narrower first tab: its left
                // edge stops at the strip start.)
                let mut x = strip.min.x;
                let mut slot = 0;
                for (i, tab) in tabs.iter().enumerate() {
                    if i == d {
                        continue;
                    }
                    if x + tab.6 / 2.0 < p.x {
                        slot += 1;
                    }
                    x += tab.6 + TAB_GAP;
                }
                (d, slot, Some(left))
            }
            None => (d, d, None),
        }
    });
    let mut order: Vec<usize> = (0..tabs.len()).collect();
    if let Some((d, slot, _)) = preview {
        order.remove(d);
        order.insert(slot, d);
    }
    let (mut activate, mut close, mut drop, mut floating) = (None, None, None, None);
    let mut x = strip.min.x;
    for &i in &order {
        let (id, title, usages, active, color, galley, width) = &tabs[i];
        let slot_rect = Rect::from_min_size(pos2(x, strip.min.y), vec2(*width, strip.height()));
        x += width + TAB_GAP;
        let is_dragged = preview.is_some_and(|(d, ..)| d == i);
        let rect = match preview {
            Some((_, _, Some(left))) if is_dragged => {
                slot_rect.translate(vec2(left - slot_rect.min.x, 0.0))
            }
            _ => slot_rect,
        };
        let resp = ui.interact(rect, wid(("find-tab", *id)), Sense::click_and_drag());
        crate::util::label_selectable(&resp, format!("Find tab {title}"), *active);
        let close_rect = Rect::from_center_size(
            pos2(rect.max.x - 4.0 - CLOSE_W / 2.0, rect.center().y),
            egui::Vec2::splat(CLOSE_W),
        );
        let close_resp = ui.interact(close_rect, wid(("find-tab-close", *id)), Sense::click());
        crate::util::label_widget(
            &close_resp,
            egui::WidgetType::Button,
            format!("Close {title}"),
        );
        if resp.drag_started() && fw.drag.is_none() {
            let press = ui
                .input(|inp| inp.pointer.press_origin())
                .or(pointer)
                .unwrap_or(rect.min);
            fw.drag = Some(TabDrag {
                id: *id,
                grab: press.x - rect.min.x,
            });
        }
        if is_dragged {
            if resp.drag_stopped() {
                drop = preview.and_then(|(d, slot, left)| left.map(|_| (d, slot)));
                fw.drag = None;
            } else if !ui.ctx().is_being_dragged(resp.id) {
                fw.drag = None;
            }
        }
        let hovered = resp.hovered() && fw.drag.is_none();
        let close_hovered = close_resp.hovered() && fw.drag.is_none();
        let icon = if *usages { Icon::Usages } else { Icon::Find };
        let paint = move |painter: &egui::Painter| {
            if is_dragged {
                painter.rect_filled(rect, t.radius.button, t.tab_active_bg);
                painter.rect_stroke(
                    rect,
                    t.radius.button,
                    egui::Stroke::new(1.0_f32, t.drop_target_border),
                    egui::StrokeKind::Inside,
                );
            } else if *active {
                painter.rect_filled(rect, t.radius.button, t.tab_active_bg);
            } else if hovered {
                painter.rect_filled(rect, t.radius.button, t.hover);
            }
            icons::paint(
                painter,
                Rect::from_center_size(
                    pos2(rect.min.x + 8.0 + 7.0, rect.center().y),
                    egui::Vec2::splat(14.0),
                ),
                icon,
                t.icon,
            );
            painter.galley(
                pos2(
                    rect.min.x + 8.0 + 14.0 + 6.0,
                    rect.center().y - galley.size().y / 2.0,
                ),
                galley.clone(),
                *color,
            );
            if close_hovered {
                painter.rect_filled(close_rect, t.radius.small, t.button_hover);
            }
            icons::paint(
                painter,
                close_rect.shrink(2.0),
                Icon::Close,
                if close_hovered {
                    t.icon_active
                } else {
                    t.text_dim
                },
            );
        };
        if is_dragged {
            floating = Some(paint);
        } else {
            paint(ui.painter());
        }
        if fw.drag.is_some() || drop.is_some() {
            continue;
        }
        if close_resp.on_hover_text("Close").clicked() {
            close = Some(i);
        } else if crate::clicks::pressed(&resp) && !close_rect.contains(pointer.unwrap_or(rect.min))
        {
            activate = Some(i);
        }
    }
    if let Some(paint) = floating {
        paint(ui.painter());
    }
    if fw.drag.is_some() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::Grabbing);
    }
    if let Some((from, to)) = drop {
        fw.move_tab(from, to);
    }
    if let Some(i) = activate {
        fw.active = i;
    }
    if let Some(i) = close {
        close_tab(state, i);
    }
}

// ---------------------------------------------------------------------------------------------
// Body

/// What the body asks for after the active tab is back in the list.
enum Action {
    Open(PathBuf, Position),
    Rerun,
}

/// The Find tool window body: toolbar, result tree, preview.
pub fn show(state: &mut AppState, ui: &mut Ui) {
    let fw = &mut state.ws.find_window;
    if fw.tabs.is_empty() {
        ui.label(
            RichText::new("Find Usages (⌥F7) and Find in Files (⇧⌘F) results show here")
                .color(T.text_dim),
        );
        return;
    }
    fw.active = fw.active.min(fw.tabs.len() - 1);
    let index = fw.active;
    // The tab is lent to the body, so the preview can take `&mut AppState`.
    let mut tab = fw.tabs.remove(index);
    let actions = body(state, ui, &mut tab);
    let fw = &mut state.ws.find_window;
    let at = index.min(fw.tabs.len());
    fw.tabs.insert(at, tab);
    for a in actions {
        match a {
            Action::Open(path, pos) => state.open_location(&path, Some(pos), true),
            Action::Rerun => rerun(state, state.ws.find_window.tabs[at].id),
        }
    }
}

fn body(state: &mut AppState, ui: &mut Ui, tab: &mut FindTab) -> Vec<Action> {
    let t = &T;
    let root = project_root(state);
    let mut actions = Vec::new();
    let full = ui.available_rect_before_wrap();
    ui.allocate_rect(full, Sense::hover());
    let bar_w = t.space.strip_button;
    let bar = Rect::from_min_max(full.min, pos2(full.min.x + bar_w, full.max.y));
    let mut bar_ui = ui.new_child(
        UiBuilder::new()
            .max_rect(bar)
            .layout(egui::Layout::top_down(egui::Align::Center)),
    );
    bar_ui.spacing_mut().item_spacing.y = 2.0;
    let has_items = !tab.items.is_empty();
    if layout::icon_button_enabled(&mut bar_ui, !tab.searching, Icon::Refresh, "Rerun", "Rerun")
        .clicked()
    {
        actions.push(Action::Rerun);
    }
    if layout::icon_button_enabled(
        &mut bar_ui,
        has_items,
        Icon::ArrowUp,
        "Previous Occurrence",
        "Previous Occurrence",
    )
    .clicked()
    {
        tab.step(&root, -1);
    }
    if layout::icon_button_enabled(
        &mut bar_ui,
        has_items,
        Icon::ArrowDown,
        "Next Occurrence",
        "Next Occurrence",
    )
    .clicked()
    {
        tab.step(&root, 1);
    }
    if layout::icon_button_enabled(
        &mut bar_ui,
        has_items,
        Icon::ExpandAll,
        "Expand All",
        "Expand All",
    )
    .clicked()
    {
        tab.expand_all();
    }
    if layout::icon_button_enabled(
        &mut bar_ui,
        has_items,
        Icon::CollapseAll,
        "Collapse All",
        "Collapse All",
    )
    .clicked()
    {
        tab.collapse_all(&root);
    }

    let rest = Rect::from_min_max(pos2(bar.max.x + 4.0, full.min.y), full.max);
    let mut rest_ui = ui.new_child(
        UiBuilder::new()
            .max_rect(rest)
            .layout(egui::Layout::top_down(egui::Align::Min)),
    );
    let half = (rest.width() * 0.45).max(160.0);
    egui::SidePanel::right(wid("find-preview"))
        .resizable(true)
        .default_width(half)
        .width_range(160.0..=(rest.width() - 200.0).max(161.0))
        .show_separator_line(true)
        .frame(Frame::NONE.inner_margin(Margin {
            left: 6,
            ..Margin::ZERO
        }))
        .show_inside(&mut rest_ui, |ui| {
            preview::show(state, &mut tab.preview, ui)
        });
    // The right margin keeps the tree's scroll bar out of the splitter's grab area.
    egui::CentralPanel::default()
        .frame(Frame::NONE.inner_margin(Margin {
            right: 6,
            ..Margin::ZERO
        }))
        .show_inside(&mut rest_ui, |ui| {
            let clicks = state.clicks;
            tree(ui, &root, tab, clicks, &mut actions);
        });
    actions
}

fn tree(
    ui: &mut Ui,
    root: &Path,
    tab: &mut FindTab,
    clicks: crate::clicks::Clicks,
    actions: &mut Vec<Action>,
) {
    let t = &T;
    if tab.searching && tab.items.is_empty() {
        ui.horizontal(|ui| {
            ui.spinner();
            ui.label(RichText::new("Searching...").color(t.text_dim));
        });
        return;
    }
    if let Some(e) = &tab.error {
        ui.label(RichText::new(e).color(t.error));
        return;
    }
    if tab.items.is_empty() {
        let text = if tab.is_usages() {
            "No usages found"
        } else {
            "Nothing found"
        };
        ui.label(RichText::new(text).color(t.text_dim));
        return;
    }
    if tab.truncated {
        let cap = crate::find::FIND_WINDOW_CAP;
        ui.label(
            RichText::new(format!("{cap}+ results, showing the first {cap} found"))
                .color(t.text_dim),
        );
    }
    let focus_id = wid(("find-tree", tab.id));
    let viewport = ui.available_rect_before_wrap();
    let focus = ui.interact(viewport, focus_id, Sense::focusable_noninteractive());
    crate::util::label_widget(&focus, egui::WidgetType::Other, "Find results");
    let focused = focus.has_focus();
    let menu_open = ui.ctx().is_context_menu_open();
    if focused && !menu_open {
        keyboard(ui, root, tab, actions);
    }

    let row_h = t.space.row_h;
    let rows: Vec<Row> = tab.rows(root).to_vec();
    let mut area = ScrollArea::vertical()
        .auto_shrink([false, false])
        .id_salt(("find-tree-scroll", tab.id));
    if std::mem::take(&mut tab.reveal) {
        if let Some(i) = tab
            .selected
            .as_ref()
            .and_then(|s| rows.iter().position(|r| &r.key == s))
        {
            let (off, view) = tab.view;
            let top = i as f32 * row_h;
            if top < off {
                area = area.vertical_scroll_offset(top);
            } else if top + row_h > off + view && view > 0.0 {
                area = area.vertical_scroll_offset(top + row_h - view);
            }
        }
    }
    ui.spacing_mut().item_spacing.y = 0.0;
    let mut pressed_row = None;
    let mut toggle = None;
    let mut open = None;
    let out = area.show_rows(ui, row_h, rows.len(), |ui, range| {
        for row in &rows[range] {
            let (_, rect) = ui.allocate_space(vec2(ui.available_width(), row_h));
            let resp = ui.interact(rect, wid(("find-row", tab.id, &row.key)), Sense::click());
            let selected = tab.selected.as_ref() == Some(&row.key);
            crate::util::label_selectable(&resp, row_label(root, tab, row), selected);
            let painter = ui.painter();
            if selected {
                painter.rect_filled(
                    rect,
                    t.radius.row,
                    if focused {
                        t.tree_selection
                    } else {
                        t.tree_selection_inactive
                    },
                );
            } else if resp.hovered() {
                painter.rect_filled(rect, t.radius.row, t.tree_hover);
            }
            let x = rect.min.x + 4.0 + row.depth as f32 * t.space.indent;
            let cy = rect.center().y;
            let chevron_cell = row
                .expandable()
                .then(|| Rect::from_min_max(pos2(x - 2.0, rect.min.y), pos2(x + 14.0, rect.max.y)));
            if row.expandable() {
                icons::tree_chevron(painter, pos2(x + 6.0, cy), row.expanded, t.tree_chevron);
            }
            paint_row(ui, rect, x + 16.0, row, tab);
            let on_chevron = chevron_cell
                .zip(resp.interact_pointer_pos())
                .is_some_and(|(c, p)| c.contains(p));
            if crate::clicks::pressed(&resp) {
                pressed_row = Some(row.key.clone());
                if on_chevron {
                    toggle = Some(row.key.clone());
                }
            }
            if clicks.double(&resp) && !on_chevron {
                match row.kind {
                    RowKind::Item(i) => open = Some(i),
                    _ => toggle = Some(row.key.clone()),
                }
            }
        }
    });
    tab.view = (out.state.offset.y, out.inner_rect.height());
    if let Some(key) = pressed_row {
        // A press on a row drops egui's focus from the tree; take it back on the press frame.
        ui.memory_mut(|m| m.request_focus(focus_id));
        if tab.selected.as_ref() != Some(&key) {
            tab.select(key);
            tab.reveal = false;
        }
    }
    if let Some(key) = toggle {
        tab.toggle(&key);
    }
    if let Some(i) = open {
        if let Some(item) = tab.items.get(i) {
            actions.push(Action::Open(
                item.path.clone(),
                Position::new(item.line, item.column),
            ));
        }
    }
}

fn keyboard(ui: &mut Ui, root: &Path, tab: &mut FindTab, actions: &mut Vec<Action>) {
    let (up, down, left, right, enter, delete) = ui.input_mut(|i| {
        let none = egui::Modifiers::NONE;
        (
            i.consume_key(none, Key::ArrowUp),
            i.consume_key(none, Key::ArrowDown),
            i.consume_key(none, Key::ArrowLeft),
            i.consume_key(none, Key::ArrowRight),
            i.consume_key(none, Key::Enter),
            i.consume_key(none, Key::Delete) || i.consume_key(none, Key::Backspace),
        )
    });
    let rows: Vec<Row> = tab.rows(root).to_vec();
    let at = tab
        .selected
        .as_ref()
        .and_then(|s| rows.iter().position(|r| &r.key == s));
    if up || down {
        let next = match at {
            Some(i) if up => i.saturating_sub(1),
            Some(i) => (i + 1).min(rows.len().saturating_sub(1)),
            None => 0,
        };
        if let Some(r) = rows.get(next) {
            tab.select(r.key.clone());
        }
    }
    let Some(row) = at.and_then(|i| rows.get(i)) else {
        return;
    };
    if left {
        if row.expandable() && row.expanded {
            tab.toggle(&row.key);
        } else if let Some(p) = row.parent.clone() {
            tab.select(p);
        }
    }
    if right && row.expandable() && !row.expanded {
        tab.toggle(&row.key);
    }
    if enter {
        match row.kind {
            RowKind::Item(i) => {
                let item = &tab.items[i];
                actions.push(Action::Open(
                    item.path.clone(),
                    Position::new(item.line, item.column),
                ));
            }
            _ => tab.toggle(&row.key),
        }
    }
    if delete {
        tab.exclude(root, &row.key.clone());
    }
}

/// The accessibility label of a row; tests find rows by it.
fn row_label(root: &Path, tab: &FindTab, row: &Row) -> String {
    match &row.kind {
        RowKind::Group(k) => format!("{} group", k.title()),
        // Folders and files repeat in every usage group: the group goes into the label.
        RowKind::Dir(_) => match &row.key {
            NodeKey::Dir(k, full) => format!("Find folder {full}{}", in_group(*k)),
            _ => String::new(),
        },
        RowKind::File(_) => match &row.key {
            NodeKey::File(k, path) => {
                format!("Find file {}{}", rows::display(root, path), in_group(*k))
            }
            _ => String::new(),
        },
        // Two results can share a line: the column makes the label unique.
        RowKind::Item(i) => {
            let item = &tab.items[*i];
            format!(
                "{}:{}:{}",
                rows::display(root, &item.path),
                item.line + 1,
                item.column + 1
            )
        }
    }
}

fn in_group(kind: Option<UsageKind>) -> String {
    kind.map(|k| format!(" in {}", k.title()))
        .unwrap_or_default()
}

fn paint_row(ui: &Ui, rect: Rect, x: f32, row: &Row, tab: &FindTab) {
    let t = &T;
    let painter = ui.painter().with_clip_rect(rect.intersect(ui.clip_rect()));
    let cy = rect.center().y;
    let mut job = LayoutJob::default();
    let text = |color| TextFormat {
        font_id: t.ui_font(),
        color,
        ..Default::default()
    };
    let mut text_x = x + 18.0;
    match &row.kind {
        RowKind::Group(_) => {
            icons::paint(
                &painter,
                Rect::from_center_size(pos2(x + 7.0, cy), egui::Vec2::splat(14.0)),
                Icon::Usages,
                t.icon,
            );
        }
        RowKind::Dir(_) => icons::folder(&painter, pos2(x + 7.0, cy), 15.0),
        RowKind::File(name) => icons::file(&painter, pos2(x + 7.0, cy), 14.0, name),
        RowKind::Item(_) => text_x = x,
    }
    match &row.kind {
        RowKind::Group(k) => job.append(k.title(), 0.0, text(t.text_bright)),
        RowKind::Dir(label) | RowKind::File(label) => job.append(label, 0.0, text(t.text_bright)),
        RowKind::Item(i) => {
            let item = &tab.items[*i];
            job.append(&format!("{}", item.line + 1), 0.0, text(t.text_dim));
            let chars: Vec<char> = item.line_text.chars().collect();
            let lead = chars.iter().take_while(|c| c.is_whitespace()).count();
            let s = item.column.clamp(lead, chars.len());
            let e = item.end_column.clamp(s, chars.len());
            let before: String = chars[lead..s].iter().collect();
            let found: String = chars[s..e].iter().collect();
            let after: String = chars[e..].iter().collect();
            job.append(&before, 8.0, text(t.text));
            job.append(
                &found,
                0.0,
                TextFormat {
                    font_id: t.semibold(t.font.ui),
                    color: t.text_bright,
                    ..Default::default()
                },
            );
            job.append(&after, 0.0, text(t.text));
        }
    }
    if !matches!(row.kind, RowKind::Item(_)) {
        job.append(&rows::results(row.count), 10.0, text(t.text_dim));
    }
    job.wrap.max_rows = 1;
    let galley = ui.fonts(|f| f.layout_job(job));
    painter.galley(pos2(text_x, cy - galley.size().y / 2.0), galley, t.text);
}
