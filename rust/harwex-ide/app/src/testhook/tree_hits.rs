//! `--test-tree-hits <w1,w2,...>`: probes the Project tree rows of the real window with
//! injected pointer events and logs a hit map per panel width (see `docs/testing.md`).
//!
//! The hook owns the input clock: each probe starts a second after the last one, so egui never
//! merges two probes into a double click.

use std::collections::VecDeque;
use std::path::PathBuf;

use egui::{pos2, Event, Id, Modifiers, PointerButton, Pos2, Rect};

use crate::state::AppState;

/// One tree row as drawn last frame.
#[derive(Clone)]
pub struct HitRow {
    pub path: PathBuf,
    pub is_dir: bool,
    pub rect: Rect,
    pub id: Id,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Hover,
    Click,
    Double,
}

struct Probe {
    row: usize,
    x: f32,
    kind: Kind,
}

#[derive(Default)]
pub struct TreeHits {
    widths: VecDeque<f32>,
    /// Rows recorded by `tree::show` on the last frame.
    pub rows: Vec<HitRow>,
    probing: Vec<HitRow>,
    probes: VecDeque<Probe>,
    /// Events for the next frame, and the frames to wait before the next step.
    pending: VecDeque<Vec<Event>>,
    current: Option<Probe>,
    wait: u32,
    clock: f64,
    width: f32,
    lines: Vec<(usize, Kind, String)>,
    before_selected: Option<PathBuf>,
    before_expanded: bool,
    done: bool,
    /// Frames seen; the probes start after a warm-up (git status, file index).
    frames: u32,
}

impl TreeHits {
    pub fn is_done(&self) -> bool {
        self.done
    }

    pub fn parse(arg: &str) -> TreeHits {
        TreeHits { widths: arg.split(',').filter_map(|w| w.trim().parse().ok()).collect(), ..Default::default() }
    }
}

/// `eframe::App::raw_input_hook`: replaces the clock and feeds the probe events.
pub fn inject(state: &mut AppState, raw: &mut egui::RawInput) {
    let Some(h) = state.test.as_mut().and_then(|t| t.tree_hits.as_mut()) else { return };
    // The clock stays ours to the end: egui panics when input time moves backwards.
    h.clock += 0.02;
    raw.time = Some(h.clock);
    if h.done {
        return;
    }
    // The real pointer must not interfere.
    raw.events.retain(|e| !matches!(e, Event::PointerMoved(_) | Event::PointerButton { .. } | Event::PointerGone | Event::MouseMoved(_)));
    if let Some(events) = h.pending.pop_front() {
        raw.events.extend(events);
    }
}

fn press(p: Pos2, pressed: bool) -> Event {
    Event::PointerButton { pos: p, button: PointerButton::Primary, pressed, modifiers: Modifiers::NONE }
}

/// Called once per frame from `testhook::tick`, after the UI ran.
pub fn tick(state: &mut AppState) {
    let ctx = state.ctx.clone();
    ctx.request_repaint();
    let Some(h) = state.test.as_mut().and_then(|t| t.tree_hits.as_mut()) else { return };
    if h.done {
        return;
    }
    h.frames += 1;
    if h.frames < 120 {
        return;
    }
    if h.wait > 0 {
        h.wait -= 1;
        return;
    }
    // Read the result of the probe whose events ran.
    if let Some(p) = h.current.take() {
        if !h.pending.is_empty() {
            h.current = Some(p);
            return;
        }
        let row = h.probing[p.row].clone();
        let ch = match p.kind {
            Kind::Hover => match ctx.viewport(|v| v.hits.click.map(|w| w.id)) {
                Some(id) if id == row.id => '.',
                Some(_) => 'X',
                None => '_',
            },
            Kind::Click | Kind::Double => {
                let tree = &state.ws.tree;
                let selected = tree.selected.as_deref() == Some(row.path.as_path()) && h.before_selected.as_deref() != Some(row.path.as_path());
                let toggled = tree.is_expanded(&row.path) != h.before_expanded;
                match (p.kind, toggled, selected) {
                    (Kind::Click, true, true) => 'B',
                    (Kind::Click, true, false) => 't',
                    (Kind::Click, false, true) => 's',
                    (Kind::Double, true, _) => 't',
                    _ => '.',
                }
            }
        };
        let h = state.test.as_mut().and_then(|t| t.tree_hits.as_mut()).expect("hook");
        match h.lines.iter_mut().find(|(r, k, _)| *r == p.row && *k == p.kind) {
            Some((_, _, s)) => s.push(ch),
            None => h.lines.push((p.row, p.kind, ch.to_string())),
        }
        // Undo what the probe changed, so every probe starts from the same tree.
        if row.is_dir {
            let expanded = h.before_expanded;
            state.ws.tree.set_expanded(&row.path, expanded);
        }
        state.ws.tree.selected = None;
        let h = state.test.as_mut().and_then(|t| t.tree_hits.as_mut()).expect("hook");
        h.wait = if p.kind == Kind::Hover { 0 } else { 1 };
        return;
    }
    if h.probes.len() % 200 == 0 && !h.probes.is_empty() {
        eprintln!("[test-tree-hits] {} probes left, input clock {:.0}s, frame {}", h.probes.len(), h.clock, h.frames);
    }
    if let Some(p) = h.probes.pop_front() {
        let row = &h.probing[p.row];
        let at = pos2(p.x, row.rect.center().y);
        h.before_selected = state.ws.tree.selected.clone();
        h.before_expanded = state.ws.tree.is_expanded(&row.path);
        // A second of quiet input time: the probe is a fresh click, never part of the last one.
        h.clock += 1.0;
        let mut first = vec![Event::PointerMoved(at)];
        match p.kind {
            Kind::Hover => h.pending.push_back(first),
            Kind::Click => {
                first.push(press(at, true));
                h.pending.push_back(first);
                h.pending.push_back(vec![press(at, false)]);
            }
            Kind::Double => {
                first.push(press(at, true));
                h.pending.push_back(first);
                h.pending.push_back(vec![press(at, false)]);
                h.pending.push_back(vec![press(at, true)]);
                h.pending.push_back(vec![press(at, false)]);
            }
        }
        h.current = Some(p);
        return;
    }
    // Between widths: log the last map, then set the next width.
    if !h.probing.is_empty() {
        eprintln!("[test-tree-hits] panel {} rows {}", h.width, h.probing.len());
        let mut lines = std::mem::take(&mut h.lines);
        lines.sort_by_key(|(r, k, _)| (*r, *k as u8));
        for (r, k, s) in lines {
            let row = &h.probing[r];
            let name = row.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            eprintln!("[test-tree-hits] {:>6} {} x0={:.1} w={:.1} {:<28} {}", match k { Kind::Hover => "hit", Kind::Click => "click", Kind::Double => "double" }, if row.is_dir { "dir " } else { "file" }, row.rect.min.x, row.rect.width(), name, s);
        }
        h.probing.clear();
    }
    let Some(&w) = h.widths.front() else {
        eprintln!("[test-tree-hits] done");
        h.done = true;
        return;
    };
    if h.width != w {
        h.width = w;
        let ctx2 = ctx.clone();
        ctx2.data_mut(|d| {
            let id = crate::workspace::wid("left-tool-window");
            let old: Option<egui::containers::panel::PanelState> = d.get_persisted(id);
            let min = old.map_or(pos2(40.0, 40.0), |s| s.rect.min);
            d.insert_persisted(id, egui::containers::panel::PanelState { rect: Rect::from_min_size(min, egui::vec2(w, 600.0)) });
        });
        h.wait = 10;
        return;
    }
    h.widths.pop_front();
    // Folders and files, a few of each, from the visible rows.
    let dirs = h.rows.iter().filter(|r| r.is_dir).take(5);
    let files = h.rows.iter().filter(|r| !r.is_dir).take(1);
    h.probing = dirs.chain(files).cloned().collect();
    eprintln!("[test-tree-hits] window {:?} panel {:?}", ctx.screen_rect().size(), current_width(&ctx));
    // Every other widget that senses clicks or drags and overlaps a row.
    let ids: Vec<Id> = h.rows.iter().map(|r| r.id).collect();
    let area = h.rows.iter().fold(Rect::NOTHING, |a, r| a.union(r.rect));
    ctx.viewport(|v| {
        for (layer, ws) in v.prev_pass.widgets.layers() {
            for w in ws {
                if w.interact_rect.intersects(area) && (w.sense.senses_click() || w.sense.senses_drag()) && !ids.contains(&w.id) {
                    eprintln!("[test-tree-hits] overlap {:?} {:?} rect {:?} interact {:?} {:?}", layer, w.id, w.rect, w.interact_rect, w.sense);
                }
            }
        }
    });
    for (i, row) in h.probing.iter().enumerate() {
        let mut x = row.rect.min.x + 0.5;
        while x < row.rect.max.x {
            h.probes.push_back(Probe { row: i, x, kind: Kind::Hover });
            x += 1.0;
        }
        let mut x = row.rect.min.x + 0.5;
        while x < row.rect.max.x {
            h.probes.push_back(Probe { row: i, x, kind: Kind::Click });
            if row.is_dir {
                h.probes.push_back(Probe { row: i, x, kind: Kind::Double });
            }
            x += 8.0;
        }
    }
}

fn current_width(ctx: &egui::Context) -> f32 {
    ctx.data_mut(|d| d.get_persisted::<egui::containers::panel::PanelState>(crate::workspace::wid("left-tool-window")).map_or(0.0, |s| s.rect.width()))
}
