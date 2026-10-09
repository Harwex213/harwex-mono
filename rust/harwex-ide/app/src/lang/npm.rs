//! Completion in `package.json` (IDEA's): package names in the keys of the dependency
//! sections, and versions with `^`/`~` and the dist-tags in their values.
//!
//! - `context` finds the string under the caret (pure).
//! - `registry` reads `.npmrc`, asks the registry through `curl` and keeps the disk cache
//!   (`<root>/.harwex/cache/npm`); it runs only on workers.
//! - `versions` orders versions and builds the version rows (pure).
//!
//! The popup opens while the user types in such a string, or on Ctrl+Space. Its keys are taken
//! at the start of the frame (`take_keys`), so the editor never sees them.

pub mod context;
pub mod registry;
pub mod versions;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use egui::{Context, Key, Modifiers, Pos2, Sense, Vec2};
use ide_editor::{Carets, EditKind, Selection};

use crate::state::AppState;
use crate::tabs::TabId;
use crate::theme;

use context::{Site, Slot};
pub use registry::SearchHit;
pub use versions::{Item, PackageInfo};

/// The pause after the last typed char before a name search goes out.
pub const SEARCH_DEBOUNCE: Duration = Duration::from_millis(150);
/// A failed request is asked again after this.
const RETRY_FAILED: Duration = Duration::from_secs(30);
/// Bigger files are not scanned: no real `package.json` is that big.
const MAX_FILE_CHARS: usize = 512 * 1024;
const ROW_H: f32 = 22.0;
const VISIBLE_ROWS: usize = 10;
const POPUP_W: f32 = 380.0;
/// The label's inset in a row, and the popup frame's inner margin.
const ROW_TEXT_X: f32 = 6.0;
const FRAME_MARGIN: f32 = 4.0;

#[derive(Clone, Debug)]
pub enum Fetch<T> {
    Loading,
    Ready(Arc<T>),
    Failed(String),
}

#[derive(Clone, Debug)]
struct Entry<T> {
    state: Fetch<T>,
    at: Instant,
}

impl<T> Entry<T> {
    /// A new request is due: nothing yet, an old answer, or a failure some time ago.
    fn due(e: Option<&Entry<T>>) -> bool {
        match e {
            None => true,
            Some(Entry { state: Fetch::Loading, .. }) => false,
            Some(Entry { state: Fetch::Ready(_), at }) => at.elapsed() > registry::FRESH,
            Some(Entry { state: Fetch::Failed(_), at }) => at.elapsed() > RETRY_FAILED,
        }
    }
}

/// What the popup shows when it has no rows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    Loading,
    Empty,
    Failed(String),
}

/// The open completion popup.
pub struct Popup {
    pub tab: TabId,
    pub site: Site,
    pub items: Vec<Item>,
    pub selected: usize,
    pub status: Status,
    /// The doc version and caret the site was found at.
    version: u64,
    caret: usize,
    /// `NpmState::generation` the rows were built from.
    built: u64,
    /// Below the caret, in screen points.
    anchor: Pos2,
    /// As drawn last frame.
    rect: egui::Rect,
    /// The first visible row, in points; set when the keys move the selection.
    scroll: f32,
    scroll_pending: bool,
    /// The name search waits for the typing to pause.
    search_due: Option<Instant>,
}

/// Per workspace: the popup and the answers of the registry, in memory.
#[derive(Default)]
pub struct NpmState {
    pub popup: Option<Popup>,
    packages: HashMap<String, Entry<PackageInfo>>,
    searches: HashMap<String, Entry<Vec<SearchHit>>>,
    /// Bumped when an answer lands, so the popup rebuilds its rows.
    generation: u64,
    /// Ctrl+Space was pressed this frame.
    manual: bool,
    /// The active editor had the focus last frame.
    editor_focused: bool,
    /// Registry requests started, for tests.
    pub requests: u64,
}

impl NpmState {
    /// The memory-cached versions of `name`, if loaded.
    pub fn package(&self, name: &str) -> Option<&Fetch<PackageInfo>> {
        self.packages.get(name).map(|e| &e.state)
    }

    /// The labels of the open popup's rows.
    pub fn labels(&self) -> Vec<String> {
        self.popup.as_ref().map(|p| p.items.iter().map(|i| i.label.clone()).collect()).unwrap_or_default()
    }
}

pub fn is_package_json(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n == "package.json")
}

/// Takes the popup's keys (and Ctrl+Space) before the editor runs.
pub fn take_keys(s: &mut AppState, ctx: &Context) {
    let npm = &mut s.ws.npm;
    if npm.editor_focused && s.ws.tabs.active_editor().is_some_and(|e| is_package_json(&e.path) && !e.read_only) {
        npm.manual = ctx.input_mut(|i| i.consume_key(Modifiers::CTRL, Key::Space));
    }
    let Some(p) = &mut npm.popup else { return };
    if !npm.editor_focused {
        return;
    }
    let has_items = !p.items.is_empty();
    let (esc, up, down, page_up, page_down, accept) = ctx.input_mut(|i| {
        let esc = i.consume_key(Modifiers::NONE, Key::Escape);
        if !has_items {
            return (esc, false, false, false, false, false);
        }
        (
            esc,
            i.consume_key(Modifiers::NONE, Key::ArrowUp),
            i.consume_key(Modifiers::NONE, Key::ArrowDown),
            i.consume_key(Modifiers::NONE, Key::PageUp),
            i.consume_key(Modifiers::NONE, Key::PageDown),
            i.consume_key(Modifiers::NONE, Key::Enter) | i.consume_key(Modifiers::NONE, Key::Tab),
        )
    });
    if esc {
        npm.popup = None;
        return;
    }
    let last = p.items.len().saturating_sub(1);
    let before = p.selected;
    if up {
        p.selected = if p.selected == 0 { last } else { p.selected - 1 };
    }
    if down {
        p.selected = if p.selected >= last { 0 } else { p.selected + 1 };
    }
    if page_up {
        p.selected = p.selected.saturating_sub(VISIBLE_ROWS - 1);
    }
    if page_down {
        p.selected = (p.selected + VISIBLE_ROWS - 1).min(last);
    }
    if p.selected != before {
        p.scroll_pending = true;
    }
    if accept {
        let i = p.selected;
        apply(s, i);
    }
}

/// Called after the active editor tab drew: opens, updates or closes the popup.
pub fn after_editor(s: &mut AppState, tab: TabId, changed: bool, has_focus: bool) {
    let ctx = s.ctx.clone();
    // A press on the popup takes the focus from the editor before the row sees it.
    let has_focus = has_focus || s.ws.npm.popup.as_ref().is_some_and(|p| pointer_on(&ctx, p.rect));
    s.ws.npm.editor_focused = has_focus;
    let manual = std::mem::take(&mut s.ws.npm.manual);
    let typed = changed && ctx.input(|i| i.events.iter().any(|e| matches!(e, egui::Event::Text(_))));
    let open = s.ws.npm.popup.as_ref().is_some_and(|p| p.tab == tab);
    if !open {
        s.ws.npm.popup = None;
        if !(typed || manual) {
            return;
        }
    }
    let root = s.ws.project.as_ref().map(|p| p.root.clone());
    let Some(e) = s.ws.tabs.editor_mut(tab) else {
        s.ws.npm.popup = None;
        return;
    };
    if !is_package_json(&e.path) || e.read_only || !has_focus || e.view.carets().len() > 1 || e.doc.len_chars() > MAX_FILE_CHARS {
        s.ws.npm.popup = None;
        return;
    }
    let version = e.doc.version();
    let caret = e.view.caret_char(&e.doc);
    let caret_rect = e.view.caret_rect();
    let dir = e.path.parent().map(Path::to_path_buf).unwrap_or_default();
    let npm = &mut s.ws.npm;
    let same = npm.popup.as_ref().is_some_and(|p| p.version == version && p.caret == caret);
    if !same {
        let site = context::site_at(&e.doc.text(), caret).filter(wanted);
        let Some(site) = site else {
            npm.popup = None;
            return;
        };
        // The row text lines up with the string's first char, like IDEA's lookup.
        let start_x = e.view.geometry().and_then(|g| Some(e.view.char_center(&e.doc, e.doc.char_to_position(site.content.start))?.x - g.char_w / 2.0));
        let anchor = match caret_rect {
            Some(r) => Pos2::new(start_x.unwrap_or(r.left()) - ROW_TEXT_X - FRAME_MARGIN - 1.0, r.bottom() + 2.0),
            None => {
                npm.popup = None;
                return;
            }
        };
        let query_changed = npm.popup.as_ref().is_none_or(|p| p.site.prefix != site.prefix || p.site.slot != site.slot);
        let p = npm.popup.get_or_insert_with(|| Popup {
            tab,
            site: site.clone(),
            items: Vec::new(),
            selected: 0,
            status: Status::Loading,
            version,
            caret,
            built: u64::MAX,
            anchor,
            rect: egui::Rect::NOTHING,
            scroll: 0.0,
            scroll_pending: false,
            search_due: None,
        });
        p.site = site;
        p.version = version;
        p.caret = caret;
        p.anchor = anchor;
        if query_changed {
            p.built = u64::MAX;
            p.search_due = matches!(p.site.slot, Slot::Name).then(|| Instant::now() + if manual { Duration::ZERO } else { SEARCH_DEBOUNCE });
        }
    }
    let Some(root) = root else { return };
    request(s, &root, &dir, &ctx);
    rebuild(&mut s.ws.npm);
}

/// The strings that get completion: a typed name, or a version that is not a path, URL,
/// alias or workspace protocol.
fn wanted(site: &Site) -> bool {
    match &site.slot {
        Slot::Name => !site.prefix.trim().is_empty(),
        Slot::Version { package } => !package.is_empty() && !site.prefix.contains([':', '/']),
    }
}

/// Starts the registry request the popup needs, unless it is cached or in flight.
fn request(s: &mut AppState, root: &Path, dir: &Path, ctx: &Context) {
    let Some(p) = &mut s.ws.npm.popup else { return };
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let (root, dir) = (root.to_path_buf(), dir.to_path_buf());
    match p.site.slot.clone() {
        Slot::Version { package } => {
            if !Entry::due(s.ws.npm.packages.get(&package)) {
                return;
            }
            s.ws.npm.packages.insert(package.clone(), Entry { state: Fetch::Loading, at: Instant::now() });
            s.ws.npm.requests += 1;
            s.jobs.spawn_quiet(
                move || registry::load_package(&root, &dir, &package, home.as_deref()).map(|info| (package.clone(), info)).map_err(|e| (package, e)),
                |state, res| {
                    let (name, entry) = match res {
                        Ok((name, info)) => (name, Fetch::Ready(Arc::new(info))),
                        Err((name, e)) => (name, Fetch::Failed(e)),
                    };
                    let npm = &mut state.ws.npm;
                    npm.packages.insert(name, Entry { state: entry, at: Instant::now() });
                    npm.generation += 1;
                },
            );
        }
        Slot::Name => {
            let query = p.site.prefix.clone();
            if !Entry::due(s.ws.npm.searches.get(&query)) {
                p.search_due = None;
                return;
            }
            let Some(due) = p.search_due else { return };
            let now = Instant::now();
            if due > now {
                ctx.request_repaint_after(due - now);
                return;
            }
            p.search_due = None;
            let npm = &mut s.ws.npm;
            // Every typed prefix leaves an entry; the map never needs to grow without bound.
            if npm.searches.len() > 256 {
                npm.searches.retain(|_, e| matches!(e.state, Fetch::Loading));
            }
            npm.searches.insert(query.clone(), Entry { state: Fetch::Loading, at: now });
            npm.requests += 1;
            s.jobs.spawn_quiet(
                move || {
                    let res = registry::search_names(&root, &dir, &query, home.as_deref());
                    (query, res)
                },
                |state, (query, res)| {
                    let entry = match res {
                        Ok(hits) => Fetch::Ready(Arc::new(hits)),
                        Err(e) => Fetch::Failed(e),
                    };
                    let npm = &mut state.ws.npm;
                    npm.searches.insert(query, Entry { state: entry, at: Instant::now() });
                    npm.generation += 1;
                },
            );
        }
    }
}

/// Rebuilds the popup's rows when the query or a registry answer changed.
fn rebuild(npm: &mut NpmState) {
    let generation = npm.generation;
    let Some(p) = &mut npm.popup else { return };
    if p.built == generation {
        return;
    }
    p.built = generation;
    let (items, status) = match &p.site.slot {
        Slot::Version { package } => match npm.packages.get(package).map(|e| &e.state) {
            Some(Fetch::Ready(info)) => (versions::version_items(info, &p.site.prefix), Status::Empty),
            Some(Fetch::Failed(e)) => (Vec::new(), Status::Failed(e.clone())),
            Some(Fetch::Loading) | None => (Vec::new(), Status::Loading),
        },
        Slot::Name => match npm.searches.get(&p.site.prefix).map(|e| &e.state) {
            Some(Fetch::Ready(hits)) => (name_items(hits, &p.site.prefix), Status::Empty),
            Some(Fetch::Failed(e)) => (Vec::new(), Status::Failed(e.clone())),
            Some(Fetch::Loading) | None => (Vec::new(), Status::Loading),
        },
    };
    // The selection stays on the same row while it is still listed.
    let keep = p.items.get(p.selected).and_then(|old| items.iter().position(|i| i.label == old.label));
    p.selected = keep.unwrap_or(0);
    p.scroll_pending = true;
    p.items = items;
    p.status = status;
}

/// Search hits, the exact name first, then names that start with the query, then the rest in
/// the registry's order.
fn name_items(hits: &[SearchHit], query: &str) -> Vec<Item> {
    let rank = |h: &SearchHit| {
        if h.name == query {
            0
        } else if h.name.starts_with(query) {
            1
        } else {
            2
        }
    };
    let mut hits: Vec<&SearchHit> = hits.iter().collect();
    // Among the names that start with the query, the shorter one is the closer match.
    hits.sort_by_key(|h| match rank(h) {
        1 => (1, h.name.len()),
        r => (r, 0),
    });
    hits.into_iter().map(|h| Item { label: h.name.clone(), detail: h.version.clone() }).collect()
}

/// Replaces the string under the caret with row `index` and closes the popup.
fn apply(s: &mut AppState, index: usize) {
    let Some(p) = s.ws.npm.popup.take() else { return };
    let Some(item) = p.items.get(index) else { return };
    let Some(e) = s.ws.tabs.editor_mut(p.tab) else { return };
    if e.doc.version() != p.version {
        return;
    }
    let range = if p.site.closed { p.site.content.clone() } else { p.site.content.start..p.site.content.end.max(p.caret) };
    // An unclosed string gets its quote; the caret lands after it, like IDEA's.
    let text = format!("{}\"", item.label);
    let edit = if p.site.closed { range.start..range.end + 1 } else { range };
    let after = edit.start + text.chars().count();
    e.doc.edit(edit, &text, Selection::caret(p.caret), Selection::caret(after), EditKind::Other);
    e.view.set_carets(Carets::single(Selection::caret(after)));
    e.view.request_focus();
}

/// Draws the popup under the caret. Runs after the editor area.
pub fn show_popup(s: &mut AppState, ctx: &Context) {
    let active = s.ws.tabs.active;
    let focused = s.ws.npm.editor_focused;
    let Some(p) = &mut s.ws.npm.popup else { return };
    if Some(p.tab) != active || !focused {
        s.ws.npm.popup = None;
        return;
    }
    let t = &theme::T;
    let rows = p.items.len().clamp(1, VISIBLE_ROWS);
    let list_h = rows as f32 * ROW_H;
    let mut chosen = None;
    let area = egui::Area::new(crate::workspace::wid("npm-completion"))
        .fixed_pos(p.anchor)
        .order(egui::Order::Foreground)
        .constrain(true)
        .default_size(Vec2::new(POPUP_W, list_h + 8.0))
        .show(ctx, |ui| {
            egui::Frame::popup(ui.style()).fill(t.popup_bg).inner_margin(FRAME_MARGIN).show(ui, |ui| {
                ui.set_width(POPUP_W);
                if p.items.is_empty() {
                    let text = match &p.status {
                        Status::Loading => "Loading…".to_string(),
                        Status::Empty => "No suggestions".to_string(),
                        Status::Failed(e) => format!("npm registry: {e}"),
                    };
                    let (rect, resp) = ui.allocate_exact_size(Vec2::new(POPUP_W, ROW_H), Sense::hover());
                    ui.painter().text(rect.left_center() + Vec2::new(ROW_TEXT_X, 0.0), egui::Align2::LEFT_CENTER, &text, egui::FontId::proportional(t.font.ui), t.text_dim);
                    crate::util::label_widget(&resp, egui::WidgetType::Label, format!("Completion status {text}"));
                    return;
                }
                // Rows touch: `list_h` counts no spacing, and `show_rows` reads it from here.
                ui.spacing_mut().item_spacing.y = 0.0;
                // The Area offers last frame's size; a list that grew since then asks for its
                // whole height.
                let mut sa = egui::ScrollArea::vertical().id_salt("npm-completion-rows").max_height(list_h).min_scrolled_height(list_h).auto_shrink([false, true]);
                if p.scroll_pending {
                    let top = p.selected as f32 * ROW_H;
                    if top < p.scroll {
                        p.scroll = top;
                    } else if top + ROW_H > p.scroll + list_h {
                        p.scroll = top + ROW_H - list_h;
                    }
                    sa = sa.vertical_scroll_offset(p.scroll);
                    p.scroll_pending = false;
                }
                let out = sa.show_rows(ui, ROW_H, p.items.len(), |ui, range| {
                    for i in range {
                        // On the press: the press takes the focus from the editor, and the
                        // popup closes with it before a release could count as a click.
                        if row(ui, &p.items[i], i == p.selected).is_pointer_button_down_on() {
                            chosen = Some(i);
                        }
                    }
                });
                p.scroll = out.state.offset.y;
            });
        });
    p.rect = area.response.rect;
    let pressed_outside = ctx.input(|i| i.pointer.any_pressed()) && !area.response.contains_pointer();
    if let Some(i) = chosen {
        apply(s, i);
    } else if pressed_outside {
        s.ws.npm.popup = None;
    }
}

/// The pointer is pressed or held inside `rect`.
fn pointer_on(ctx: &Context, rect: egui::Rect) -> bool {
    ctx.input(|i| (i.pointer.any_pressed() || i.pointer.any_down()) && i.pointer.interact_pos().is_some_and(|p| rect.contains(p)))
}

fn row(ui: &mut egui::Ui, item: &Item, selected: bool) -> egui::Response {
    let t = &theme::T;
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(ui.available_width(), ROW_H), Sense::click());
    let painter = ui.painter();
    if selected {
        painter.rect_filled(rect, t.radius.row, t.selection);
    } else if resp.hovered() {
        painter.rect_filled(rect, t.radius.row, t.hover);
    }
    let detail_w = if item.detail.is_empty() {
        0.0
    } else {
        let g = painter.layout_no_wrap(item.detail.clone(), egui::FontId::proportional(t.font.small), t.text_dim);
        let w = g.size().x;
        painter.galley(egui::pos2(rect.right() - 8.0 - w, rect.center().y - g.size().y / 2.0), g, t.text_dim);
        w + 16.0
    };
    let label = painter.layout(item.label.clone(), egui::FontId::monospace(t.font.mono), t.text_bright, f32::INFINITY);
    let clip = egui::Rect::from_min_max(rect.min, egui::pos2(rect.right() - detail_w, rect.max.y));
    painter.with_clip_rect(clip.intersect(painter.clip_rect())).galley(egui::pos2(rect.left() + ROW_TEXT_X, rect.center().y - label.size().y / 2.0), label, t.text_bright);
    crate::util::label_selectable(&resp, format!("Completion {}", item.label), selected);
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_and_prefix_names_first() {
        let hit = |n: &str| SearchHit { name: n.into(), version: "1.0.0".into(), description: String::new() };
        let items = name_items(&[hit("preact"), hit("react-dom"), hit("react")], "react");
        assert_eq!(items.iter().map(|i| i.label.as_str()).collect::<Vec<_>>(), ["react", "react-dom", "preact"]);
        let items = name_items(&[hit("preact"), hit("react-dom"), hit("react")], "rea");
        assert_eq!(items.iter().map(|i| i.label.as_str()).collect::<Vec<_>>(), ["react", "react-dom", "preact"]);
    }
}
