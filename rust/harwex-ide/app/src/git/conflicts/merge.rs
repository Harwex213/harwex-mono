//! Three-pane merge tab: yours / editable result / theirs, aligned block by block.
//!
//! The file is cut into blocks with a diff3-style sweep over base->ours and base->theirs
//! hunks. Every block is one row of the three columns, so the panes scroll together and a
//! conflict always sits next to its two sides. Non-conflicting changes are applied to the
//! result up front; conflicts start with the base text, like IDEA.

use std::any::Any;
use std::ops::Range;
use std::path::PathBuf;

use egui::{vec2, Color32, Label, Rect, RichText, ScrollArea, Sense, TextEdit, Ui};
use ide_git::ConflictSides;

use crate::state::TabEnv;
use crate::tabs::CustomTab;
use crate::theme;

/// Unchanged runs longer than this fold to a few context lines.
const FOLD_OVER: usize = 12;
const CONTEXT: usize = 3;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Same,
    /// Only one side changed this region; the result takes that side.
    Ours,
    Theirs,
    /// Both sides made the same change.
    Both,
    Conflict,
}

struct Block {
    kind: Kind,
    ours: String,
    theirs: String,
    result: String,
    resolved: bool,
    expanded: bool,
}

pub struct MergeTab {
    path: PathBuf,
    left: &'static str,
    right: &'static str,
    blocks: Vec<Block>,
    edited: bool,
    saving: bool,
    confirm_unresolved: bool,
    save_requested: bool,
    /// Horizontal offset in points, shared by the three panes so they stay aligned.
    hscroll: f32,
    /// Longest line over all blocks and sides, in chars. Bounds `hscroll`.
    max_cols: usize,
}

impl MergeTab {
    pub fn new(sides: ConflictSides, left: &'static str, right: &'static str) -> MergeTab {
        let base = sides.base.unwrap_or_default();
        let ours = sides.ours.unwrap_or_default();
        let theirs = sides.theirs.unwrap_or_default();
        let blocks = build_blocks(&base, &ours, &theirs);
        let mut tab = MergeTab { path: sides.path, left, right, blocks, edited: false, saving: false, confirm_unresolved: false, save_requested: false, hscroll: 0.0, max_cols: 0 };
        tab.update_max_cols();
        tab
    }

    fn update_max_cols(&mut self) {
        let longest = |s: &str| s.lines().map(|l| l.chars().count()).max().unwrap_or(0);
        self.max_cols = self.blocks.iter().map(|b| longest(&b.ours).max(longest(&b.theirs)).max(longest(&b.result))).max().unwrap_or(0);
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    /// The next frame saves, as if the button was pressed (the save needs a `TabEnv`).
    pub fn request_save(&mut self) {
        self.save_requested = true;
    }

    fn unresolved(&self) -> usize {
        self.blocks.iter().filter(|b| b.kind == Kind::Conflict && !b.resolved).count()
    }

    pub fn result_text(&self) -> String {
        self.blocks.iter().map(|b| b.result.as_str()).collect()
    }

    pub fn take_all(&mut self, theirs: bool) {
        for b in &mut self.blocks {
            if b.kind != Kind::Same {
                b.result = if theirs { b.theirs.clone() } else { b.ours.clone() };
                b.resolved = true;
            }
        }
        self.edited = true;
    }

    fn save(&mut self, env: &mut TabEnv) {
        let Some(repo) = env.git.repo.clone() else { return };
        self.saving = true;
        let text = self.result_text();
        let path = self.path.clone();
        let key = self.key();
        env.jobs.spawn(
            format!("Resolving {}", path.display()),
            move || repo.resolve(&path, &text).map(|_| None),
            move |state, res| {
                let title = "Merge conflict resolved";
                let ok = crate::git::remote::report(state, title, &format!("{} saved and staged", key.trim_start_matches("merge:")), res);
                crate::git::refresh::changed(state);
                if ok {
                    if let Some(id) = state.ws.tabs.custom_by_key(&key) {
                        state.close_tab(id, true);
                    }
                    super::merge_saved(state);
                } else if let Some(t) = state.ws.tabs.custom_mut::<MergeTab>(&key) {
                    t.saving = false;
                }
            },
        );
    }
}

impl CustomTab for MergeTab {
    fn key(&self) -> String {
        format!("merge:{}", self.path.display())
    }

    fn title(&self) -> String {
        let name = self.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        format!("Merge: {name}")
    }

    fn tooltip(&self) -> String {
        format!("Merge conflicts in {}", self.path.display())
    }

    fn is_dirty(&self) -> bool {
        self.edited
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn ui(&mut self, ui: &mut Ui, env: &mut TabEnv) {
        if std::mem::take(&mut self.save_requested) && !self.saving {
            self.save(env);
        }
        let left_n = self.unresolved();
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.add_space(8.0);
            ui.label(RichText::new(self.path.display().to_string()).strong().color(theme::T.text_bright));
            let status = if left_n == 0 { "All conflicts resolved".to_string() } else { format!("{left_n} conflict(s) left") };
            ui.label(RichText::new(status).color(if left_n == 0 { theme::T.git_added } else { theme::T.warning }));
            ui.separator();
            if ui.button(format!("Accept {}", self.left)).on_hover_text("Take the left side for every changed block").clicked() {
                self.take_all(false);
            }
            if ui.button(format!("Accept {}", self.right)).on_hover_text("Take the right side for every changed block").clicked() {
                self.take_all(true);
            }
            ui.separator();
            ui.add_enabled_ui(!self.saving, |ui| {
                if ui.button("Save and Mark Resolved").clicked() {
                    if left_n > 0 {
                        self.confirm_unresolved = true;
                    } else {
                        self.save(env);
                    }
                }
                if ui.button("Cancel").clicked() {
                    env.commands.push(crate::state::AppCommand::CloseTab(env.tab_id));
                }
            });
            if self.saving {
                ui.spinner();
            }
        });
        if self.confirm_unresolved {
            ui.horizontal(|ui| {
                ui.add_space(8.0);
                ui.label(RichText::new(format!("{left_n} conflict(s) are not resolved; the result keeps the base text there. Save anyway?")).color(theme::T.warning));
                if ui.button("Save").clicked() {
                    self.confirm_unresolved = false;
                    self.save(env);
                }
                if ui.button("Keep editing").clicked() {
                    self.confirm_unresolved = false;
                }
            });
        }
        ui.add_space(4.0);

        let gap = 8.0;
        let col_w = ((ui.available_width() - 2.0 * gap - 40.0) / 3.0).max(120.0);
        ui.horizontal(|ui| {
            ui.add_space(8.0);
            for t in [self.left, "Result", self.right] {
                ui.allocate_ui(vec2(col_w, 18.0), |ui| {
                    ui.set_width(col_w);
                    ui.label(RichText::new(t).small().color(theme::T.text_dim));
                });
                ui.add_space(gap - 6.0);
            }
        });
        ui.separator();

        let font = theme::T.mono_small_font();
        let (line_h, char_w) = ui.fonts(|f| (f.row_height(&font), f.glyph_width(&font, 'M')));
        // The panes scroll sideways together: one offset, a bar at the bottom, and the
        // horizontal wheel or trackpad delta over the rows.
        let content_w = self.max_cols as f32 * char_w + 40.0;
        let max_h = (content_w - col_w).max(0.0);
        let bar_h = if max_h > 0.0 { 12.0 } else { 0.0 };
        let rows_h = (ui.available_height() - bar_h).max(40.0);
        let mut changed = false;
        let hscroll = self.hscroll.clamp(0.0, max_h);
        let rows = ScrollArea::vertical().id_salt("merge-rows").auto_shrink([false, false]).max_height(rows_h).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 2.0;
            let pane = Pane { col_w, gap, line_h, hscroll, content_w };
            for (i, b) in self.blocks.iter_mut().enumerate() {
                changed |= block_row(ui, i, b, &pane);
            }
        });
        let mut hscroll = hscroll;
        if ui.rect_contains_pointer(rows.inner_rect) {
            let dx = ui.input(|i| i.smooth_scroll_delta.x);
            if dx != 0.0 {
                hscroll -= dx;
            }
        }
        if max_h > 0.0 {
            hscroll = hscroll_bar(ui, hscroll, max_h, col_w, content_w);
        }
        self.hscroll = hscroll.clamp(0.0, max_h);
        if changed {
            self.edited = true;
            self.update_max_cols();
        }
    }
}

fn block_colors(b: &Block) -> (Color32, Color32, Color32) {
    let t = &theme::T;
    let (none, changed, conflict, resolved) = (t.clear, t.merge_changed, t.merge_conflict, t.merge_resolved);
    match b.kind {
        Kind::Same => (none, none, none),
        Kind::Ours => (changed, changed, none),
        Kind::Theirs => (none, changed, changed),
        Kind::Both => (changed, changed, changed),
        Kind::Conflict if b.resolved => (resolved, resolved, resolved),
        Kind::Conflict => (conflict, conflict, conflict),
    }
}

/// Column geometry shared by all rows of one frame.
struct Pane {
    col_w: f32,
    gap: f32,
    line_h: f32,
    hscroll: f32,
    content_w: f32,
}

/// The shared horizontal scrollbar under the panes. Returns the new offset.
fn hscroll_bar(ui: &mut Ui, offset: f32, max: f32, view_w: f32, content_w: f32) -> f32 {
    let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 12.0), Sense::click_and_drag());
    let track = rect.shrink2(vec2(8.0, 3.0));
    ui.painter().rect_filled(track, 3.0, theme::T.tab_bar_bg);
    let thumb_w = (track.width() * view_w / content_w).clamp(24.0, track.width());
    let span = (track.width() - thumb_w).max(1.0);
    let x = track.min.x + span * (offset / max);
    let thumb = Rect::from_min_size(egui::pos2(x, track.min.y), vec2(thumb_w, track.height()));
    let color = if resp.hovered() || resp.dragged() { theme::T.scrollbar_thumb_active } else { theme::T.scrollbar_thumb };
    ui.painter().rect_filled(thumb, 3.0, color);
    if let Some(p) = resp.interact_pointer_pos() {
        if resp.dragged() || resp.clicked() {
            let t = ((p.x - track.min.x - thumb_w / 2.0) / span).clamp(0.0, 1.0);
            return t * max;
        }
    }
    offset
}

/// One aligned row of the three panes. Returns whether the result changed.
fn block_row(ui: &mut Ui, idx: usize, b: &mut Block, pane: &Pane) -> bool {
    let &Pane { col_w, gap, line_h, hscroll, content_w } = pane;
    let lines = |s: &str| s.lines().count().max(if s.is_empty() { 0 } else { 1 });
    if b.kind == Kind::Same && !b.expanded && lines(&b.result) > FOLD_OVER {
        return folded_row(ui, b, pane);
    }
    let n = lines(&b.ours).max(lines(&b.theirs)).max(lines(&b.result)).max(1);
    let h = n as f32 * line_h + 4.0;
    let (lc, mc, rc) = block_colors(b);
    let mut changed = false;
    ui.horizontal_top(|ui| {
        ui.add_space(8.0);
        // Left: yours, with "take" at the right edge.
        let (rect, _) = ui.allocate_exact_size(vec2(col_w, h), Sense::hover());
        ui.painter().rect_filled(rect, 2.0, lc);
        text_in(ui, rect, &b.ours, hscroll);
        if b.kind != Kind::Same {
            let btn = Rect::from_min_size(rect.right_top() + vec2(-26.0, 1.0), vec2(24.0, 18.0));
            if ui.put(btn, egui::Button::new(">>").small().wrap_mode(egui::TextWrapMode::Extend)).on_hover_text("Take this side into the result").clicked() {
                take(b, false);
                changed = true;
            }
        }
        ui.add_space(gap);
        // Middle: the editable result.
        let (rect, _) = ui.allocate_exact_size(vec2(col_w, h), Sense::hover());
        ui.painter().rect_filled(rect, 2.0, mc);
        // The editor is as wide as the longest line and slides under the column's clip rect.
        let inner = rect.shrink2(vec2(2.0, 0.0));
        let edit_w = content_w.max(col_w - 4.0);
        let shifted = Rect::from_min_size(inner.min - vec2(hscroll, 0.0), vec2(edit_w, inner.height()));
        let mut child = ui.new_child(egui::UiBuilder::new().max_rect(shifted));
        child.set_clip_rect(inner.intersect(ui.clip_rect()));
        let resp = child.add(TextEdit::multiline(&mut b.result).id_salt(("merge-result", idx)).font(theme::T.mono_small_font()).frame(false).desired_width(edit_w).desired_rows(n).margin(vec2(2.0, 2.0)));
        if resp.changed() {
            b.resolved = true;
            changed = true;
        }
        ui.add_space(gap);
        // Right: theirs, with "take" at the left edge.
        let (rect, _) = ui.allocate_exact_size(vec2(col_w, h), Sense::hover());
        ui.painter().rect_filled(rect, 2.0, rc);
        text_in(ui, Rect::from_min_max(rect.min + vec2(26.0, 0.0), rect.max), &b.theirs, hscroll);
        if b.kind != Kind::Same {
            let btn = Rect::from_min_size(rect.left_top() + vec2(1.0, 1.0), vec2(24.0, 18.0));
            if ui.put(btn, egui::Button::new("<<").small().wrap_mode(egui::TextWrapMode::Extend)).on_hover_text("Take this side into the result").clicked() {
                take(b, true);
                changed = true;
            }
        }
    });
    changed
}

/// Takes a side. Taking the second side of a conflict after the first appends it, so both
/// changes can be kept, like IDEA's arrows.
fn take(b: &mut Block, theirs: bool) {
    let side = if theirs { &b.theirs } else { &b.ours };
    let other = if theirs { &b.ours } else { &b.theirs };
    if b.kind == Kind::Conflict && b.resolved && b.result == *other {
        let mut s = other.clone();
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s.push_str(side);
        b.result = s;
    } else {
        b.result = side.clone();
    }
    b.resolved = true;
}

fn folded_row(ui: &mut Ui, b: &mut Block, pane: &Pane) -> bool {
    let &Pane { col_w, gap, line_h, hscroll, .. } = pane;
    let all: Vec<&str> = b.result.lines().collect();
    let head = all[..CONTEXT].join("\n");
    let tail = all[all.len() - CONTEXT..].join("\n");
    let hidden = all.len() - 2 * CONTEXT;
    let ctx_h = CONTEXT as f32 * line_h + 4.0;
    let show = |ui: &mut Ui, text: &str| {
        ui.horizontal_top(|ui| {
            ui.add_space(8.0);
            for _ in 0..3 {
                let (rect, _) = ui.allocate_exact_size(vec2(col_w, ctx_h), Sense::hover());
                text_in(ui, rect, text, hscroll);
                ui.add_space(gap);
            }
        });
    };
    show(ui, &head);
    ui.horizontal(|ui| {
        ui.add_space(8.0);
        if ui.add_sized(vec2(col_w * 3.0 + gap * 2.0, 18.0), egui::Button::new(RichText::new(format!("{hidden} unchanged lines")).small()).fill(theme::T.tab_bar_bg)).clicked() {
            b.expanded = true;
        }
    });
    show(ui, &tail);
    false
}

/// Draws read-only monospace text clipped to `rect`, shifted left by `hscroll`.
fn text_in(ui: &mut Ui, rect: Rect, text: &str, hscroll: f32) {
    let inner = rect.shrink2(vec2(4.0, 2.0));
    let shifted = Rect::from_min_max(inner.min - vec2(hscroll, 0.0), egui::pos2(inner.max.x + 1.0e5, inner.max.y));
    let mut child = ui.new_child(egui::UiBuilder::new().max_rect(shifted));
    child.set_clip_rect(rect.intersect(ui.clip_rect()));
    child.add(Label::new(RichText::new(text.strip_suffix('\n').unwrap_or(text)).font(theme::T.mono_small_font()).color(theme::T.text)).extend().selectable(false));
}

/// Splits keeping line terminators, so joined blocks rebuild the text byte for byte.
fn split_keep(text: &str) -> Vec<&str> {
    text.split_inclusive('\n').collect()
}

fn join(lines: &[&str]) -> String {
    lines.concat()
}

/// diff3-style block layout. Hunks of the two sides that overlap or touch in base lines form
/// one block; a block changed on both sides with different text is a conflict.
fn build_blocks(base: &str, ours: &str, theirs: &str) -> Vec<Block> {
    let bl = split_keep(base);
    let ol = split_keep(ours);
    let tl = split_keep(theirs);
    // (base range, side range, is_theirs)
    let mut changes: Vec<(Range<usize>, Range<usize>, bool)> = Vec::new();
    for h in ide_git::diff_texts(base, ours) {
        changes.push((h.old_lines.clone(), h.new_lines.clone(), false));
    }
    for h in ide_git::diff_texts(base, theirs) {
        changes.push((h.old_lines.clone(), h.new_lines.clone(), true));
    }
    changes.sort_by_key(|c| (c.0.start, c.0.end));

    let mut blocks = Vec::new();
    let (mut b_cur, mut o_cur, mut t_cur) = (0usize, 0usize, 0usize);
    let mut i = 0;
    while i < changes.len() {
        let start = changes[i].0.start;
        let mut end = changes[i].0.end;
        let mut j = i + 1;
        while j < changes.len() && changes[j].0.start <= end {
            end = end.max(changes[j].0.end);
            j += 1;
        }
        let group = &changes[i..j];
        if start > b_cur {
            let n = start - b_cur;
            push_same(&mut blocks, &ol[o_cur..o_cur + n]);
            o_cur += n;
            t_cur += n;
        }
        let side_range = |theirs: bool, cur: usize| -> Range<usize> {
            let hs: Vec<_> = group.iter().filter(|c| c.2 == theirs).collect();
            match (hs.first(), hs.last()) {
                (Some(f), Some(l)) => (f.1.start - (f.0.start - start))..(l.1.end + (end - l.0.end)),
                _ => cur..cur + (end - start),
            }
        };
        let o_r = side_range(false, o_cur);
        let t_r = side_range(true, t_cur);
        let has_o = group.iter().any(|c| !c.2);
        let has_t = group.iter().any(|c| c.2);
        let o_text = join(&ol[o_r.clone()]);
        let t_text = join(&tl[t_r.clone()]);
        let base_text = join(&bl[start..end]);
        let kind = match (has_o, has_t) {
            (true, false) => Kind::Ours,
            (false, true) => Kind::Theirs,
            _ if o_text == t_text => Kind::Both,
            _ => Kind::Conflict,
        };
        let result = match kind {
            Kind::Ours | Kind::Both => o_text.clone(),
            Kind::Theirs => t_text.clone(),
            _ => base_text,
        };
        blocks.push(Block { kind, ours: o_text, theirs: t_text, result, resolved: kind != Kind::Conflict, expanded: false });
        o_cur = o_r.end;
        t_cur = t_r.end;
        b_cur = end;
        i = j;
    }
    if o_cur < ol.len() {
        push_same(&mut blocks, &ol[o_cur..]);
    }
    blocks
}

fn push_same(blocks: &mut Vec<Block>, lines: &[&str]) {
    let text = join(lines);
    blocks.push(Block { kind: Kind::Same, ours: text.clone(), theirs: text.clone(), result: text, resolved: true, expanded: false });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_split_changes_and_conflicts() {
        let base = "a\nb\nc\nd\ne\n";
        let ours = "a\nB1\nc\nd\ne\nf\n";
        let theirs = "a\nB2\nc\nD\ne\n";
        let blocks = build_blocks(base, ours, theirs);
        let kinds: Vec<Kind> = blocks.iter().map(|b| b.kind).collect();
        assert_eq!(kinds, vec![Kind::Same, Kind::Conflict, Kind::Same, Kind::Theirs, Kind::Same, Kind::Ours]);
        assert_eq!(blocks[1].ours, "B1\n");
        assert_eq!(blocks[1].theirs, "B2\n");
        assert_eq!(blocks[1].result, "b\n");
        let merged: String = blocks.iter().map(|b| b.result.as_str()).collect();
        assert_eq!(merged, "a\nb\nc\nD\ne\nf\n");
    }

    #[test]
    fn add_add_without_base() {
        let blocks = build_blocks("", "x\n", "y\n");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].kind, Kind::Conflict);
    }
}
