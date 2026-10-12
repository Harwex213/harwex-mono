//! The infinite canvas: input (pan, zoom, fit) and painting with egui's `Painter` under our own
//! camera. Everything off screen is culled, and detail drops with zoom: code text, then grey
//! line bars, then plain card fills, then plain boxes.

use egui::epaint::{CubicBezierShape, PathShape, PathStroke};
use egui::text::{LayoutJob, TextFormat};
use egui::{pos2, vec2, Align2, Color32, CornerRadius, FontId, Painter, Pos2, Rect, Sense, Shape, Stroke, StrokeKind, Ui};
use scs_workspace::DepKind;

use crate::highlight::{self, Kind};
use crate::scene::{Card, Edge, Scene};
use crate::theme::T;
use crate::{Phase, State, TsStatus, ViewRequest};

pub(crate) fn show(ui: &mut Ui, state: &mut State) {
    let view = ui.max_rect();
    state.view = view;
    state.apply_view_request();
    let response = ui.interact(view, ui.id().with("canvas"), Sense::click_and_drag());
    input(ui, state, &response);
    let painter = ui.painter_at(view);

    match &state.phase {
        Phase::Loading => {
            let n = state.progress.load(std::sync::atomic::Ordering::Relaxed);
            let msg = if n == 0 { format!("Reading {}…", state.options.project.display()) } else { format!("Reading {}…  {n} source files so far", state.options.project.display()) };
            painter.text(view.center(), Align2::CENTER_CENTER, msg, T.ui(16.0), T.hud_dim);
            return;
        }
        Phase::Failed(e) => {
            painter.text(view.center(), Align2::CENTER_CENTER, e, T.ui(16.0), T.error);
            return;
        }
        Phase::Ready => {}
    }
    let Some(scene) = &state.scene else { return };
    let cam = state.camera;
    let world_view = cam.visible(view);

    grid(&painter, state, view);

    let hovered_pkg = state.hovered.map(|h| h.0);
    let mut budget = Budget::default();
    let mut want = Vec::new();
    for (pi, p) in scene.packages.iter().enumerate() {
        if !p.rect.intersects(world_view) {
            continue;
        }
        let r = cam.rect_to_screen(view, p.rect);
        let radius = CornerRadius::same((T.sizes.box_radius * cam.zoom).clamp(1.0, 14.0) as u8);
        let border = if hovered_pkg == Some(pi) { T.box_border_hover } else { T.box_border };
        // Far: a box is a box. Its cards would be specks, and there may be 100k of them.
        let far = T.sizes.card_w * cam.zoom < FAR_CARD_PX || !budget.take_cards(p.cards.len());
        painter.rect(r, radius, if far { T.box_fill_far } else { T.box_fill }, Stroke::new(1.0_f32, border), StrokeKind::Inside);
        if far {
            continue;
        }
        for (ci, card) in p.cards.iter().enumerate() {
            if card.rect.intersects(world_view) {
                let hover = state.hovered == Some((pi, ci));
                paint_card(&painter, scene, state, view, (pi, ci), card, hover, &mut budget, &mut want);
            }
        }
    }
    for e in &scene.edges {
        let count = scene.imports.per_pair.get(&(e.from, e.to)).copied();
        paint_edge(&painter, state, view, e, count, false, &mut budget);
    }
    for e in &scene.imports.undeclared {
        let count = scene.imports.per_pair.get(&(e.from, e.to)).copied();
        paint_edge(&painter, state, view, e, count, true, &mut budget);
    }
    paint_file_edges(&painter, scene, state, view);
    paint_labels(&painter, scene, state, view);
    hud(&painter, scene, state, view);
    state.want_text = want;
}

fn input(ui: &Ui, state: &mut State, response: &egui::Response) {
    if response.dragged_by(egui::PointerButton::Primary) || response.dragged_by(egui::PointerButton::Middle) {
        state.camera.center -= response.drag_delta() / state.camera.zoom;
    }
    let (scroll, zoom, pointer, fit) = ui.input(|i| {
        (i.smooth_scroll_delta, i.zoom_delta(), i.pointer.hover_pos(), i.key_pressed(egui::Key::F) || i.key_pressed(egui::Key::Num0))
    });
    if response.hovered() {
        if zoom != 1.0 {
            state.zoom_at(pointer.unwrap_or(state.view.center()), zoom);
        } else if scroll != egui::Vec2::ZERO {
            state.camera.center -= scroll / state.camera.zoom;
        }
    }
    if fit {
        state.request_view(ViewRequest::Fit);
    }
    state.hovered = None;
    if let (Some(p), Some(scene)) = (pointer.filter(|p| state.view.contains(*p)), &state.scene) {
        let w = state.camera.to_world(state.view, p);
        state.hovered = scene.packages.iter().enumerate().find(|(_, pk)| pk.rect.contains(w)).and_then(|(pi, pk)| pk.cards.iter().position(|c| c.rect.contains(w)).map(|ci| (pi, ci)));
        if response.double_clicked() {
            if let Some(pk) = scene.packages.iter().find(|pk| pk.rect.contains(w)) {
                state.request_view(ViewRequest::Package(pk.name.clone()));
            }
        }
    }
}

/// Below this card width on screen, packages are drawn as plain boxes.
const FAR_CARD_PX: f32 = 6.0;

/// Hard limits per frame. egui puts the whole frame into one vertex and one index buffer, and
/// wgpu refuses buffers over 256 MB; these keep a frame in the low megabytes on any repo.
/// Past a limit, the rest is drawn at the next cheaper level of detail or skipped.
const MAX_CARDS: usize = 8_000;
const MAX_TEXT_LINES: usize = 3_000;
const MAX_BARS: usize = 40_000;
const MAX_EDGE_POINTS: usize = 120_000;
const MAX_LABELS: usize = 600;

#[derive(Default)]
struct Budget {
    cards: usize,
    text_lines: usize,
    bars: usize,
    edge_points: usize,
}

impl Budget {
    /// Reserves room for `n` cards of one package, all or nothing, so a package never shows
    /// half its cards.
    fn take_cards(&mut self, n: usize) -> bool {
        if self.cards + n > MAX_CARDS {
            return false;
        }
        self.cards += n;
        true
    }
}

/// Font sizes snap to a few steps: every distinct size fills the font atlas anew.
fn quantize(px: f32) -> f32 {
    let px = px.clamp(4.0, 72.0);
    if px < 12.0 {
        (px * 2.0).round() / 2.0
    } else if px < 32.0 {
        px.round()
    } else {
        (px / 4.0).round() * 4.0
    }
}

fn grid(painter: &Painter, state: &State, view: Rect) {
    let cam = state.camera;
    // A world spacing that lands between 28 and 56 px on screen.
    let mut step = 40.0f32;
    while step * cam.zoom < 28.0 {
        step *= 2.0;
    }
    while step * cam.zoom > 56.0 {
        step /= 2.0;
    }
    let w = cam.visible(view);
    let (x0, y0) = ((w.min.x / step).floor() as i64, (w.min.y / step).floor() as i64);
    let (x1, y1) = ((w.max.x / step).ceil() as i64, (w.max.y / step).ceil() as i64);
    if (x1 - x0) * (y1 - y0) > 4000 {
        return;
    }
    for gx in x0..=x1 {
        for gy in y0..=y1 {
            let p = cam.to_screen(view, pos2(gx as f32 * step, gy as f32 * step));
            painter.rect_filled(Rect::from_center_size(p, vec2(1.5, 1.5)), 0.0, T.grid_dot);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn paint_card(painter: &Painter, scene: &Scene, state: &State, view: Rect, id: (usize, usize), card: &Card, hover: bool, budget: &mut Budget, want: &mut Vec<(usize, usize)>) {
    let cam = state.camera;
    let s = &T.sizes;
    let r = cam.rect_to_screen(view, card.rect);
    let z = cam.zoom;
    if r.width() < 3.0 {
        painter.rect_filled(r, 0.0, T.card_far);
        return;
    }
    let radius = CornerRadius::same((s.card_radius * z).clamp(0.0, 8.0) as u8);
    let border = if hover { T.box_border_hover } else { T.card_border };
    painter.rect(r, radius, T.card_fill, Stroke::new(if hover { 1.5_f32 } else { 1.0 }, border), StrokeKind::Inside);
    let title = Rect::from_min_size(r.min, vec2(r.width(), s.card_title_h * z));
    painter.rect_filled(title.shrink(0.5), CornerRadius { nw: radius.nw, ne: radius.ne, sw: 0, se: 0 }, T.card_title_bg);
    let clip = painter.clip_rect().intersect(r.shrink(1.0));
    let p = painter.with_clip_rect(clip);
    let pad = s.card_pad * z;

    let title_px = s.card_title_font * z;
    if title_px >= s.text_min_px {
        let font = T.ui(quantize(title_px));
        let mut right = title.right() - pad;
        // Badges: imports into other packages, and imports from other packages.
        for (count, color, arrow) in [(scene.imports.in_count.get(&id), T.badge_in, "←"), (scene.imports.out_count.get(&id), T.badge_out, "→")] {
            if let Some(n) = count {
                let g = p.layout_no_wrap(format!("{arrow} {n}"), font.clone(), color);
                right -= g.size().x;
                p.galley(pos2(right, title.center().y - g.size().y / 2.0), g, color);
                right -= pad * 0.8;
            }
        }
        let g = p.layout_no_wrap(card.title.clone(), font, T.card_title);
        let tp = pos2(title.left() + pad, title.center().y - g.size().y / 2.0);
        p.with_clip_rect(clip.intersect(Rect::from_x_y_ranges(title.left()..=right, title.y_range()))).galley(tp, g, T.card_title);
    }

    let top = r.top() + (s.card_title_h + s.card_pad) * z;
    let line_h = s.code_line_h * z;
    let code_px = s.code_font * z;
    let left = r.left() + pad;
    let body = Rect::from_min_max(pos2(left, top), pos2(r.right() - pad, r.bottom() - pad));
    let plain = |p: &Painter| {
        if body.is_positive() {
            p.rect_filled(body, 0.0, T.card_far);
        }
    };
    if line_h < s.bar_min_px {
        plain(&p);
        return;
    }
    // Bars and text need the file's lines, read on a worker the first time they are wanted.
    let Some(text) = state.texts.get(&id) else {
        want.push(id);
        plain(&p);
        return;
    };
    let lines = text.lines.len().min(card.shown.max(1));
    if code_px >= s.text_min_px && budget.text_lines + lines <= MAX_TEXT_LINES {
        budget.text_lines += lines;
        let font = T.mono(quantize(code_px));
        let mut in_block = false;
        for (i, line) in text.lines.iter().take(lines).enumerate() {
            let y = top + i as f32 * line_h;
            if y > clip.bottom() {
                break;
            }
            let job = code_job(line, &font, &mut in_block);
            if y + line_h < clip.top() {
                continue;
            }
            let g = p.fonts(|f| f.layout_job(job));
            p.galley(pos2(left, y + (line_h - g.size().y) / 2.0), g, T.code);
        }
        let more = text.more + text.lines.len() - lines;
        let footer = if text.lines.is_empty() { Some("(empty)".to_string()) } else { (more > 0).then(|| format!("… +{more} lines")) };
        if let Some(f) = footer {
            let y = top + lines.min(text.lines.len()) as f32 * line_h;
            p.text(pos2(left, y + line_h / 2.0), Align2::LEFT_CENTER, f, T.ui(quantize(code_px)), T.code_more);
        }
    } else if budget.bars + lines <= MAX_BARS {
        budget.bars += lines;
        let cw = s.code_font * 0.6 * z;
        let inner_right = r.right() - pad;
        for (i, &(indent, len)) in text.bars.iter().take(lines).enumerate() {
            if len == 0 {
                continue;
            }
            let y = top + i as f32 * line_h + line_h * 0.28;
            let x0 = left + indent as f32 * cw;
            let x1 = (x0 + len as f32 * cw).min(inner_right);
            if x1 > x0 {
                p.rect_filled(Rect::from_min_max(pos2(x0, y), pos2(x1, y + line_h * 0.44)), 0.0, T.code_bar);
            }
        }
    } else {
        plain(&p);
    }
}

fn code_job(line: &str, font: &FontId, in_block: &mut bool) -> LayoutJob {
    let mut job = LayoutJob::default();
    for (range, kind) in highlight::line(line, in_block) {
        let color = match kind {
            Kind::Plain => T.code,
            Kind::Keyword => T.code_keyword,
            Kind::String => T.code_string,
            Kind::Comment => T.code_comment,
            Kind::Number => T.code_number,
            Kind::Type => T.code_type,
        };
        job.append(&line[range], 0.0, TextFormat::simple(font.clone(), color));
    }
    job
}

#[allow(clippy::too_many_arguments)]
fn paint_edge(painter: &Painter, state: &State, view: Rect, e: &Edge, imports: Option<usize>, undeclared: bool, budget: &mut Budget) {
    let cam = state.camera;
    if !e.bbox.intersects(cam.visible(view)) {
        return;
    }
    let sb = cam.rect_to_screen(view, e.bbox);
    if sb.width() < 2.0 && sb.height() < 2.0 {
        return;
    }
    // Points closer than a couple of pixels add vertices and no shape.
    let mut pts: Vec<Pos2> = Vec::with_capacity(e.points.len());
    for (i, p) in e.points.iter().enumerate() {
        let q = cam.to_screen(view, *p);
        if i + 1 == e.points.len() || pts.last().is_none_or(|l: &Pos2| l.distance(q) >= 2.0) {
            pts.push(q);
        }
    }
    if pts.len() < 2 || budget.edge_points + pts.len() > MAX_EDGE_POINTS {
        return;
    }
    budget.edge_points += pts.len();
    let hot = state.hovered.is_some_and(|(p, _)| p == e.from || p == e.to);
    let (color, dashed) = match (undeclared, e.kind) {
        (true, _) => (T.edge_undeclared, true),
        (false, DepKind::Prod) => (T.edge, false),
        (false, _) => (T.edge_dev, true),
    };
    let color = if hot { T.box_border_hover } else { color };
    let mut w = T.sizes.edge_w * (1.0 + 0.35 * (imports.unwrap_or(0) as f32 + 1.0).log2()).min(2.5);
    if hot {
        w += 0.8;
    }
    let stroke = Stroke::new(w, color);
    // The head covers the last stretch, so the line stops at its base.
    let head = (T.sizes.arrow_px * cam.zoom.max(1.0)).min(18.0) + w;
    let tip = *pts.last().expect("edge has points");
    let back = pts.iter().rev().find(|p| p.distance(tip) > head * 0.5).copied().unwrap_or(pts[0]);
    let dir = (tip - back).normalized();
    let base = tip - dir * head;
    let mut body = pts.clone();
    while body.len() > 2 && body[body.len() - 2].distance(tip) < head {
        body.pop();
    }
    if let Some(last) = body.last_mut() {
        *last = base;
    }
    if dashed {
        painter.extend(Shape::dashed_line(&body, stroke, 7.0, 5.0));
    } else {
        painter.add(PathShape::line(body, stroke));
    }
    let n = vec2(-dir.y, dir.x) * head * 0.45;
    painter.add(Shape::convex_polygon(vec![tip, base + n, base - n], color, Stroke::NONE));
}

fn paint_file_edges(painter: &Painter, scene: &Scene, state: &State, view: Rect) {
    let cam = state.camera;
    if cam.zoom < 0.12 || scene.imports.file_edges.is_empty() {
        return;
    }
    let world_view = cam.visible(view);
    let anchor = |pi: usize, ci: Option<usize>, out: bool| -> (Rect, Pos2) {
        let p = &scene.packages[pi];
        let r = ci.map_or(p.rect, |c| p.cards[c].rect);
        let y = if ci.is_some() { r.top() + T.sizes.card_title_h / 2.0 } else { r.top() + 20.0 };
        (r, pos2(if out { r.right() } else { r.left() }, y))
    };
    let mut drawn = 0;
    for &((fp, fc), (tp, tc)) in &scene.imports.file_edges {
        let (ra, a) = anchor(fp, Some(fc), true);
        let (rb, b) = anchor(tp, tc, false);
        if !ra.intersects(world_view) && !rb.intersects(world_view) {
            continue;
        }
        let hot = state.hovered == Some((fp, fc)) || (tc.is_some() && state.hovered == Some((tp, tc.unwrap_or(0))));
        let (a, b) = (cam.to_screen(view, a), cam.to_screen(view, b));
        let dx = ((b.x - a.x).abs() / 2.0).max(40.0);
        let color = if hot { T.file_edge_hover } else { T.file_edge };
        let w = if hot { T.sizes.file_edge_w + 1.0 } else { T.sizes.file_edge_w };
        painter.add(CubicBezierShape::from_points_stroke([a, a + vec2(dx, 0.0), b - vec2(dx, 0.0), b], false, Color32::TRANSPARENT, PathStroke::new(w, color)));
        painter.circle_filled(b, 2.5 + w / 2.0, color);
        drawn += 1;
        if drawn > 3000 {
            break;
        }
    }
}

fn paint_labels(painter: &Painter, scene: &Scene, state: &State, view: Rect) {
    let cam = state.camera;
    let world_view = cam.visible(view);
    let s = &T.sizes;
    // Big packages claim their label spot first; a label that would overlap one already
    // placed is skipped.
    let mut order: Vec<usize> = (0..scene.packages.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(scene.packages[i].cards.len()));
    let mut placed: Vec<Rect> = Vec::new();
    if let Some(area) = scene.unconnected_area {
        let px = (T.sizes.area_title_font * cam.zoom).max(13.0);
        let g = painter.layout_no_wrap("Packages without internal dependencies".into(), T.semibold(quantize(px)), T.label_dim);
        // Sit right above the first row of package names, whatever size they are drawn at.
        let first_box_top = cam.to_screen(view, area.min + vec2(0.0, scene.params.area_title_h + scene.params.label_h)).y;
        let label_px = quantize((s.label_font * cam.zoom).max(s.label_min_px));
        let bottom = first_box_top - (8.0 * cam.zoom).max(2.0) - label_px * 1.3 - 6.0;
        let at = pos2(cam.to_screen(view, area.min).x, bottom - g.size().y);
        placed.push(Rect::from_min_size(at, g.size()).expand(2.0));
        painter.galley(at, g, T.label_dim);
    }
    for i in order {
        if placed.len() >= MAX_LABELS {
            break;
        }
        let p = &scene.packages[i];
        let band = Rect::from_min_max(p.rect.min - vec2(0.0, 60.0), pos2(p.rect.max.x, p.rect.min.y));
        if !band.intersects(world_view) {
            continue;
        }
        let r = cam.rect_to_screen(view, p.rect);
        let px = s.label_font * cam.zoom;
        let enlarged = px < s.label_min_px;
        let font = T.semibold(quantize(px.max(s.label_min_px)));
        let max_w = r.width().max(180.0);
        // A name wider than the box ends in an ellipsis instead of being cut mid-letter.
        let mut job = LayoutJob::simple_singleline(p.name.clone(), font.clone(), T.label);
        job.wrap.max_width = max_w;
        job.wrap.max_rows = 1;
        job.wrap.break_anywhere = true;
        let g = painter.layout_job(job);
        let w = g.size().x.min(max_w);
        let h = g.size().y;
        let gap = (8.0 * cam.zoom).max(2.0);
        let at = pos2(r.left(), r.top() - gap - h);
        let rect = Rect::from_min_size(at, vec2(w, h)).expand(2.0);
        if placed.iter().any(|q| q.intersects(rect)) {
            continue;
        }
        placed.push(rect);
        if enlarged {
            painter.rect_filled(rect, 3.0, T.label_halo);
        }
        let clip = painter.clip_rect().intersect(Rect::from_min_size(at, vec2(max_w, h)));
        painter.with_clip_rect(clip).galley(at, g, T.label);
        // Path and size next to the name, once there is room for small text.
        if !enlarged && px >= 16.0 {
            let small = T.ui(quantize(px * 0.55));
            let n = p.cards.len();
            let info = format!("{}  ·  {n} file{}", p.rel_dir, if n == 1 { "" } else { "s" });
            let gi = painter.layout_no_wrap(info, small, T.label_dim);
            let ip = pos2(at.x + w + px * 0.6, at.y + h - gi.size().y - h * 0.08);
            if ip.x + gi.size().x <= r.right() {
                painter.galley(ip, gi, T.label_dim);
            }
        }
    }
}

fn hud(painter: &Painter, scene: &Scene, state: &State, view: Rect) {
    let s = &T.sizes;
    let name = scene.root.file_name().map_or_else(|| scene.root.display().to_string(), |n| n.to_string_lossy().into_owned());
    let mut lines: Vec<(String, Color32)> = vec![(
        format!("{} packages  ·  {} files  ·  {} dependencies", scene.packages.len(), scene.file_count, scene.edges.len()),
        T.hud_text,
    )];
    let ts = match &state.ts {
        TsStatus::Waiting => "tsserver: waiting".to_string(),
        TsStatus::Off(why) => format!("tsserver: off ({why})"),
        TsStatus::Running { done, total } => format!("tsserver: resolving imports {done}/{total}"),
        TsStatus::Done { imports, .. } => {
            let undeclared = scene.imports.undeclared.len();
            format!("tsserver: {imports} cross-package imports, {undeclared} undeclared")
        }
        TsStatus::Failed(e) => format!("tsserver: {e}"),
    };
    lines.push((ts, if matches!(state.ts, TsStatus::Failed(_)) { T.error } else { T.hud_dim }));
    if !state.options.deterministic {
        lines.push((format!("discover {:.0} ms  ·  layout {:.0} ms", scene.timings.discover_ms, scene.timings.layout_ms), T.hud_dim));
    }
    let title = painter.layout_no_wrap(name, T.semibold(s.hud_font + 2.0), T.hud_text);
    let galleys: Vec<_> = lines.into_iter().map(|(t, c)| painter.layout_no_wrap(t, T.ui(s.hud_font), c)).collect();
    let w = galleys.iter().map(|g| g.size().x).fold(title.size().x, f32::max) + 2.0 * s.hud_pad;
    let h = title.size().y + galleys.iter().map(|g| g.size().y + 3.0).sum::<f32>() + 2.0 * s.hud_pad;
    let r = Rect::from_min_size(view.min + vec2(12.0, 12.0), vec2(w, h));
    painter.rect(r, 6.0, T.hud_bg, Stroke::new(1.0_f32, T.hud_border), StrokeKind::Inside);
    let mut y = r.top() + s.hud_pad;
    let th = title.size().y;
    painter.galley(pos2(r.left() + s.hud_pad, y), title, T.hud_text);
    y += th + 3.0;
    for g in galleys {
        let gh = g.size().y;
        painter.galley(pos2(r.left() + s.hud_pad, y), g, T.hud_text);
        y += gh + 3.0;
    }

    let pct = state.camera.zoom * 100.0;
    let pct = if pct < 1.0 { format!("{pct:.2}%") } else { format!("{pct:.0}%") };
    let hint = format!("{pct}   ·   F fit   ·   ⌘/ctrl + scroll zoom   ·   scroll or drag pan   ·   double-click a package");
    let g = painter.layout_no_wrap(hint, T.ui(s.hud_font - 1.0), T.hud_dim);
    let r = Rect::from_min_size(view.right_bottom() - g.size() - vec2(12.0 + 2.0 * s.hud_pad, 12.0 + s.hud_pad), g.size() + vec2(2.0 * s.hud_pad, s.hud_pad));
    painter.rect(r, 6.0, T.hud_bg, Stroke::new(1.0_f32, T.hud_border), StrokeKind::Inside);
    painter.galley(r.min + vec2(s.hud_pad, s.hud_pad / 2.0), g, T.hud_dim);
}
