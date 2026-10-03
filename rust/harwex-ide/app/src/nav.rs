//! Code navigation through the language servers: Go to Declaration / Source / Type
//! Definition, Find Usages, hover info and back/forward history.
//!
//! Requests go through the language registry (`crate::lang`): TypeScript and JavaScript to
//! `ide-ts`, Rust to rust-analyzer. Each language has one queue thread, so `open`/`change`/
//! `close` and requests reach the server in the order the UI issued them. A request always
//! sees the edits made before it.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use egui::{Context, Frame, Id, Key, LayerId, Pos2, RichText, ScrollArea};
use ide_editor::Position;

use crate::lang::{HoverInfo, Location, Reference};
use crate::state::AppState;
use crate::tabs::TabId;
use crate::theme;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NavKind {
    Declaration,
    SourceDefinition,
    TypeDefinition,
    Usages,
}

impl NavKind {
    pub fn label(self) -> &'static str {
        match self {
            NavKind::Declaration => "Go to Declaration",
            NavKind::SourceDefinition => "Go to Source Definition",
            NavKind::TypeDefinition => "Go to Type Definition",
            NavKind::Usages => "Find Usages",
        }
    }

    pub fn parse(s: &str) -> Option<NavKind> {
        Some(match s {
            "definition" | "declaration" => NavKind::Declaration,
            "source" | "source-definition" => NavKind::SourceDefinition,
            "type" | "type-definition" => NavKind::TypeDefinition,
            "usages" | "references" => NavKind::Usages,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NavPoint {
    pub path: PathBuf,
    pub pos: Position,
}

pub struct NavTarget {
    pub location: Location,
    /// The target line, trimmed, for the chooser popup.
    pub preview: String,
}

pub struct NavPopup {
    pub title: String,
    pub anchor: Pos2,
    pub items: Vec<NavTarget>,
    pub selected: usize,
    /// Where the request was made; Back returns here.
    pub from: NavPoint,
    /// Keys taken at the start of the frame by `take_popup_keys`: (esc, up, down, enter).
    keys: (bool, bool, bool, bool),
}

#[derive(Default)]
pub struct HoverState {
    key: Option<(PathBuf, Position, Position)>,
    since: Option<Instant>,
    requested: bool,
    info: Option<HoverInfo>,
    generation: u64,
}

#[derive(Default)]
pub struct Navigation {
    pub back: Vec<NavPoint>,
    pub forward: Vec<NavPoint>,
    pub popup: Option<NavPopup>,
    pub hover: HoverState,
    generation: u64,
    /// Last latency, for the status bar tooltip and the timings log.
    pub last_ms: Option<f64>,
}

pub struct UsageGroup {
    pub path: PathBuf,
    pub refs: Vec<Reference>,
}

#[derive(Default)]
pub struct UsagesView {
    pub title: String,
    pub groups: Vec<UsageGroup>,
    pub searching: bool,
    pub took_ms: f64,
}

const HISTORY_LIMIT: usize = 200;

impl HoverState {
    /// The pointer rests on an identifier and the quick-info request has not been sent yet.
    pub fn is_waiting(&self) -> bool {
        self.key.is_some() && !self.requested
    }

    /// The hover info shown in the tooltip, once the server answered.
    pub fn info(&self) -> Option<&HoverInfo> {
        self.info.as_ref()
    }
}

impl Navigation {
    /// State for a newly opened project; the generation keeps counting, so a late tsserver
    /// reply from the old project is dropped.
    pub fn reset(&mut self) {
        let generation = self.generation + 1;
        *self = Navigation { generation, ..Default::default() };
    }

    pub fn push_back(&mut self, p: NavPoint) {
        if self.back.last() != Some(&p) {
            self.back.push(p);
            if self.back.len() > HISTORY_LIMIT {
                self.back.remove(0);
            }
        }
        self.forward.clear();
    }
}

/// Flushes unsent edits of one tab to its language server. Called before every request, so
/// results never refer to stale text even when the debounce has not fired yet.
pub fn flush_lsp(state: &mut AppState, tab: TabId) {
    let Some(e) = state.tabs.editor_mut(tab) else { return };
    let (Some(lang), Some(v)) = (e.lang, e.lsp_version) else { return };
    if v != e.doc.version() {
        e.lsp_version = Some(e.doc.version());
        let text = e.doc.text();
        let path = e.path.clone();
        state.langs.bridge(lang).change(&path, text);
    }
}

/// Sends edits that have rested for 300 ms. Without this, the server would get a full copy of
/// the file on every keystroke.
pub fn sync_lsp_debounced(state: &mut AppState) {
    let mut due = Vec::new();
    let mut wake: Option<Duration> = None;
    for (id, e) in state.tabs.editors_mut() {
        let Some(v) = e.lsp_version else { continue };
        if v == e.doc.version() {
            continue;
        }
        let rest = e.last_edit.elapsed();
        if rest >= Duration::from_millis(300) {
            due.push(id);
        } else {
            let left = Duration::from_millis(300) - rest;
            wake = Some(wake.map_or(left, |w| w.min(left)));
        }
    }
    for id in due {
        flush_lsp(state, id);
    }
    if let Some(w) = wake {
        state.ctx.request_repaint_after(w);
    }
}

/// Starts a navigation request at `pos` in tab `tab`. The result arrives later on the UI thread.
pub fn request(state: &mut AppState, kind: NavKind, tab: TabId, pos: Position, anchor: Pos2) {
    let Some(e) = state.tabs.editor_mut(tab) else { return };
    let lang = match (e.lang, state.langs.lang_for(&e.path)) {
        (Some(lang), _) => lang,
        (None, Err(why)) => {
            state.notifications.warn(kind.label(), why);
            return;
        }
        // Enabled, but the tab was opened before the project settings allowed it.
        (None, Ok(lang)) => lang,
    };
    let path = e.path.clone();
    let word = e.doc.word_at(pos).map(|r| e.doc.slice(e.doc.position_to_char(r.start)..e.doc.position_to_char(r.end))).unwrap_or_default();
    flush_lsp(state, tab);
    state.nav.generation += 1;
    state.nav.popup = None;
    let generation = state.nav.generation;
    let jobs = state.jobs.clone();
    if kind == NavKind::Usages {
        state.usages.searching = true;
        state.usages.title = format!("Usages of {word}");
        state.layout.show(crate::layout::ToolWindow::Usages);
    }
    let from = NavPoint { path: path.clone(), pos };
    state.langs.bridge(lang).run(move |server| {
        let _busy = jobs.busy(format!("{}: {word}", kind.label()));
        let started = Instant::now();
        let result = match kind {
            NavKind::Usages => server.references(&path, pos.line, pos.column).map(NavResult::References),
            _ => server.locations(kind, &path, pos.line, pos.column).map(NavResult::Locations),
        };
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        let result = result.map(|r| match r {
            NavResult::Locations(locs) => NavResult::Targets(with_previews(dedup(locs))),
            other => other,
        });
        jobs.post(move |state| on_result(state, NavReply { kind, generation, from, word, anchor, ms, result }));
    });
}

enum NavResult {
    Locations(Vec<Location>),
    Targets(Vec<NavTarget>),
    References(Vec<Reference>),
}

struct NavReply {
    kind: NavKind,
    generation: u64,
    from: NavPoint,
    word: String,
    anchor: Pos2,
    ms: f64,
    result: Result<NavResult, String>,
}

fn dedup(locs: Vec<Location>) -> Vec<Location> {
    let mut seen = HashSet::new();
    locs.into_iter().filter(|l| seen.insert(l.clone())).collect()
}

fn with_previews(locs: Vec<Location>) -> Vec<NavTarget> {
    locs.into_iter()
        .map(|location| {
            let preview = std::fs::read_to_string(&location.path)
                .ok()
                .and_then(|t| t.lines().nth(location.line).map(|l| l.trim().chars().take(160).collect()))
                .unwrap_or_default();
            NavTarget { location, preview }
        })
        .collect()
}

fn on_result(state: &mut AppState, reply: NavReply) {
    let NavReply { kind, generation, from, word, anchor, ms, result } = reply;
    state.nav.last_ms = Some(ms);
    let test = state.test.is_some();
    match &result {
        Ok(NavResult::Targets(t)) => {
            let list: Vec<String> = t.iter().map(|t| format!("{}:{}:{}", t.location.path.display(), t.location.line + 1, t.location.column + 1)).collect();
            state.timings.log(format!("{} `{word}` at {}:{}: {} result(s) in {ms:.1} ms {list:?}", kind.label(), from.pos.line + 1, from.pos.column + 1, t.len()));
        }
        Ok(NavResult::References(r)) => {
            state.timings.log(format!("{} `{word}`: {} reference(s) in {ms:.1} ms", kind.label(), r.len()));
        }
        Ok(NavResult::Locations(_)) => {}
        Err(e) => state.timings.log(format!("{} `{word}` failed after {ms:.1} ms: {e}", kind.label())),
    }
    if test {
        crate::testhook::step_done(state);
    }
    if generation != state.nav.generation {
        // A newer request replaced this one. The Usages spinner must not wait for it.
        if kind == NavKind::Usages && state.usages.title == format!("Usages of {word}") {
            state.usages.searching = false;
        }
        return;
    }
    match result {
        Err(e) => {
            if kind == NavKind::Usages {
                state.usages.searching = false;
            }
            state.notifications.error(format!("{} failed", kind.label()), e);
        }
        Ok(NavResult::References(refs)) => {
            let mut groups: Vec<UsageGroup> = Vec::new();
            for r in refs {
                match groups.iter_mut().find(|g| g.path == r.location.path) {
                    Some(g) => g.refs.push(r),
                    None => groups.push(UsageGroup { path: r.location.path.clone(), refs: vec![r] }),
                }
            }
            for g in &mut groups {
                g.refs.sort_by_key(|r| (r.location.line, r.location.column));
            }
            groups.sort_by(|a, b| a.path.cmp(&b.path));
            state.usages = UsagesView { title: format!("Usages of {word}"), groups, searching: false, took_ms: ms };
            state.layout.show(crate::layout::ToolWindow::Usages);
        }
        Ok(NavResult::Targets(mut targets)) => match targets.len() {
            0 => state.notifications.info(
                match kind {
                    NavKind::Declaration => "Cannot find declaration to go to",
                    NavKind::SourceDefinition => "Cannot find source definition",
                    NavKind::TypeDefinition => "Cannot find type definition",
                    NavKind::Usages => "No usages found",
                },
                word,
            ),
            1 => {
                let t = targets.remove(0);
                jump_from(state, from, &t);
            }
            _ => {
                state.nav.popup = Some(NavPopup { title: format!("Choose declaration of {word}"), anchor, items: targets, selected: 0, from, keys: Default::default() });
            }
        },
        Ok(NavResult::Locations(_)) => {}
    }
}

pub fn go_back(state: &mut AppState) {
    let Some(p) = state.nav.back.pop() else { return };
    if let Some(cur) = state.current_point() {
        state.nav.forward.push(cur);
    }
    state.open_location(&p.path, Some(p.pos), false);
}

pub fn go_forward(state: &mut AppState) {
    let Some(p) = state.nav.forward.pop() else { return };
    if let Some(cur) = state.current_point() {
        state.nav.back.push(cur);
    }
    state.open_location(&p.path, Some(p.pos), false);
}

/// Records the place a jump left (the request's origin, not wherever the user is when the
/// reply lands) and opens the target.
fn jump_from(state: &mut AppState, from: NavPoint, t: &NavTarget) {
    let pos = Position::new(t.location.line, t.location.column);
    if from.path != t.location.path || from.pos != pos {
        state.nav.push_back(from);
    }
    state.open_location(&t.location.path, Some(pos), false);
}

/// Takes the chooser's keys before any widget runs. The editor or terminal keeps keyboard
/// focus behind the popup, and it would otherwise also get Enter and the arrows.
pub fn take_popup_keys(state: &mut AppState, ctx: &Context) {
    let Some(popup) = &mut state.nav.popup else { return };
    popup.keys = ctx.input_mut(|i| {
        (
            i.consume_key(egui::Modifiers::NONE, Key::Escape),
            i.consume_key(egui::Modifiers::NONE, Key::ArrowUp),
            i.consume_key(egui::Modifiers::NONE, Key::ArrowDown),
            i.consume_key(egui::Modifiers::NONE, Key::Enter),
        )
    });
}

/// The chooser shown when a request has several results.
pub fn show_popup(state: &mut AppState, ctx: &Context) {
    let Some(popup) = &mut state.nav.popup else { return };
    let root = state.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    let (esc, up, down, enter) = std::mem::take(&mut popup.keys);
    if up {
        popup.selected = popup.selected.saturating_sub(1);
    }
    if down && popup.selected + 1 < popup.items.len() {
        popup.selected += 1;
    }
    let mut chosen = if enter { Some(popup.selected) } else { None };
    let resp = egui::Area::new(Id::new("nav-popup")).fixed_pos(popup.anchor).order(egui::Order::Foreground).constrain(true).show(ctx, |ui| {
        Frame::popup(ui.style()).fill(theme::T.popup_bg).show(ui, |ui| {
            ui.set_max_width(720.0);
            ui.label(RichText::new(&popup.title).strong());
            ui.separator();
            ScrollArea::vertical().max_height(360.0).show(ui, |ui| {
                // Rows look like list items, not buttons, until hovered or selected.
                ui.visuals_mut().widgets.inactive.weak_bg_fill = theme::T.clear;
                ui.visuals_mut().widgets.inactive.bg_stroke = egui::Stroke::NONE;
                for (i, t) in popup.items.iter().enumerate() {
                    let rel = display_path(&root, &t.location.path);
                    let text = format!("{}:{}   {}", rel, t.location.line + 1, t.preview);
                    let r = ui.add(egui::Button::new(RichText::new(text).monospace()).selected(i == popup.selected).wrap_mode(egui::TextWrapMode::Truncate));
                    if r.clicked() {
                        chosen = Some(i);
                    }
                }
            });
        });
    });
    let clicked_outside = ctx.input(|i| i.pointer.any_pressed()) && !resp.response.contains_pointer();
    if let Some(i) = chosen {
        let t = popup.items.swap_remove(i);
        let from = popup.from.clone();
        state.nav.popup = None;
        jump_from(state, from, &t);
    } else if esc || clicked_outside {
        state.nav.popup = None;
    }
}

/// Paths inside the project are shown relative. Dependency paths start at `node_modules`,
/// at the crate directory of a Cargo registry source (`egui-0.31.1/src/ui.rs`), or at the
/// standard library (`library/core/src/option.rs`).
pub fn display_path(root: &Path, path: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(root) {
        return rel.display().to_string();
    }
    let s = path.display().to_string();
    if let Some(i) = s.find("node_modules/") {
        return s[i..].to_string();
    }
    if let Some(i) = s.find("/registry/src/") {
        // Skip the index directory (`index.crates.io-<hash>/`).
        let rest = &s[i + "/registry/src/".len()..];
        if let Some(j) = rest.find('/') {
            return rest[j + 1..].to_string();
        }
    }
    if let Some(i) = s.find("/lib/rustlib/src/rust/") {
        return s[i + "/lib/rustlib/src/rust/".len()..].to_string();
    }
    s
}

/// Hover handling for the active editor: 500 ms on one identifier asks the server for hover info.
pub fn hover(state: &mut AppState, tab: TabId, hover: Option<Position>, layer: LayerId, problems: &[(ide_editor::ProblemSeverity, String, String)]) {
    let ctx = state.ctx.clone();
    // Problems under the pointer show at once; quick info joins below once it arrives.
    let info_shown = state.nav.hover.info.is_some() && state.nav.hover.requested;
    if !problems.is_empty() && !info_shown {
        egui::show_tooltip_at_pointer(&ctx, layer, Id::new("ts-quick-info"), |ui| {
            ui.set_max_width(640.0);
            crate::diagnostics::problems::hover_ui(ui, problems);
        });
    }
    let Some(e) = state.tabs.editor_mut(tab) else { return };
    let modifiers = ctx.input(|i| i.modifiers);
    let lang = e.lang;
    let word = hover.filter(|_| lang.is_some() && !modifiers.command).and_then(|p| e.doc.word_at(p));
    let Some(word) = word else {
        state.nav.hover = HoverState { generation: state.nav.hover.generation, ..Default::default() };
        return;
    };
    let key = (e.path.clone(), word.start, word.end);
    let h = &mut state.nav.hover;
    if h.key.as_ref() != Some(&key) {
        h.generation += 1;
        *h = HoverState { key: Some(key), since: Some(Instant::now()), generation: h.generation, ..Default::default() };
    }
    let since = h.since.unwrap_or_else(Instant::now);
    let wait = Duration::from_millis(500);
    if !h.requested {
        if since.elapsed() < wait {
            ctx.request_repaint_after(wait - since.elapsed());
            return;
        }
        h.requested = true;
        let generation = h.generation;
        let path = e.path.clone();
        let pos = word.start;
        flush_lsp(state, tab);
        let jobs = state.jobs.clone();
        let Some(lang) = lang else { return };
        state.langs.bridge(lang).run(move |server| {
            let info = server.hover(&path, pos.line, pos.column);
            jobs.post(move |state| {
                if state.nav.hover.generation == generation {
                    state.nav.hover.info = info.ok().flatten();
                }
            });
        });
        return;
    }
    if let Some(info) = &state.nav.hover.info {
        egui::show_tooltip_at_pointer(&ctx, layer, Id::new("ts-quick-info"), |ui| {
            ui.set_max_width(640.0);
            if !problems.is_empty() {
                crate::diagnostics::problems::hover_ui(ui, problems);
                ui.separator();
            }
            ui.label(RichText::new(&info.display).monospace().color(theme::T.text_bright));
            if !info.documentation.is_empty() {
                ui.separator();
                ui.label(&info.documentation);
            }
            for (name, text) in info.tags.iter().take(8) {
                ui.label(RichText::new(format!("@{name} {text}")).weak());
            }
        });
    }
}

/// The Find Usages tool window body.
pub fn show_usages(state: &mut AppState, ui: &mut egui::Ui) {
    let root = state.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    let u = &state.usages;
    let took = if state.deterministic { String::new() } else { format!(" ({:.0} ms)", u.took_ms) };
    ui.horizontal(|ui| {
        if u.searching {
            ui.spinner();
            ui.label(format!("{}...", u.title));
        } else if u.title.is_empty() {
            ui.label(RichText::new("⌥F7 or the editor context menu: Find Usages").weak());
        } else {
            let n: usize = u.groups.iter().map(|g| g.refs.len()).sum();
            ui.label(RichText::new(format!("{}: {n} usages in {} files{took}", u.title, u.groups.len())).strong());
        }
    });
    ui.separator();
    let mut open = None;
    ScrollArea::both().auto_shrink([false, false]).id_salt("usages").show(ui, |ui| {
        for g in &u.groups {
            egui::CollapsingHeader::new(RichText::new(format!("{}  ({})", display_path(&root, &g.path), g.refs.len())).color(theme::T.text_bright))
                .id_salt(&g.path)
                .default_open(true)
                .show(ui, |ui| {
                    for r in &g.refs {
                        let marker = if r.is_write { "w " } else { "  " };
                        let label = format!("{marker}{:>5}  {}", r.location.line + 1, r.line_text.trim());
                        let resp = ui.add(egui::Button::new(RichText::new(label).monospace()).frame(false).wrap_mode(egui::TextWrapMode::Truncate));
                        if resp.clicked() {
                            open = Some((r.location.path.clone(), Position::new(r.location.line, r.location.column)));
                        }
                    }
                });
        }
    });
    if let Some((p, pos)) = open {
        state.open_location(&p, Some(pos), true);
    }
}

/// Screen position of the caret, for anchoring the chooser popup after a keyboard shortcut.
pub fn anchor_for(ctx: &Context, editor_rect: egui::Rect) -> Pos2 {
    match ctx.input(|i| i.pointer.hover_pos()) {
        Some(p) if editor_rect.contains(p) => p + egui::vec2(4.0, 12.0),
        _ => editor_rect.left_top() + egui::vec2(80.0, 40.0),
    }
}

#[cfg(test)]
mod tests {
    use super::display_path;
    use std::path::Path;

    #[test]
    fn dependency_paths_are_short() {
        let root = Path::new("/p/repo");
        assert_eq!(display_path(root, Path::new("/p/repo/src/main.rs")), "src/main.rs");
        assert_eq!(display_path(root, Path::new("/p/repo/node_modules/x/index.d.ts")), "node_modules/x/index.d.ts");
        assert_eq!(display_path(root, Path::new("/h/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/egui-0.31.1/src/ui.rs")), "egui-0.31.1/src/ui.rs");
        assert_eq!(display_path(root, Path::new("/r/toolchains/stable/lib/rustlib/src/rust/library/core/src/option.rs")), "library/core/src/option.rs");
        assert_eq!(display_path(root, Path::new("/elsewhere/a.rs")), "/elsewhere/a.rs");
    }
}
