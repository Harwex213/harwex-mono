//! Breadcrumbs on the left of the status bar, like IDEA: the active tab's file as
//! `root › dir › dir › file`. A click on a segment opens a popup with that directory's children.
//! Directories in the popup open nested popups. A click on a file opens it.
//!
//! Keyboard, like IDEA's navigation bar: Alt+Home focuses the bar with the file segment
//! selected. Left/Right move between segments, Down or Enter opens a segment's popup. In a popup,
//! Left/Right at the first level hop to the neighbouring segment's popup. While the bar or a
//! popup has the keyboard, `take_keys` consumes the arrows before any widget sees them.
//!
//! Listings run on a worker through `tree::list_dir`, so `.gitignore` applies like in the
//! project tree. Icons come from `icons`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use egui::{pos2, vec2, Align2, Vec2, Color32, Context, FontId, Id, Key, Painter, Pos2, Rect, ScrollArea, Sense, Stroke, Ui};

use crate::icons::{self, Icon};
use crate::state::AppState;
use crate::theme;
use crate::tree::{self, Entry};

const ICON_W: f32 = 18.0;
const PAD: f32 = 4.0;
const SEP_W: f32 = 16.0;
const ELLIPSIS_W: f32 = 22.0;
const ROW_H: f32 = 20.0;
/// A popup level shows at most this many rows; longer lists scroll.
pub const MAX_ROWS: usize = 18;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SegmentKind {
    Root,
    /// The root of a file outside the project: a library label like `std` or `serde 1.0.228`.
    Library,
    Dir,
    File,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub path: PathBuf,
    pub name: String,
    pub kind: SegmentKind,
}

/// Where the breadcrumbs of a file outside the project start, like IDEA's "External Libraries".
/// The label never contains the location of the library on disk, so the bar looks the same on
/// every machine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalRoot {
    pub dir: PathBuf,
    pub label: String,
}

/// A generic external file shows at most this many path segments, the file included.
const EXTERNAL_SEGMENTS: usize = 3;

/// The library root of `file`, a file outside the project:
/// - rust-src (`…/rust/library/<crate>/src/…`): `<crate>`, rooted at the crate's `src`.
/// - a Cargo registry (`…/registry/src/<index>/<crate>-<version>/…`): `<crate> <version>`.
/// - a package under `node_modules`: `<package>` or `@scope/<package>`.
/// - anything else: `External`, rooted so that at most `EXTERNAL_SEGMENTS` segments follow.
pub fn external_root(file: &Path) -> ExternalRoot {
    let comps: Vec<_> = file.components().collect();
    let name = |i: usize| comps[i].as_os_str().to_string_lossy();
    let dir = |end: usize| comps[..=end].iter().collect::<PathBuf>();
    let n = comps.len();
    // Each pattern needs the file to lie strictly below its root directory.
    let below = |end: usize| end + 1 < n;
    if let Some(i) = (1..n).rev().find(|&i| name(i) == "library" && name(i - 1) == "rust" && i + 2 < n && name(i + 2) == "src" && below(i + 2)) {
        return ExternalRoot { dir: dir(i + 2), label: name(i + 1).into_owned() };
    }
    if let Some(i) = (0..n).rev().find(|&i| name(i) == "registry" && i + 3 < n && name(i + 1) == "src" && below(i + 3)) {
        let folder = name(i + 3);
        let label = split_crate_version(&folder).map_or_else(|| folder.to_string(), |(c, v)| format!("{c} {v}"));
        return ExternalRoot { dir: dir(i + 3), label };
    }
    if let Some(i) = (0..n).rev().find(|&i| name(i) == "node_modules" && below(i + 1)) {
        let package = name(i + 1);
        if package.starts_with('@') && below(i + 2) {
            return ExternalRoot { dir: dir(i + 2), label: format!("{package}/{}", name(i + 2)) };
        }
        return ExternalRoot { dir: dir(i + 1), label: package.into_owned() };
    }
    // Keep at least the first component (`/`), so the root is a real directory.
    let end = n.saturating_sub(EXTERNAL_SEGMENTS + 1);
    ExternalRoot { dir: comps[..(end + 1).min(n)].iter().collect(), label: "External".to_string() }
}

/// Splits a registry folder name `<crate>-<version>` at the `-` that starts the version. Crate
/// names may hold `-` and digits (`md-5-0.10.6`), so the version is the first suffix that looks
/// like `<major>.<minor>.<patch>`.
fn split_crate_version(folder: &str) -> Option<(&str, &str)> {
    folder.match_indices('-').map(|(i, _)| (&folder[..i], &folder[i + 1..])).find(|(c, v)| {
        let mut parts = v.splitn(3, '.');
        let numeric = |p: Option<&str>| p.is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
        let patch = |p: Option<&str>| p.is_some_and(|p| p.bytes().next().is_some_and(|b| b.is_ascii_digit()));
        !c.is_empty() && numeric(parts.next()) && numeric(parts.next()) && patch(parts.next())
    })
}

/// The segments for `file`. Inside the project the first segment is the project root, named
/// `root_name`. Outside it the first segment is the file's library root (`external_root`).
pub fn segments(root: Option<&Path>, root_name: &str, file: &Path) -> Vec<Segment> {
    let (base, base_name, kind, rest) = match root.and_then(|r| file.strip_prefix(r).ok().map(|rest| (r, rest))) {
        Some((r, rest)) => (r.to_path_buf(), root_name.to_string(), SegmentKind::Root, rest.to_path_buf()),
        None => {
            let ext = external_root(file);
            let rest = file.strip_prefix(&ext.dir).unwrap_or(file).to_path_buf();
            (ext.dir, ext.label, SegmentKind::Library, rest)
        }
    };
    let mut out = vec![Segment { path: base.clone(), name: base_name, kind }];
    let parts: Vec<_> = rest.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let mut path = base;
    for (i, name) in parts.iter().enumerate() {
        path = path.join(name);
        let kind = if i + 1 == parts.len() { SegmentKind::File } else { SegmentKind::Dir };
        out.push(Segment { path: path.clone(), name: name.clone(), kind });
    }
    out
}

/// One slot of the drawn bar: a segment, or `…` standing for a range of hidden segments.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Slot {
    Segment(usize),
    Hidden(std::ops::Range<usize>),
}

/// Chooses the slots that fit in `available` points. `widths` are the segment widths; one
/// separator of `sep` sits between two slots, and `…` is `ellipsis` wide.
///
/// The first and the last segment stay. Middle segments are hidden from the left, so the
/// parents nearest to the file stay visible. When even `root … file` is too wide, the root
/// goes into the `…` too.
pub fn fit(widths: &[f32], sep: f32, ellipsis: f32, available: f32) -> Vec<Slot> {
    let n = widths.len();
    if n == 0 {
        return Vec::new();
    }
    let total: f32 = widths.iter().sum::<f32>() + sep * (n - 1) as f32;
    if total <= available || n == 1 {
        return (0..n).map(Slot::Segment).collect();
    }
    // Hide 1..k, for k growing: root, …, segments k..n.
    for k in 2..n {
        let shown = widths[0] + widths[k..].iter().sum::<f32>();
        let slots = 2 + (n - k);
        if shown + ellipsis + sep * (slots - 1) as f32 <= available {
            let mut out = vec![Slot::Segment(0), Slot::Hidden(1..k)];
            out.extend((k..n).map(Slot::Segment));
            return out;
        }
    }
    vec![Slot::Hidden(0..n - 1), Slot::Segment(n - 1)]
}

/// What a popup level lists.
#[derive(Clone, Debug)]
pub enum LevelSource {
    /// The children of a directory (loaded on a worker).
    Dir(PathBuf),
    /// The segments hidden behind `…`.
    Hidden(Vec<Entry>),
}

pub struct Level {
    pub source: LevelSource,
    /// Highlighted row. `None` until the listing arrives.
    pub selected: Option<usize>,
    /// The child that lies on the active file's path.
    pub current: Option<PathBuf>,
    scroll_to_selected: bool,
}

impl Level {
    fn dir(dir: PathBuf, file: &Path) -> Level {
        let current = file.strip_prefix(&dir).ok().and_then(|rest| rest.components().next()).map(|c| dir.join(c));
        Level { source: LevelSource::Dir(dir), selected: None, current, scroll_to_selected: true }
    }

    pub fn dir_path(&self) -> Option<&Path> {
        match &self.source {
            LevelSource::Dir(d) => Some(d),
            LevelSource::Hidden(_) => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Opener {
    Segment(usize),
    Hidden,
}

pub struct Popup {
    /// Level 0 belongs to the clicked segment; each next level is a nested popup.
    pub levels: Vec<Level>,
    /// The level the keyboard acts on.
    pub focus: usize,
    pub opener: Opener,
    /// The file the bar showed when the popup opened. Another active file closes it.
    file: PathBuf,
    /// Top-left corner of the opening slot; level 0 starts at its x and grows upward.
    pub anchor: Pos2,
}

#[derive(Default, Clone, Copy)]
struct Keys {
    escape: bool,
    up: bool,
    down: bool,
    left: bool,
    right: bool,
    enter: bool,
}

/// The egui focus target of the bar while it has the keyboard. Holding egui focus takes it from
/// the editor, and the focus lock stops egui from moving focus with the arrows.
pub fn focus_id() -> Id {
    Id::new("breadcrumbs-keyboard")
}

#[derive(Default)]
pub struct Breadcrumbs {
    listings: HashMap<PathBuf, Vec<Entry>>,
    loading: HashSet<PathBuf>,
    pub popup: Option<Popup>,
    keys: Keys,
    /// The bar's rect in the last drawn frame. A press there is not a click outside the popup.
    bar_rect: Option<Rect>,
    /// Slots drawn in the last frame, for tests and the popup anchor.
    pub slots: Vec<Slot>,
    /// Rects of `slots` in the last frame, to anchor a popup opened by the keyboard.
    slot_rects: Vec<Rect>,
    /// The slot selected by the keyboard. `Some` while the bar or its popup has the keyboard.
    pub selected_slot: Option<usize>,
    /// Request the bar's focus again at the start of the next frame. An arrow pressed while no
    /// widget had focus makes egui move a newly requested focus at the end of that frame.
    refocus: bool,
    /// The top edge of the status bar. Every popup level rests on it.
    pub baseline: Option<f32>,
    /// Outer rects of the popup levels in the last frame, for tests.
    pub popup_rects: Vec<Rect>,
}

impl Breadcrumbs {
    pub fn is_open(&self) -> bool {
        self.popup.is_some()
    }

    /// True when the bar itself (no popup) has the keyboard.
    pub fn bar_focused(&self, ctx: &Context) -> bool {
        self.popup.is_none() && self.selected_slot.is_some() && ctx.memory(|m| m.has_focus(focus_id()))
    }

    /// The index in `slots` of the slot that opened the popup.
    fn popup_slot(&self) -> Option<usize> {
        let opener = self.popup.as_ref()?.opener;
        self.slots.iter().position(|s| slot_opener(s) == opener)
    }

    /// The entries a level lists, or `None` while its directory loads.
    pub fn items<'a>(&'a self, level: &'a Level) -> Option<&'a [Entry]> {
        match &level.source {
            LevelSource::Dir(d) => self.listings.get(d).map(Vec::as_slice),
            LevelSource::Hidden(v) => Some(v),
        }
    }
}

/// The file the active tab shows (an editor's file, or the file of a diff tab).
pub fn active_file(state: &AppState) -> Option<PathBuf> {
    state.tabs.active_tab().and_then(|t| t.file_path())
}

fn active_segments(state: &AppState) -> Option<Vec<Segment>> {
    let file = active_file(state)?;
    let project = state.project.as_ref();
    Some(segments(project.map(|p| p.root.as_path()), project.map_or("", |p| p.name.as_str()), &file))
}

/// Lists `dir` on a worker. A cached listing stays on screen until the fresh one arrives.
fn request(state: &mut AppState, dir: PathBuf) {
    if !state.breadcrumbs.loading.insert(dir.clone()) {
        return;
    }
    let generation = state.project_generation();
    let d = dir.clone();
    state.jobs.spawn_quiet(
        move || tree::list_dir(&d),
        move |state, entries| {
            state.breadcrumbs.loading.remove(&dir);
            if state.project_generation() == generation {
                state.breadcrumbs.listings.insert(dir, entries);
            }
        },
    );
}

fn slot_opener(slot: &Slot) -> Opener {
    match slot {
        Slot::Segment(i) => Opener::Segment(*i),
        Slot::Hidden(_) => Opener::Hidden,
    }
}

/// Opens the popup of slot `index` of the last drawn bar, as the keyboard does.
fn open_slot(state: &mut AppState, index: usize) {
    let Some(segs) = active_segments(state) else { return };
    let (Some(slot), Some(rect)) = (state.breadcrumbs.slots.get(index).cloned(), state.breadcrumbs.slot_rects.get(index).copied()) else { return };
    open_popup(state, slot_opener(&slot), &segs, rect.left_top());
    state.breadcrumbs.selected_slot = Some(index);
}

/// Gives the bar the keyboard with slot `index` selected and no popup open.
fn focus_bar(state: &mut AppState, ctx: &Context, index: usize) {
    state.breadcrumbs.popup = None;
    state.breadcrumbs.selected_slot = Some(index);
    state.breadcrumbs.refocus = !ctx.memory(|m| m.has_focus(focus_id()));
    ctx.memory_mut(|m| m.request_focus(focus_id()));
}

/// Leaves the breadcrumbs and gives the keyboard back to the editor.
fn leave(state: &mut AppState, ctx: &Context) {
    state.breadcrumbs.popup = None;
    state.breadcrumbs.selected_slot = None;
    crate::terminal::focus_editor(state, ctx);
}

/// Alt+Home focuses the bar with the file segment selected. The caller skips it while a
/// terminal has focus.
pub fn shortcut(state: &mut AppState, ctx: &Context) {
    if !ctx.input_mut(|i| i.consume_key(egui::Modifiers::ALT, Key::Home)) {
        return;
    }
    if let Some(last) = state.breadcrumbs.slots.len().checked_sub(1) {
        focus_bar(state, ctx, last);
    }
}

fn open_popup(state: &mut AppState, opener: Opener, segs: &[Segment], anchor: Pos2) {
    let Some(file) = segs.last().map(|s| s.path.clone()) else { return };
    let level = match opener {
        Opener::Segment(i) => {
            // The file segment lists its siblings, with the file highlighted.
            let dir_index = if segs[i].kind == SegmentKind::File { i.saturating_sub(1) } else { i };
            Level::dir(segs[dir_index].path.clone(), &file)
        }
        Opener::Hidden => {
            let hidden = state.breadcrumbs.slots.iter().find_map(|s| match s {
                Slot::Hidden(r) => Some(r.clone()),
                Slot::Segment(_) => None,
            });
            let entries = hidden.map_or_else(Vec::new, |r| segs[r].iter().map(|s| Entry { path: s.path.clone(), name: s.name.clone(), is_dir: true }).collect());
            let selected = entries.len().checked_sub(1);
            Level { source: LevelSource::Hidden(entries), selected, current: None, scroll_to_selected: true }
        }
    };
    if let Some(d) = level.dir_path() {
        request(state, d.to_path_buf());
    }
    state.breadcrumbs.popup = Some(Popup { levels: vec![level], focus: 0, opener, file, anchor });
}

/// Consumes the keys of the focused bar or the open popup before the editor sees them, and
/// applies the bar's own keys. Call at the start of the frame.
pub fn take_keys(state: &mut AppState, ctx: &Context) {
    let crumbs = &mut state.breadcrumbs;
    if std::mem::take(&mut crumbs.refocus) && crumbs.selected_slot.is_some() {
        ctx.memory_mut(|m| m.request_focus(focus_id()));
    }
    // A click elsewhere took the focus: the bar no longer has the keyboard.
    if crumbs.popup.is_none() && crumbs.selected_slot.is_some() && !ctx.memory(|m| m.has_focus(focus_id())) {
        crumbs.selected_slot = None;
    }
    if crumbs.popup.is_none() && crumbs.selected_slot.is_none() {
        return;
    }
    let none = egui::Modifiers::NONE;
    let keys = ctx.input_mut(|i| Keys {
        escape: i.consume_key(none, Key::Escape),
        up: i.consume_key(none, Key::ArrowUp),
        down: i.consume_key(none, Key::ArrowDown),
        left: i.consume_key(none, Key::ArrowLeft),
        right: i.consume_key(none, Key::ArrowRight),
        enter: i.consume_key(none, Key::Enter),
    });
    if state.breadcrumbs.popup.is_some() {
        state.breadcrumbs.keys = keys;
        return;
    }
    // The bar has the keyboard and no popup is open.
    let len = state.breadcrumbs.slots.len();
    let Some(sel) = state.breadcrumbs.selected_slot.filter(|_| len > 0) else {
        leave(state, ctx);
        return;
    };
    let sel = sel.min(len - 1);
    if keys.up || keys.escape {
        leave(state, ctx);
    } else if keys.down || keys.enter {
        open_slot(state, sel);
    } else if keys.left {
        state.breadcrumbs.selected_slot = Some(sel.saturating_sub(1));
    } else if keys.right {
        state.breadcrumbs.selected_slot = Some((sel + 1).min(len - 1));
    }
}

fn font() -> FontId {
    theme::T.small_font()
}

/// The content width of a popup level that lists `items`.
fn level_width(ctx: &Context, items: &[Entry]) -> f32 {
    let text_w = ctx.fonts(|f| items.iter().take(500).map(|e| f.layout_no_wrap(e.name.clone(), font(), theme::T.text).size().x).fold(0.0_f32, f32::max));
    (text_w + ICON_W + 34.0).clamp(160.0, 420.0)
}

fn segment_width(ui: &Ui, seg: &Segment) -> f32 {
    let text = ui.painter().layout_no_wrap(seg.name.clone(), font(), theme::T.text).size().x;
    PAD + ICON_W + text + PAD
}

/// Draws the breadcrumbs into `ui` (the left part of the status bar).
pub fn bar(state: &mut AppState, ui: &mut Ui) {
    let Some(segs) = active_segments(state) else {
        state.breadcrumbs.popup = None;
        state.breadcrumbs.slots.clear();
        state.breadcrumbs.bar_rect = None;
        return;
    };
    let file = segs.last().map(|s| s.path.clone()).unwrap_or_default();
    if state.breadcrumbs.popup.as_ref().is_some_and(|p| p.file != file) {
        state.breadcrumbs.popup = None;
    }
    // Slots touch; the separators carry the gaps, so `fit` sees the real widths.
    ui.spacing_mut().item_spacing.x = 0.0;
    let widths: Vec<f32> = segs.iter().map(|s| segment_width(ui, s)).collect();
    let slots = fit(&widths, SEP_W, ELLIPSIS_W, ui.available_width());
    let height = ui.available_height();
    let start = ui.cursor().min;
    let mut clicked: Option<(Opener, Pos2)> = None;
    let open = state.breadcrumbs.popup.as_ref().map(|p| p.opener);
    let bar_focused = state.breadcrumbs.bar_focused(ui.ctx());
    let keyboard = if bar_focused { state.breadcrumbs.selected_slot.map(|s| s.min(slots.len().saturating_sub(1))) } else { None };
    let mut slot_rects = Vec::with_capacity(slots.len());
    let mut anchor = None;
    for (n, slot) in slots.iter().enumerate() {
        if n > 0 {
            let (r, _) = ui.allocate_exact_size(vec2(SEP_W, height), Sense::hover());
            chevron(ui.painter(), r.center(), theme::T.text_dim);
        }
        let (opener, width) = match slot {
            Slot::Segment(i) => (Opener::Segment(*i), widths[*i]),
            Slot::Hidden(_) => (Opener::Hidden, ELLIPSIS_W),
        };
        let (rect, resp) = ui.allocate_exact_size(vec2(width, height), Sense::click());
        let label = match slot {
            Slot::Segment(i) => format!("Breadcrumb {}", segs[*i].name),
            Slot::Hidden(_) => "Breadcrumb …".to_string(),
        };
        slot_rects.push(rect);
        let chosen = keyboard == Some(n);
        crate::util::label_selectable(&resp, label, open == Some(opener) || chosen);
        let painter = ui.painter();
        if chosen {
            // The keyboard selection: a filled slot with a focus ring.
            let r = rect.shrink2(vec2(0.0, 1.0));
            painter.rect_filled(r, theme::T.radius.row, theme::T.tab_active_bg);
            painter.rect_stroke(r.shrink(0.5), theme::T.radius.row, Stroke::new(1.0_f32, theme::T.accent), egui::StrokeKind::Inside);
        } else if open == Some(opener) {
            painter.rect_filled(rect.shrink2(vec2(0.0, 1.0)), theme::T.radius.row, theme::T.tab_active_bg);
            anchor = Some(rect.left_top());
        } else if resp.hovered() {
            painter.rect_filled(rect.shrink2(vec2(0.0, 1.0)), theme::T.radius.row, theme::T.hover_on_window);
        }
        let cy = rect.center().y;
        match slot {
            Slot::Segment(i) => {
                let seg = &segs[*i];
                let mut x = rect.min.x + PAD;
                match seg.kind {
                    SegmentKind::Root | SegmentKind::Dir => folder_icon(painter, pos2(x + 7.0, cy)),
                    SegmentKind::Library => icons::library(painter, pos2(x + 7.0, cy), 14.0),
                    SegmentKind::File => file_icon(painter, pos2(x + 7.0, cy), &seg.name),
                }
                x += ICON_W;
                let color = match seg.kind {
                    SegmentKind::File => tree::name_color(&state.git, &seg.path, false),
                    _ => theme::T.text,
                };
                painter.text(pos2(x, cy), Align2::LEFT_CENTER, &seg.name, font(), color);
            }
            Slot::Hidden(_) => dots(painter, rect.center(), theme::T.text),
        }
        if resp.clicked() {
            clicked = Some((opener, rect.left_top()));
        }
    }
    state.breadcrumbs.bar_rect = Some(Rect::from_min_max(start, pos2(ui.cursor().min.x, start.y + height)));
    if state.breadcrumbs.selected_slot.is_some() {
        // The focus target must exist every frame, or egui drops its focus. It has no size, so
        // any press, even on a segment, takes the keyboard away from the bar.
        ui.interact(Rect::from_min_size(start, egui::Vec2::ZERO), focus_id(), Sense::focusable_noninteractive());
        ui.memory_mut(|m| m.set_focus_lock_filter(focus_id(), egui::EventFilter { tab: true, horizontal_arrows: true, vertical_arrows: true, escape: true }));
    }
    state.breadcrumbs.slots = slots;
    state.breadcrumbs.slot_rects = slot_rects;
    if let (Some(p), Some(a)) = (state.breadcrumbs.popup.as_mut(), anchor) {
        p.anchor = a;
    }
    if let Some((opener, at)) = clicked {
        if open == Some(opener) {
            state.breadcrumbs.popup = None;
        } else {
            open_popup(state, opener, &segs, at);
        }
    }
}

enum Action {
    /// Select row `row` of level `level` and open the row's directory as the next level (or
    /// close deeper levels for a file). `enter` moves the keyboard focus into the new level.
    Select { level: usize, row: usize, enter: bool },
    Open(PathBuf),
}

/// Draws the open popup levels and applies keys, hover and clicks. Call after the panels.
pub fn show_popup(state: &mut AppState, ctx: &Context) {
    let keys = std::mem::take(&mut state.breadcrumbs.keys);
    let Some(popup) = state.breadcrumbs.popup.as_mut() else {
        state.breadcrumbs.popup_rects.clear();
        return;
    };
    let listings = &state.breadcrumbs.listings;
    let items_of = |level: &Level| -> Option<Vec<Entry>> {
        match &level.source {
            LevelSource::Dir(d) => listings.get(d).cloned(),
            LevelSource::Hidden(v) => Some(v.clone()),
        }
    };
    // A level whose listing just arrived starts on the current child.
    for level in &mut popup.levels {
        if level.selected.is_none() {
            if let Some(items) = items_of(level) {
                if !items.is_empty() {
                    let cur = level.current.as_ref().and_then(|c| items.iter().position(|e| &e.path == c));
                    level.selected = Some(cur.unwrap_or(0));
                }
            }
        }
    }

    let mut actions: Vec<Action> = Vec::new();
    let escape = keys.escape;
    // Up at the first row of the first level goes back to the bar.
    let mut to_bar = false;
    // Left/Right at the first level hop to the previous (`false`) or next (`true`) segment.
    let mut hop: Option<bool> = None;
    let focus = popup.focus.min(popup.levels.len().saturating_sub(1));
    let (len, sel, selected_entry) = match popup.levels.get(focus) {
        Some(level) => {
            let items = items_of(level).unwrap_or_default();
            let entry = level.selected.and_then(|s| items.get(s).cloned());
            (items.len(), level.selected, entry)
        }
        None => (0, None, None),
    };
    let s = sel.unwrap_or(0);
    if keys.up {
        if focus == 0 && s == 0 {
            to_bar = true;
        } else if len > 0 {
            actions.push(Action::Select { level: focus, row: (s + len - 1) % len, enter: false });
        }
    }
    if keys.down && len > 0 {
        actions.push(Action::Select { level: focus, row: (s + 1) % len, enter: false });
    }
    if keys.left {
        if focus > 0 {
            popup.levels.truncate(focus);
            popup.focus = focus - 1;
        } else {
            hop = Some(false);
        }
    }
    let selected_dir = selected_entry.as_ref().is_some_and(|e| e.is_dir);
    if keys.right {
        if selected_dir {
            actions.push(Action::Select { level: focus, row: s, enter: true });
        } else if focus == 0 {
            hop = Some(true);
        }
    }
    if keys.enter {
        match selected_entry {
            Some(e) if e.is_dir => actions.push(Action::Select { level: focus, row: s, enter: true }),
            Some(e) => actions.push(Action::Open(e.path)),
            None => {}
        }
    }

    let pointer_moved = ctx.input(|i| i.pointer.delta() != egui::Vec2::ZERO);
    let root = state.project.as_ref().map(|p| p.root.clone());
    let git = &state.git;
    let mut popup_rects = Vec::new();
    // The directory each level shows, to know whether a row's nested popup is already open.
    let level_dirs: Vec<Option<PathBuf>> = popup.levels.iter().map(|l| l.dir_path().map(Path::to_path_buf)).collect();

    // Layout, like IDEA: every level rests on the status bar and grows upward. Nested levels sit
    // right of their parent, touching it. Heights are whole rows, at most `MAX_ROWS`.
    // The shadow is lifted by half its blur, so it does not darken the status bar below.
    let shadow = egui::Shadow { offset: [0, -6], blur: 12, spread: 0, color: theme::T.shadow };
    let frame = egui::Frame::popup(&ctx.style()).fill(theme::T.popup_bg).corner_radius(egui::CornerRadius::same(theme::T.radius.popup as u8)).inner_margin(egui::Margin::same(4)).shadow(shadow);
    let margin = frame.total_margin().sum();
    let screen = ctx.screen_rect();
    let baseline = state.breadcrumbs.baseline.unwrap_or(screen.max.y).min(screen.max.y);
    let fit_rows = ((baseline - screen.min.y - margin.y) / ROW_H).floor().max(1.0) as usize;
    let max_rows = MAX_ROWS.min(fit_rows);
    let level_items: Vec<Option<Vec<Entry>>> = popup.levels.iter().map(&items_of).collect();
    let sizes: Vec<Vec2> = level_items
        .iter()
        .map(|items| {
            let rows = items.as_ref().map_or(1, |v| v.len().clamp(1, max_rows));
            vec2(level_width(ctx, items.as_deref().unwrap_or_default()), rows as f32 * ROW_H)
        })
        .collect();
    let mut xs = Vec::with_capacity(sizes.len());
    let mut x = popup.anchor.x;
    for size in &sizes {
        xs.push(x);
        x += size.x + margin.x;
    }
    // A chain that leaves the window on the right moves left as a whole, but not past the left
    // edge. A level that still does not fit moves left on its own.
    let shift = (x - screen.max.x).min(popup.anchor.x - screen.min.x).max(0.0);
    for (xi, size) in xs.iter_mut().zip(&sizes) {
        *xi = (*xi - shift).min(screen.max.x - size.x - margin.x).max(screen.min.x);
    }

    for (li, level) in popup.levels.iter_mut().enumerate() {
        let items = &level_items[li];
        let size = sizes[li];
        let pos = pos2(xs[li], baseline - size.y - margin.y);
        let focused = li == popup.focus;
        let key = level_dirs[li].clone().unwrap_or_default();
        let resp = egui::Area::new(Id::new(("breadcrumb-popup", li, &key))).order(egui::Order::Foreground).fixed_pos(pos).constrain(false).show(ctx, |ui| {
            frame.show(ui, |ui| {
                // An explicit size: an Area otherwise offers its content last frame's size.
                ui.set_width(size.x);
                ui.set_height(size.y);
                let Some(items) = items else {
                    ui.label(egui::RichText::new("Loading...").size(theme::T.font.small).color(theme::T.text_dim));
                    return;
                };
                if items.is_empty() {
                    ui.label(egui::RichText::new("Empty").size(theme::T.font.small).color(theme::T.text_dim));
                    return;
                }
                let width = size.x;
                // The sizing pass of a new Area is invisible; scroll on the first real frame.
                let scroll = !ui.is_sizing_pass() && std::mem::take(&mut level.scroll_to_selected);
                // The default clip margin would show 3 px of the row above the viewport and offset
                // `scroll_to_rect` by as much.
                ui.visuals_mut().clip_rect_margin = 0.0;
                ScrollArea::vertical().id_salt(("breadcrumb-scroll", li, &key)).max_height(size.y).min_scrolled_height(size.y).auto_shrink([false, false]).show(ui, |ui| {
                    ui.set_width(width);
                    ui.spacing_mut().item_spacing.y = 0.0;
                    for (ri, e) in items.iter().enumerate() {
                        let (rect, r) = ui.allocate_exact_size(vec2(width, ROW_H), Sense::click());
                        let selected = level.selected == Some(ri);
                        let rel = root.as_ref().and_then(|root| e.path.strip_prefix(root).ok()).map_or_else(|| e.path.display().to_string(), |p| p.display().to_string());
                        crate::util::label_selectable(&r, format!("Breadcrumb item {rel}"), selected);
                        let painter = ui.painter();
                        if selected {
                            painter.rect_filled(rect, theme::T.radius.row, if focused { theme::T.selection } else { theme::T.selection_inactive });
                        }
                        let is_current = level.current.as_ref() == Some(&e.path);
                        if is_current {
                            painter.rect_filled(Rect::from_min_size(rect.min + vec2(0.0, 3.0), vec2(2.0, ROW_H - 6.0)), 1.0, theme::T.accent);
                        }
                        let cy = rect.center().y;
                        if e.is_dir {
                            folder_icon(painter, pos2(rect.min.x + 13.0, cy));
                        } else {
                            file_icon(painter, pos2(rect.min.x + 13.0, cy), &e.name);
                        }
                        let mut color = tree::name_color(git, &e.path, e.is_dir);
                        if selected && focused && color == theme::T.text {
                            color = theme::T.text_bright;
                        }
                        let font = if is_current { FontId::proportional(theme::T.font.small + 0.5) } else { font() };
                        painter.text(pos2(rect.min.x + 6.0 + ICON_W + 4.0, cy), Align2::LEFT_CENTER, &e.name, font, color);
                        if e.is_dir {
                            chevron(painter, pos2(rect.max.x - 8.0, cy), theme::T.text_dim);
                        }
                        if selected && scroll {
                            // No alignment: the row lands on the viewport edge, so whole rows stay visible.
                            ui.scroll_to_rect(rect, None);
                        }
                        if r.clicked() {
                            if e.is_dir {
                                actions.push(Action::Select { level: li, row: ri, enter: false });
                            } else {
                                actions.push(Action::Open(e.path.clone()));
                            }
                        } else if r.hovered() && pointer_moved {
                            let nested_open = level_dirs.get(li + 1).is_some_and(|d| d.as_ref() == Some(&e.path));
                            let deeper = level_dirs.len() > li + 1;
                            let stale = !selected || !focused || if e.is_dir { !nested_open } else { deeper };
                            if stale {
                                actions.push(Action::Select { level: li, row: ri, enter: false });
                            }
                        }
                    }
                });
            });
        });
        popup_rects.push(resp.response.rect);
    }

    let pressed_outside = ctx.input(|i| {
        i.pointer.any_pressed() && i.pointer.interact_pos().is_some_and(|p| !popup_rects.iter().any(|r| r.contains(p)) && !state.breadcrumbs.bar_rect.is_some_and(|r| r.contains(p)))
    });

    let mut open_file = None;
    let mut to_list = Vec::new();
    for a in actions {
        match a {
            Action::Open(p) => open_file = Some(p),
            Action::Select { level, row, enter } => {
                let Some(l) = popup.levels.get_mut(level) else { continue };
                l.selected = Some(row);
                l.scroll_to_selected = true;
                let entry = items_of(l).and_then(|v| v.get(row).cloned());
                popup.levels.truncate(level + 1);
                popup.focus = level;
                if let Some(e) = entry.filter(|e| e.is_dir) {
                    popup.levels.push(Level::dir(e.path.clone(), &popup.file));
                    to_list.push(e.path);
                    if enter {
                        popup.focus = level + 1;
                    }
                }
            }
        }
    }
    state.breadcrumbs.popup_rects = popup_rects;
    for d in to_list {
        request(state, d);
    }
    if escape {
        leave(state, ctx);
        return;
    }
    if pressed_outside || open_file.is_some() {
        state.breadcrumbs.popup = None;
        state.breadcrumbs.selected_slot = None;
    }
    if let Some(p) = open_file {
        state.open_location(&p, None, true);
        return;
    }
    let Some(current) = state.breadcrumbs.popup_slot() else { return };
    if to_bar {
        focus_bar(state, ctx, current);
    } else if let Some(next) = hop {
        let target = if next { current + 1 } else { current.wrapping_sub(1) };
        if target < state.breadcrumbs.slots.len() {
            open_slot(state, target);
        }
    }
}

fn chevron(painter: &Painter, c: Pos2, color: Color32) {
    icons::paint(painter, Rect::from_center_size(c, vec2(10.0, 10.0)), Icon::ChevronRight, color);
}

fn dots(painter: &Painter, c: Pos2, color: Color32) {
    icons::paint(painter, Rect::from_center_size(c, vec2(14.0, 14.0)), Icon::More, color);
}

pub fn folder_icon(painter: &Painter, c: Pos2) {
    icons::folder(painter, c, 14.0);
}

pub fn file_icon(painter: &Painter, c: Pos2, name: &str) {
    icons::file(painter, c, 13.0, name);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_inside_project() {
        let s = segments(Some(Path::new("/p/repo")), "repo", Path::new("/p/repo/src/core/a.ts"));
        let names: Vec<_> = s.iter().map(|s| (s.name.as_str(), s.kind)).collect();
        assert_eq!(names, [("repo", SegmentKind::Root), ("src", SegmentKind::Dir), ("core", SegmentKind::Dir), ("a.ts", SegmentKind::File)]);
        assert_eq!(s[2].path, Path::new("/p/repo/src/core"));
    }

    fn names_of(s: &[Segment]) -> Vec<&str> {
        s.iter().map(|s| s.name.as_str()).collect()
    }

    #[test]
    fn rust_src_roots_at_the_crate() {
        let file = Path::new("/t/rust-src/lib/rustlib/src/rust/library/alloc/src/vec/mod.rs");
        assert_eq!(external_root(file), ExternalRoot { dir: "/t/rust-src/lib/rustlib/src/rust/library/alloc/src".into(), label: "alloc".into() });
        let s = segments(Some(Path::new("/p/repo")), "repo", file);
        assert_eq!(names_of(&s), ["alloc", "vec", "mod.rs"]);
        assert_eq!(s[0].kind, SegmentKind::Library);
        assert_eq!(s[1].path, Path::new("/t/rust-src/lib/rustlib/src/rust/library/alloc/src/vec"));
        let std = Path::new("/t/rust/library/std/src/lib.rs");
        assert_eq!(names_of(&segments(None, "", std)), ["std", "lib.rs"]);
    }

    #[test]
    fn registry_roots_at_crate_and_version() {
        let file = Path::new("/h/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.228/src/de/mod.rs");
        let r = external_root(file);
        assert_eq!(r.label, "serde 1.0.228");
        assert_eq!(r.dir, Path::new("/h/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.228"));
        assert_eq!(names_of(&segments(None, "", file)), ["serde 1.0.228", "src", "de", "mod.rs"]);
        // Dashes and digits in the crate name, and a pre-release version.
        assert_eq!(external_root(Path::new("/h/registry/src/i/md-5-0.10.6/src/lib.rs")).label, "md-5 0.10.6");
        assert_eq!(external_root(Path::new("/h/registry/src/i/base64-0.22.1/src/lib.rs")).label, "base64 0.22.1");
        assert_eq!(external_root(Path::new("/h/registry/src/i/tokio-macros-2.0.0-rc.1/lib.rs")).label, "tokio-macros 2.0.0-rc.1");
    }

    #[test]
    fn npm_packages_root_at_the_package() {
        let plain = Path::new("/t/ts5/node_modules/typescript/lib/lib.dom.d.ts");
        assert_eq!(external_root(plain), ExternalRoot { dir: "/t/ts5/node_modules/typescript".into(), label: "typescript".into() });
        assert_eq!(names_of(&segments(Some(Path::new("/p/repo")), "repo", plain)), ["typescript", "lib", "lib.dom.d.ts"]);
        let scoped = Path::new("/t/ts7/node_modules/@typescript/native-preview/lib/lib.d.ts");
        assert_eq!(external_root(scoped), ExternalRoot { dir: "/t/ts7/node_modules/@typescript/native-preview".into(), label: "@typescript/native-preview".into() });
        // A nested `node_modules` (pnpm): the innermost package wins.
        let nested = Path::new("/o/node_modules/.pnpm/a@1/node_modules/@s/b/index.d.ts");
        assert_eq!(external_root(nested).label, "@s/b");
        // A package inside the project stays under the project root.
        let inside = Path::new("/p/repo/node_modules/lodash/index.js");
        assert_eq!(names_of(&segments(Some(Path::new("/p/repo")), "repo", inside)), ["repo", "node_modules", "lodash", "index.js"]);
    }

    #[test]
    fn other_external_files_keep_three_segments() {
        let s = segments(Some(Path::new("/p/repo")), "repo", Path::new("/usr/local/include/lib/x.d.ts"));
        assert_eq!(names_of(&s), ["External", "include", "lib", "x.d.ts"]);
        assert_eq!(s[0].path, Path::new("/usr/local"));
        assert_eq!(s[0].kind, SegmentKind::Library);
        assert_eq!(names_of(&segments(None, "", Path::new("/etc/hosts"))), ["External", "etc", "hosts"]);
        assert_eq!(segments(None, "", Path::new("/etc/hosts"))[0].path, Path::new("/"));
    }

    #[test]
    fn fit_keeps_everything_when_wide() {
        assert_eq!(fit(&[50.0, 30.0, 40.0], 10.0, 20.0, 140.0), vec![Slot::Segment(0), Slot::Segment(1), Slot::Segment(2)]);
    }

    #[test]
    fn fit_hides_middle_from_the_left() {
        // root 50, a 30, b 30, c 30, file 40; separators 10, ellipsis 20.
        let w = [50.0, 30.0, 30.0, 30.0, 40.0];
        // root … c file = 50 + 20 + 30 + 40 + 3*10 = 170.
        assert_eq!(fit(&w, 10.0, 20.0, 175.0), vec![Slot::Segment(0), Slot::Hidden(1..3), Slot::Segment(3), Slot::Segment(4)]);
        // root … b c file = 50 + 20 + 60 + 40 + 40 = 210.
        assert_eq!(fit(&w, 10.0, 20.0, 210.0), vec![Slot::Segment(0), Slot::Hidden(1..2), Slot::Segment(2), Slot::Segment(3), Slot::Segment(4)]);
        // root … file = 50 + 20 + 40 + 20 = 130.
        assert_eq!(fit(&w, 10.0, 20.0, 130.0), vec![Slot::Segment(0), Slot::Hidden(1..4), Slot::Segment(4)]);
    }

    #[test]
    fn fit_hides_root_last() {
        let w = [50.0, 30.0, 40.0];
        assert_eq!(fit(&w, 10.0, 20.0, 80.0), vec![Slot::Hidden(0..2), Slot::Segment(2)]);
        assert_eq!(fit(&[50.0, 40.0], 10.0, 20.0, 60.0), vec![Slot::Hidden(0..1), Slot::Segment(1)]);
        assert_eq!(fit(&[50.0], 10.0, 20.0, 10.0), vec![Slot::Segment(0)]);
    }
}
