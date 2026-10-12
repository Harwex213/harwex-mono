//! What the canvas shows, in world coordinates: package boxes, file cards and arrow polylines.
//! Built on a worker from the discovered workspace and its layout; read-only afterwards except
//! for the import overlay that tsserver results fill in.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use egui::{pos2, Pos2, Rect};
use scs_layout::{Seg, Size};
use scs_workspace::{DepKind, Workspace};

use crate::theme::T;

pub struct Card {
    pub rect: Rect,
    pub title: String,
    pub path: PathBuf,
    /// Lines the card has room for (its text is read later, when it shows on screen).
    pub shown: usize,
}

/// A card's text, read on a worker the first time the card is on screen close enough.
pub struct CardText {
    pub lines: Arc<[String]>,
    /// Lines not shown.
    pub more: usize,
    /// Per shown line: first non-blank column and length in chars, for the mid-zoom bars.
    pub bars: Vec<(u16, u16)>,
}

impl CardText {
    pub fn read(path: &std::path::Path, max_lines: usize) -> CardText {
        let p = scs_workspace::read_preview(path, max_lines);
        let bars = p
            .lines
            .iter()
            .map(|l| {
                let indent = l.chars().take_while(|c| *c == ' ').count();
                let len = l.chars().count() - indent;
                (indent.min(u16::MAX as usize) as u16, len.min(u16::MAX as usize) as u16)
            })
            .collect();
        CardText { more: p.total_lines.saturating_sub(p.lines.len()), lines: p.lines, bars }
    }
}

pub struct PackageView {
    pub name: String,
    pub rel_dir: String,
    /// The frame. The name sits in the band above it.
    pub rect: Rect,
    pub cards: Vec<Card>,
}

pub struct Edge {
    pub from: usize,
    pub to: usize,
    pub kind: DepKind,
    pub points: Vec<Pos2>,
    pub bbox: Rect,
}

#[derive(Default)]
pub struct Timings {
    pub discover_ms: f64,
    pub layout_ms: f64,
}

/// `(package, card)` of an importing file, and the package and card it imports.
pub type FileEdge = ((usize, usize), (usize, Option<usize>));

/// File-level results from tsserver, mapped onto the scene.
#[derive(Default)]
pub struct Imports {
    /// `(from package, from card) -> (to package, to card)`; card `None` when the target file
    /// is not a card (outside the package's sources).
    pub file_edges: Vec<FileEdge>,
    /// Import count per package pair.
    pub per_pair: HashMap<(usize, usize), usize>,
    /// Imports that no package.json dependency declares, with their arrows.
    pub undeclared: Vec<Edge>,
    pub out_count: HashMap<(usize, usize), usize>,
    pub in_count: HashMap<(usize, usize), usize>,
    seen: HashSet<FileEdge>,
}

pub struct Scene {
    pub root: PathBuf,
    pub packages: Vec<PackageView>,
    pub edges: Vec<Edge>,
    pub unconnected_area: Option<Rect>,
    pub bounds: Rect,
    pub file_count: usize,
    pub file_index: HashMap<PathBuf, (usize, usize)>,
    pub package_names: HashSet<String>,
    pub timings: Timings,
    pub imports: Imports,
    /// The layout parameters the scene was built with (label and title bands).
    pub params: scs_layout::Params,
}

/// Height of a card with `shown` lines and maybe a "+K lines" footer.
fn card_height(shown: usize, truncated: bool) -> f32 {
    let s = &T.sizes;
    let rows = shown.max(1) + usize::from(truncated);
    s.card_title_h + 2.0 * s.card_pad + rows as f32 * s.code_line_h
}

/// The widest a package name gets in world units, roughly; the box is made at least this wide.
pub fn label_width(name: &str) -> f32 {
    name.chars().count() as f32 * T.sizes.label_font * 0.6 + 16.0
}

/// Lines a card shows at most.
pub const PREVIEW_LINES: usize = 36;

pub fn build(ws: Workspace, discover_ms: f64) -> Scene {
    let start = Instant::now();
    let input = scs_layout::Input {
        cards: ws
            .packages
            .iter()
            .map(|p| p.files.iter().map(|f| Size::new(T.sizes.card_w, card_height(f.lines.min(PREVIEW_LINES), f.lines > PREVIEW_LINES))).collect())
            .collect(),
        min_width: ws.packages.iter().map(|p| label_width(&p.name)).collect(),
        edges: ws.deps.iter().map(|d| (d.from, d.to)).collect(),
    };
    let params = scs_layout::Params::default();
    let lay = scs_layout::layout(&input, &params);

    let mut file_index = HashMap::new();
    let mut packages = Vec::with_capacity(ws.packages.len());
    for (pi, p) in ws.packages.iter().enumerate() {
        let cards = p
            .files
            .iter()
            .enumerate()
            .map(|(fi, f)| {
                file_index.insert(f.path.clone(), (pi, fi));
                Card { rect: rect(lay.cards[pi][fi]), title: f.rel_path.clone(), path: f.path.clone(), shown: f.lines.min(PREVIEW_LINES) }
            })
            .collect();
        packages.push(PackageView { name: p.name.clone(), rel_dir: p.rel_dir.clone(), rect: rect(lay.boxes[pi]), cards });
    }
    let edges = ws
        .deps
        .iter()
        .zip(&lay.routes)
        .filter_map(|(d, r)| {
            let points = polyline(&r.as_ref()?.segs);
            Some(Edge { from: d.from, to: d.to, kind: d.kind, bbox: bbox(&points), points })
        })
        .collect();
    let layout_ms = start.elapsed().as_secs_f64() * 1000.0;
    Scene {
        file_count: ws.file_count(),
        package_names: ws.packages.iter().map(|p| p.name.clone()).collect(),
        root: ws.root,
        packages,
        edges,
        unconnected_area: lay.unconnected_area.map(rect),
        bounds: rect(lay.bounds),
        file_index,
        timings: Timings { discover_ms, layout_ms },
        imports: Imports::default(),
        params,
    }
}

fn rect(r: scs_layout::Rect) -> Rect {
    Rect::from_min_size(pos2(r.x, r.y), egui::vec2(r.w, r.h))
}

/// Curves are sampled into short straight pieces once, in world space.
pub fn polyline(segs: &[Seg]) -> Vec<Pos2> {
    let mut pts: Vec<Pos2> = Vec::new();
    for s in segs {
        let (a, _) = s.ends();
        if pts.is_empty() {
            pts.push(pos2(a.x, a.y));
        }
        let n = if matches!(s, Seg::Curve(..)) { 24 } else { 1 };
        for i in 1..=n {
            let p = s.at(i as f32 / n as f32);
            pts.push(pos2(p.x, p.y));
        }
    }
    pts
}

fn bbox(points: &[Pos2]) -> Rect {
    Rect::from_points(points).expand(2.0)
}

impl Scene {
    pub fn declared(&self, from: usize, to: usize) -> bool {
        self.edges.iter().any(|e| e.from == from && e.to == to)
    }

    /// Adds resolved imports of one file. `targets` are canonical module files.
    pub fn add_imports(&mut self, file: &std::path::Path, targets: &[PathBuf]) {
        let Some(&(fp, fc)) = self.file_index.get(file) else { return };
        for t in targets {
            let to = match self.file_index.get(t) {
                Some(&(tp, tc)) => (tp, Some(tc)),
                None => match self.packages.iter().position(|p| !p.rel_dir.is_empty() && t.starts_with(self.root.join(&p.rel_dir))) {
                    Some(tp) => (tp, None),
                    None => continue,
                },
            };
            if to.0 == fp || !self.imports.seen.insert(((fp, fc), to)) {
                continue;
            }
            self.imports.file_edges.push(((fp, fc), to));
            *self.imports.per_pair.entry((fp, to.0)).or_default() += 1;
            *self.imports.out_count.entry((fp, fc)).or_default() += 1;
            if let (tp, Some(tc)) = to {
                *self.imports.in_count.entry((tp, tc)).or_default() += 1;
            }
            if !self.declared(fp, to.0) && !self.imports.undeclared.iter().any(|e| e.from == fp && e.to == to.0) {
                let r = scs_layout::direct_route(&lrect(self.packages[fp].rect), &lrect(self.packages[to.0].rect));
                let points = polyline(&r.segs);
                self.imports.undeclared.push(Edge { from: fp, to: to.0, kind: DepKind::Prod, bbox: bbox(&points), points });
            }
        }
    }
}

fn lrect(r: Rect) -> scs_layout::Rect {
    scs_layout::Rect::new(r.min.x, r.min.y, r.width(), r.height())
}
