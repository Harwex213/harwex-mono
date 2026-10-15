//! The commit table of a Log tab: author, lane graph, subject with ref labels, date. Rows are
//! virtualized; the selection is a set of commits (click, Cmd+click, Shift+click, arrows).

use egui::{pos2, vec2, Align2, Color32, Key, Modifiers, Rect, RichText, ScrollArea, Sense, Stroke, Ui};
use ide_git::{ArrowDir, CommitInfo, GraphRow, Oid, RefKind};

use super::{load_more, run_action, LogView, RowAction};
use crate::state::AppState;
use crate::theme;

const ROW_H: f32 = 24.0;
const LANE_W: f32 = 12.0;
/// Wider graphs are clipped; IDEA also collapses very wide graphs.
const MAX_LANES: usize = 24;
const AUTHOR_W: f32 = 140.0;
const DATE_W: f32 = 132.0;

pub const LANE_COLORS: [Color32; 8] = theme::T.lanes;

/// How one table row is drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RowStyle {
    /// The git user's own commit: the author is bold.
    pub bold_author: bool,
    /// A merge commit: the whole row is grey.
    pub dimmed: bool,
    /// HEAD points here: the graph node is a hollow circle.
    pub hollow: bool,
}

impl LogView {
    /// A press on row `i` with the modifiers held: select it, toggle it (Cmd) or select the
    /// range from the anchor (Shift).
    pub(super) fn click_row(&mut self, i: usize, command: bool, shift: bool) {
        let Some(oid) = self.commits.get(i).map(|c| c.oid) else { return };
        let anchor = self.anchor.and_then(|a| self.commits.iter().position(|c| c.oid == a));
        match anchor {
            Some(a) if shift => self.select_range(a, i),
            _ if command => {
                if let Some(p) = self.selection.iter().position(|s| *s == oid) {
                    if self.selection.len() > 1 {
                        self.selection.remove(p);
                    }
                } else {
                    self.selection.push(oid);
                }
                self.anchor = Some(oid);
            }
            _ => {
                self.selection = vec![oid];
                self.anchor = Some(oid);
            }
        }
    }

    /// Selects rows `from..=to` (either order); row `to` becomes the lead.
    fn select_range(&mut self, from: usize, to: usize) {
        let (lo, hi) = (from.min(to), from.max(to));
        let mut sel: Vec<Oid> = (lo..=hi).filter(|&r| r != to).map(|r| self.commits[r].oid).collect();
        sel.push(self.commits[to].oid);
        self.selection = sel;
    }

    fn lead_row(&self) -> Option<usize> {
        let lead = self.selected()?;
        self.commits.iter().position(|c| c.oid == lead)
    }
}

pub(super) fn show(state: &mut AppState, view: &mut LogView, ui: &mut Ui) {
    if let Some(err) = &view.error {
        ui.add_space(6.0);
        ui.label(RichText::new(err).color(theme::T.error));
        return;
    }
    if view.commits.is_empty() {
        ui.add_space(6.0);
        let text = if view.loading { "Loading..." } else { "No commits match the filter." };
        ui.label(RichText::new(text).color(theme::T.text_dim));
        return;
    }

    let table_id = crate::workspace::wid(("git-log-table", view.id));
    let has_focus = ui.memory(|m| m.has_focus(table_id));
    if has_focus && !ui.ctx().is_context_menu_open() {
        keyboard(view, ui);
    }

    let n = view.commits.len();
    let mut scroll = ScrollArea::vertical().id_salt(("git-log-rows", view.id)).auto_shrink([false, false]).drag_to_scroll(false);
    // The viewport height is known from the second frame on; until then the scroll waits.
    if let Some(i) = view.scroll_to.filter(|_| view.view_height > 0.0) {
        view.scroll_to = None;
        let top = i as f32 * ROW_H;
        if top < view.view_offset || top + ROW_H > view.view_offset + view.view_height {
            let y = if top < view.view_offset { top } else { top + ROW_H - view.view_height };
            scroll = scroll.vertical_scroll_offset(y.max(0.0));
        }
    }
    let log = &state.ws.git_ui.log;
    let (command, shift) = ui.input(|i| (i.modifiers.command, i.modifiers.shift));
    let mut action: Option<RowAction> = None;
    let mut pressed: Option<usize> = None;
    let mut right: Option<usize> = None;
    let mut want_more = false;
    ui.spacing_mut().item_spacing.y = 0.0;
    let out = scroll.show_rows(ui, ROW_H, n, |ui, range| {
        let lanes = view.graph[range.clone()].iter().map(|g| g.width.max(g.lane + 1)).max().unwrap_or(1).min(MAX_LANES);
        let graph_w = lanes as f32 * LANE_W + 10.0;
        if range.end + 60 >= n && view.has_more && !view.loading {
            want_more = true;
        }
        for i in range {
            let commit = &view.commits[i];
            let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::hover());
            // The id follows the commit, so an open context menu stays with its row.
            let resp = ui.interact(rect, crate::workspace::wid(("git-log-row", view.id, commit.oid)), Sense::click());
            let selected = view.selection.contains(&commit.oid);
            crate::util::label_selectable(&resp, format!("Commit {}", commit.summary), selected);
            let style = view.row_style(log, i);
            draw_row(ui, resp.id, rect, commit, &view.graph[i], graph_w, style, selected, has_focus, resp.hovered());
            // Selection follows the press, like the Project tree; egui reports no click for a
            // long press.
            if resp.is_pointer_button_down_on() && ui.input(|inp| inp.pointer.primary_pressed()) {
                pressed = Some(i);
            }
            if resp.secondary_clicked() {
                right = Some(i);
            }
            let oid = commit.oid;
            resp.context_menu(|ui| {
                ui.set_min_width(240.0);
                let mut item = |ui: &mut Ui, label: &str, a: RowAction| {
                    if ui.button(label).clicked() {
                        action = Some(a);
                        ui.close_menu();
                    }
                };
                item(ui, "Copy Revision Number", RowAction::CopyHash(oid));
                ui.separator();
                item(ui, "Checkout Revision", RowAction::Checkout(oid));
                item(ui, "New Branch...", RowAction::NewBranch(oid));
                item(ui, "New Tag...", RowAction::NewTag(oid));
                item(ui, "Reset Current Branch to Here...", RowAction::Reset(oid));
                ui.separator();
                item(ui, "Revert Commit", RowAction::Revert(oid));
                item(ui, "Cherry-Pick", RowAction::CherryPick(oid));
            });
        }
    });
    view.view_offset = out.state.offset.y;
    view.view_height = out.inner_rect.height();
    if let Some(i) = pressed {
        view.click_row(i, command, shift);
    }
    if let Some(i) = right {
        let oid = view.commits[i].oid;
        if !view.selection.contains(&oid) {
            view.selection = vec![oid];
            view.anchor = Some(oid);
        }
    }
    // Keep the focus id alive, so the arrows keep working after a click. egui drops the focus
    // on a press outside the focused widget, and this one never counts as hovered, so a press
    // on a row takes it back on the press frame.
    ui.interact(out.inner_rect, table_id, Sense::focusable_noninteractive());
    if pressed.is_some() || right.is_some() {
        ui.memory_mut(|m| m.request_focus(table_id));
    }
    if want_more {
        load_more(state, view);
    }
    if let Some(a) = action {
        let ctx = ui.ctx().clone();
        run_action(state, &ctx, a);
    }
}

fn keyboard(view: &mut LogView, ui: &mut Ui) {
    let keys = ui.input_mut(|i| {
        let mut take = |k: Key| i.consume_key(Modifiers::SHIFT, k).then_some((k, true)).or_else(|| i.consume_key(Modifiers::NONE, k).then_some((k, false)));
        [Key::ArrowUp, Key::ArrowDown, Key::PageUp, Key::PageDown, Key::Home, Key::End].into_iter().find_map(&mut take)
    });
    let Some((key, shift)) = keys else { return };
    let n = view.commits.len();
    if n == 0 {
        return;
    }
    let cur = view.lead_row().unwrap_or(0);
    let page = ((view.view_height / ROW_H) as usize).max(1);
    let next = match key {
        Key::ArrowUp => cur.saturating_sub(1),
        Key::ArrowDown => (cur + 1).min(n - 1),
        Key::PageUp => cur.saturating_sub(page),
        Key::PageDown => (cur + page).min(n - 1),
        Key::Home => 0,
        _ => n - 1,
    };
    let anchor = view.anchor.and_then(|a| view.commits.iter().position(|c| c.oid == a));
    match anchor {
        Some(a) if shift => view.select_range(a, next),
        _ => {
            let oid = view.commits[next].oid;
            view.selection = vec![oid];
            view.anchor = Some(oid);
        }
    }
    view.scroll_to = Some(next);
}

#[allow(clippy::too_many_arguments)]
fn draw_row(ui: &Ui, id: egui::Id, rect: Rect, c: &CommitInfo, g: &GraphRow, graph_w: f32, style: RowStyle, selected: bool, focused: bool, hovered: bool) {
    let t = &theme::T;
    let painter = ui.painter();
    let bg = if selected {
        let c = if focused { t.selection } else { t.selection_inactive };
        painter.rect_filled(rect, 0.0, c);
        c
    } else {
        if hovered {
            painter.rect_filled(rect, 0.0, t.hover);
        }
        t.island_bg
    };
    let cy = rect.center().y;
    let (text, dim) = if style.dimmed {
        (t.text_dim, t.text_dim)
    } else if selected {
        (t.text_bright, t.text_bright)
    } else {
        (t.text, t.text)
    };

    let author_rect = Rect::from_min_max(pos2(rect.left() + 8.0, rect.top()), pos2(rect.left() + AUTHOR_W - 6.0, rect.bottom()));
    let font = if style.bold_author { t.semibold(t.font.ui) } else { t.ui_font() };
    painter.with_clip_rect(author_rect.intersect(painter.clip_rect())).text(pos2(author_rect.left(), cy), Align2::LEFT_CENTER, &c.author_name, font, text);

    let graph_rect = Rect::from_min_size(pos2(rect.left() + AUTHOR_W, rect.top()), vec2(graph_w, rect.height()));
    draw_graph(&painter.with_clip_rect(graph_rect.intersect(painter.clip_rect())), graph_rect, g, style.hollow, bg);

    let date_x = rect.right() - DATE_W;
    painter.text(pos2(date_x, cy), Align2::LEFT_CENTER, super::format_time(c.author_time, c.author_offset_minutes), t.ui_font(), dim);

    let subject_rect = Rect::from_min_max(pos2(graph_rect.right(), rect.top()), pos2(date_x - 10.0, rect.bottom()));
    let sp = painter.with_clip_rect(subject_rect.intersect(painter.clip_rect()));
    let text_left = subject_rect.left() + 2.0;
    let full = painter.layout_no_wrap(c.summary.clone(), t.ui_font(), text).size().x;
    let labels: Vec<f32> = c.refs.iter().map(|r| ref_label_width(&sp, r)).collect();
    let fit = fit_refs(subject_rect.right() - text_left, full, &labels, |n| more_width(&sp, n));

    // Ref labels sit right-aligned at the end of the subject column, like IDEA.
    let mut right = subject_rect.right();
    if fit.more > 0 {
        let w = more_width(&sp, fit.more);
        right -= w;
        let chip = draw_more(&sp, pos2(right, cy), fit.more);
        more_refs_hover(ui, id.with("more-refs"), chip, &c.refs, fit.more);
        right -= REF_GAP;
    }
    for (r, w) in c.refs[..fit.shown].iter().zip(&labels).rev() {
        right -= w;
        let chip = Rect::from_min_size(pos2(right, cy - REF_H / 2.0), vec2(*w, REF_H));
        draw_ref_label(&sp, pos2(right, cy), r);
        let resp = ui.interact(chip.intersect(subject_rect), id.with(("ref", &r.name)), Sense::hover());
        crate::util::label_widget(&resp, egui::WidgetType::Label, format!("Ref label {}", r.name));
        right -= REF_GAP;
    }
    // The message ends with `…` when it does not fit; below the width of `…` it is not drawn,
    // so no half glyph shows.
    if fit.message_w >= ellipsis_width(&sp) {
        let galley = sp.layout_job(message_job(&c.summary, fit.message_w, text));
        let text_rect = Rect::from_min_max(subject_rect.min, pos2(text_left + fit.message_w, subject_rect.bottom()));
        sp.with_clip_rect(text_rect.intersect(sp.clip_rect())).galley(pos2(text_left, cy - galley.size().y / 2.0), galley, text);
    }
}

/// The gap between the message and a ref label, and between two labels.
const REF_GAP: f32 = 4.0;
/// The message keeps this much room (or its whole width, when shorter) before the labels
/// collapse to `+N` alone.
pub const MIN_MESSAGE_W: f32 = 120.0;
const REF_H: f32 = 16.0;

/// How the subject column splits between the message and the ref labels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RefFit {
    /// The first `shown` labels are drawn.
    pub shown: usize,
    /// A `+more` chip stands for the labels that are not drawn; 0 draws no chip.
    pub more: usize,
    /// The room left for the message, left of the labels.
    pub message_w: f32,
}

/// Splits `avail` points between a message `message_w` wide and the ref labels (`labels` holds
/// their widths, HEAD or the current branch first). `more_w(n)` is the width of a `+n` chip.
/// The steps, like IDEA: every label with the whole message; else the first label and `+N`
/// while the message keeps `MIN_MESSAGE_W`; else `+N` for all labels. The labels never depend on
/// hover or selection, so a row never shifts.
pub fn fit_refs(avail: f32, message_w: f32, labels: &[f32], more_w: impl Fn(usize) -> f32) -> RefFit {
    let n = labels.len();
    let avail = avail.max(0.0);
    let used = |shown: usize, more: usize| {
        let chip = if more > 0 { more_w(more) + REF_GAP } else { 0.0 };
        labels[..shown].iter().map(|w| w + REF_GAP).sum::<f32>() + chip
    };
    let fit = |shown: usize, more: usize| RefFit { shown, more, message_w: (avail - used(shown, more)).max(0.0) };
    if n == 0 {
        return fit(0, 0);
    }
    if message_w + used(n, 0) <= avail {
        return fit(n, 0);
    }
    let keep = message_w.min(MIN_MESSAGE_W);
    if keep + used(1, n - 1) <= avail {
        return fit(1, n - 1);
    }
    fit(0, n)
}

/// The message on one line, cut with `…` at `width`.
fn message_job(summary: &str, width: f32, color: Color32) -> egui::text::LayoutJob {
    let mut job = egui::text::LayoutJob::simple_singleline(summary.to_owned(), theme::T.ui_font(), color);
    job.wrap = egui::text::TextWrapping { max_width: width, max_rows: 1, break_anywhere: true, overflow_character: Some('…') };
    job
}

fn more_width(painter: &egui::Painter, n: usize) -> f32 {
    painter.layout_no_wrap(format!("+{n}"), theme::T.tiny_font(), theme::T.text).size().x + 8.0
}

fn ellipsis_width(painter: &egui::Painter) -> f32 {
    painter.layout_no_wrap("…".into(), theme::T.ui_font(), theme::T.text).size().x
}

/// Draws the `+n` chip at `left_center`; returns its rect.
fn draw_more(painter: &egui::Painter, left_center: egui::Pos2, n: usize) -> Rect {
    let (bg, fg) = theme::T.ref_more;
    let galley = painter.layout_no_wrap(format!("+{n}"), theme::T.tiny_font(), fg);
    let size = galley.size() + vec2(8.0, 2.0);
    let rect = Rect::from_min_size(pos2(left_center.x, left_center.y - size.y / 2.0), size);
    painter.rect_filled(rect, 3.0, bg);
    painter.galley(pos2(rect.left() + 4.0, rect.top() + 1.0), galley, fg);
    rect
}

/// A hover on the `+N` chip lists every ref of the commit as labels.
fn more_refs_hover(ui: &Ui, id: egui::Id, chip: Rect, refs: &[ide_git::RefLabel], more: usize) {
    let resp = ui.interact(chip.intersect(ui.clip_rect()), id, Sense::hover());
    crate::util::label_widget(&resp, egui::WidgetType::Label, format!("More refs +{more}"));
    resp.on_hover_ui(|ui| {
        ui.spacing_mut().item_spacing.y = 3.0;
        for r in refs {
            let w = ref_label_width(ui.painter(), r);
            let (rect, resp) = ui.allocate_exact_size(vec2(w, REF_H), Sense::hover());
            draw_ref_label(ui.painter(), pos2(rect.left(), rect.center().y), r);
            crate::util::label_widget(&resp, egui::WidgetType::Label, format!("Ref list {}", r.name));
        }
    });
}

/// Draws one row of the lane graph. A segment between two rows is a straight line from lane
/// `from` at the upper center to lane `to` at the lower center; each row draws the half that
/// lies inside it, so rows can be drawn independently. `hollow` draws the node as a ring
/// filled with `fill` (the row background): the commit HEAD points to.
pub fn draw_graph(painter: &egui::Painter, rect: Rect, g: &GraphRow, hollow: bool, fill: Color32) {
    let x = |lane: usize| rect.left() + 4.0 + lane as f32 * LANE_W + LANE_W / 2.0;
    let (top, mid, bottom) = (rect.top(), rect.center().y, rect.bottom());
    let color = |c: usize| LANE_COLORS[c % LANE_COLORS.len()];
    let stroke = |c: usize| Stroke::new(1.6_f32, color(c));
    for e in &g.up {
        let half = (x(e.from) + x(e.to)) / 2.0;
        painter.line_segment([pos2(half, top), pos2(x(e.to), mid)], stroke(e.color));
    }
    for e in &g.down {
        let half = (x(e.from) + x(e.to)) / 2.0;
        painter.line_segment([pos2(x(e.from), mid), pos2(half, bottom)], stroke(e.color));
    }
    // The ends of a cut long line: a chevron in the stub's lane, pointing along the line.
    for a in &g.arrows {
        let (ax, s) = (x(a.lane), 3.5);
        let dy = match a.dir {
            ArrowDir::Down => -s,
            ArrowDir::Up => s,
        };
        let tip = pos2(ax, mid + if a.dir == ArrowDir::Down { 1.0 } else { -1.0 });
        painter.line_segment([pos2(ax - s, tip.y + dy), tip], stroke(a.color));
        painter.line_segment([tip, pos2(ax + s, tip.y + dy)], stroke(a.color));
    }
    let center = pos2(x(g.lane), mid);
    if hollow {
        painter.circle_filled(center, 4.5, fill);
        painter.circle_stroke(center, 4.0, Stroke::new(1.6_f32, color(g.color)));
    } else {
        painter.circle_filled(center, 3.5, color(g.color));
    }
}

fn ref_label_width(painter: &egui::Painter, r: &ide_git::RefLabel) -> f32 {
    painter.layout_no_wrap(r.name.clone(), theme::T.tiny_font(), theme::T.text).size().x + 8.0
}

/// Draws a branch/tag label at `left_center`; returns its width.
pub fn draw_ref_label(painter: &egui::Painter, left_center: egui::Pos2, r: &ide_git::RefLabel) -> f32 {
    let (bg, fg) = match r.kind {
        RefKind::Head => theme::T.ref_head,
        RefKind::LocalBranch if r.is_current => theme::T.ref_current,
        RefKind::LocalBranch => theme::T.ref_local,
        RefKind::RemoteBranch => theme::T.ref_remote,
        RefKind::Tag => theme::T.ref_tag,
    };
    let galley = painter.layout_no_wrap(r.name.clone(), theme::T.tiny_font(), fg);
    let size = galley.size() + vec2(8.0, 2.0);
    let rect = Rect::from_min_size(pos2(left_center.x, left_center.y - size.y / 2.0), size);
    painter.rect_filled(rect, 3.0, bg);
    painter.galley(pos2(rect.left() + 4.0, rect.top() + 1.0), galley, fg);
    size.x
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Labels 40 and 30 wide; a `+n` chip is 20 wide.
    fn fit(avail: f32, message: f32, labels: &[f32]) -> RefFit {
        fit_refs(avail, message, labels, |_| 20.0)
    }

    #[test]
    fn every_label_while_the_whole_message_fits() {
        // 200 + (40 + 4) + (30 + 4) = 278.
        assert_eq!(fit(300.0, 200.0, &[40.0, 30.0]), RefFit { shown: 2, more: 0, message_w: 222.0 });
        assert_eq!(fit(278.0, 200.0, &[40.0, 30.0]).shown, 2);
        assert_eq!(fit(100.0, 10.0, &[]), RefFit { shown: 0, more: 0, message_w: 100.0 });
    }

    #[test]
    fn first_label_and_more_while_the_message_keeps_its_minimum() {
        // The labels do not fit beside the whole message: the first label and `+1` take 68.
        let f = fit(277.0, 200.0, &[40.0, 30.0]);
        assert_eq!(f, RefFit { shown: 1, more: 1, message_w: 209.0 });
        // The message keeps exactly MIN_MESSAGE_W.
        let f = fit(MIN_MESSAGE_W + 68.0, 500.0, &[40.0, 30.0]);
        assert_eq!((f.shown, f.more, f.message_w), (1, 1, MIN_MESSAGE_W));
        // A single label collapses to `+1` only below the minimum.
        assert_eq!(fit(MIN_MESSAGE_W + 44.0, 500.0, &[40.0]), RefFit { shown: 1, more: 0, message_w: MIN_MESSAGE_W });
    }

    #[test]
    fn only_more_below_the_minimum() {
        let f = fit(MIN_MESSAGE_W + 67.0, 500.0, &[40.0, 30.0]);
        assert_eq!((f.shown, f.more), (0, 2));
        assert_eq!(f.message_w, MIN_MESSAGE_W + 67.0 - 24.0);
        // A short message needs less room than the minimum.
        assert_eq!(fit(50.0 + 68.0, 50.0, &[40.0, 30.0]).shown, 1);
        // Even a column narrower than `+N` keeps `+N` and gives the message nothing.
        assert_eq!(fit(10.0, 500.0, &[40.0, 30.0]), RefFit { shown: 0, more: 2, message_w: 0.0 });
    }

    #[test]
    fn a_cut_message_ends_with_an_ellipsis() {
        let ctx = egui::Context::default();
        let _ = ctx.run(Default::default(), |_| {});
        let glyphs = |width: f32| {
            let g = ctx.fonts(|f| f.layout_job(message_job("Rework the lane graph so long subjects end with an ellipsis", width, theme::T.text)));
            let text: String = g.rows.iter().flat_map(|r| r.glyphs.iter().map(|g| g.chr)).collect();
            (text, g.size().x, g.rows.len())
        };
        let (text, w, rows) = glyphs(120.0);
        assert!(text.ends_with('…') && text.len() > 3, "{text}");
        assert!(w <= 120.0 + 0.5 && rows == 1, "width {w}, rows {rows}");
        let (text, _, _) = glyphs(f32::INFINITY);
        assert!(!text.contains('…'), "{text}");
    }
}
