//! The Find in Files / Replace in Files popup, laid out like IDEA's: a header with the counts
//! and the file mask, the search field with its toggles, an optional replacement field, the
//! "where" row (In Project, Directory, Scope), the results, a preview and a bottom bar.
//!
//! Keys are taken at the start of the frame (`take_keys`), so Enter and the arrows never reach
//! the editor under the popup. Every field or toggle change restarts the search after
//! `DEBOUNCE_SECS`; the debounce is part of `is_idle()`.

use std::path::{Path, PathBuf};

use egui::text::LayoutJob;
use egui::{pos2, vec2, Align, Align2, Color32, Context, CornerRadius, Frame, Id, Key, Layout, Modifiers, Rect, Sense, Stroke, StrokeKind, TextEdit, TextFormat, Ui, UiBuilder};
use ide_editor::Position;

use super::{FindHistory, FindHit, NamedScope, Where};
use crate::icons::{self, Icon};
use crate::state::AppState;
use crate::theme;
use crate::workspace::wid;

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct PopupKeys {
    esc: bool,
    up: bool,
    down: bool,
    enter: bool,
    cmd_enter: bool,
}

/// The dropdowns of the popup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Menu {
    Queries,
    Masks,
    Dirs,
    Scopes,
}

const PAD: f32 = 12.0;
const ROW_H: f32 = 22.0;
const FIELD_H: f32 = 30.0;
const HEADER_H: f32 = 36.0;
const WHERE_H: f32 = 38.0;
const BOTTOM_H: f32 = 44.0;
const BTN: f32 = 24.0;

/// Takes the popup's keys before any widget sees them. Call at the start of the shortcuts.
pub fn take_keys(state: &mut AppState, ctx: &Context) {
    let f = &mut state.ws.find;
    if !f.dialog_open {
        return;
    }
    // The Replace All question takes Enter even while `⏎` is on.
    let multiline = f.multiline && f.replace_confirm.is_none();
    f.keys = ctx.input_mut(|i| PopupKeys {
        // Cmd+Enter first: a plain Enter pattern must not take it.
        cmd_enter: i.consume_key(Modifiers::COMMAND, Key::Enter),
        esc: i.consume_key(Modifiers::NONE, Key::Escape),
        up: i.consume_key(Modifiers::NONE, Key::ArrowUp),
        down: i.consume_key(Modifiers::NONE, Key::ArrowDown),
        // With `⏎` on, Enter types a newline into the query.
        enter: !multiline && i.consume_key(Modifiers::NONE, Key::Enter),
    });
}

/// Adds the current query, mask and directory to the project's history.
pub(super) fn remember(state: &mut AppState) {
    let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) else { return };
    let f = &state.ws.find;
    let (query, mask, dir) = (f.query.clone(), f.current_mask(), (f.where_ == Where::Directory).then(|| f.directory.trim().to_string()));
    let h = state.find_history.entry(root).or_default();
    FindHistory::push(&mut h.queries, &query);
    if let Some(m) = mask {
        FindHistory::push(&mut h.masks, &m);
    }
    if let Some(d) = dir {
        FindHistory::push(&mut h.dirs, &d);
    }
}

/// Everything that restarts the search when it changes.
fn signature(f: &super::FindInFiles) -> impl PartialEq {
    (
        f.query.clone(),
        (f.case_sensitive, f.whole_words, f.regex, f.replace_mode, f.mask_on, f.recursive),
        f.replacement.clone(),
        f.mask.clone(),
        f.where_,
        f.directory.clone(),
        f.named,
    )
}

/// What a widget asked for; applied after the popup drew.
enum Action {
    Open(FindHit),
    OpenInFindWindow,
    Replace,
    ReplaceAll,
    ConfirmReplaceAll,
    CancelReplaceAll,
    PickFolder,
    Close,
}

/// The popup, every frame while it is open.
pub fn show_dialog(state: &mut AppState, ctx: &Context) {
    if !state.ws.find.dialog_open {
        return;
    }
    let Some(root) = state.ws.project.as_ref().map(|p| p.root.clone()) else {
        close(state);
        return;
    };
    let now = ctx.input(|i| i.time);
    let mut keys = std::mem::take(&mut state.ws.find.keys);
    // The Replace All question owns Enter and Escape; the popup under it gets no keys.
    if state.ws.find.replace_confirm.is_some() {
        if keys.esc {
            super::cancel_replace_all(state);
        } else if keys.enter {
            super::confirm_replace_all(state);
            if !state.ws.find.dialog_open {
                return;
            }
        }
        keys = PopupKeys::default();
    }
    // Escape closes an open dropdown first, then the popup.
    if keys.esc && state.ws.find.menu.take().is_none() {
        remember(state);
        close(state);
        return;
    }
    if keys.cmd_enter {
        super::open_in_find_window(state);
        return;
    }
    {
        let f = &mut state.ws.find;
        let n = f.hit_count();
        if (keys.up || keys.down) && n > 0 {
            let i = f.selected_index().unwrap_or(0);
            f.select_index(if keys.up { i.saturating_sub(1) } else { (i + 1).min(n - 1) });
            f.scroll_to_selected = true;
            f.user_selected = true;
        }
    }
    if keys.enter {
        if let Some(hit) = state.ws.find.selected_hit().cloned() {
            open_hit(state, hit);
            return;
        }
    }
    if let Some(at) = state.ws.find.debounce_at {
        if now >= at {
            super::start(state);
        } else {
            ctx.request_repaint_after(std::time::Duration::from_secs_f64(at - now));
        }
    }
    follow_selection(&mut state.ws.find);

    let before = signature(&state.ws.find);
    let screen = ctx.screen_rect();
    let t = &theme::T;
    let size = vec2((screen.width() - 120.0).clamp(560.0, 1240.0), (screen.height() - t.space.title_h - 70.0).clamp(420.0, 940.0));
    let pos = pos2(screen.center().x - size.x / 2.0, screen.top() + t.space.title_h + 22.0);
    let fresh = std::mem::take(&mut state.ws.find.focus);
    let just_opened = std::mem::take(&mut state.ws.find.just_opened);
    let mut actions = Vec::new();
    let area = egui::Area::new(wid("find-in-files")).fixed_pos(pos).order(egui::Order::Foreground).constrain(true).show(ctx, |ui| {
        Frame::NONE.fill(t.popup_bg).stroke(Stroke::new(1.0_f32, t.popup_border)).corner_radius(CornerRadius::same(t.radius.popup as u8)).shadow(t.popup_shadow()).show(ui, |ui| {
            let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
            body(state, ui, rect, &root, fresh, &mut actions);
        });
    });
    let menu_rect = show_menu(state, ctx);
    let confirming = state.ws.find.replace_confirm.is_some();
    if confirming {
        confirm_dialog(state, ctx, &mut actions);
    }
    if signature(&state.ws.find) != before {
        state.ws.find.schedule(now);
        ctx.request_repaint();
    }
    // A press outside the popup and its menu closes it, but not the press that opened it.
    let outside = ctx.input(|i| i.pointer.any_pressed() && i.pointer.interact_pos().is_some_and(|p| !area.response.rect.contains(p) && !menu_rect.is_some_and(|m| m.contains(p))));
    if outside && !just_opened && !confirming && state.ws.find.menu.take().is_none() {
        actions.push(Action::Close);
    }
    for a in actions {
        match a {
            Action::Open(hit) => {
                open_hit(state, hit);
                return;
            }
            Action::OpenInFindWindow => {
                super::open_in_find_window(state);
                return;
            }
            Action::Replace => super::replace_selected(state),
            Action::ReplaceAll => super::replace_everything(state),
            Action::ConfirmReplaceAll => {
                super::confirm_replace_all(state);
                if !state.ws.find.dialog_open {
                    return;
                }
            }
            Action::CancelReplaceAll => super::cancel_replace_all(state),
            Action::PickFolder => pick_folder(state, &root),
            Action::Close => {
                remember(state);
                close(state);
                return;
            }
        }
    }
}

/// Closes the popup. A preview edit not saved yet is saved now: nothing ticks a closed preview.
pub(super) fn close(state: &mut AppState) {
    let mut p = std::mem::take(&mut state.ws.find.preview);
    crate::preview::flush(state, &mut p);
    state.ws.find.preview = p;
    state.ws.find.close();
    // Like IDEA, the editor gets the keys again (Cmd+Z right after a replace).
    if let Some(e) = state.ws.tabs.active_editor_mut() {
        e.view.request_focus();
    }
}

fn open_hit(state: &mut AppState, hit: FindHit) {
    remember(state);
    close(state);
    state.open_location(&hit.path, Some(Position::new(hit.line, hit.column)), true);
}

/// The preview shows the selected hit.
fn follow_selection(f: &mut super::FindInFiles) {
    let Some(h) = f.selected_hit() else {
        if f.preview.path.is_some() && !f.searching {
            f.preview.clear();
        }
        return;
    };
    let (path, line, hl) = (h.path.clone(), h.line, Some((h.column, h.end_column)));
    let p = &f.preview;
    if p.path.as_ref() != Some(&path) || p.line != line || p.highlight != hl {
        f.preview.show_match(path, line, hl);
    }
}

fn pick_folder(state: &mut AppState, root: &Path) {
    let typed = PathBuf::from(state.ws.find.directory.trim());
    let start = if typed.is_absolute() { typed } else { root.to_path_buf() };
    let fut = state.platform.pick_folder(Some(&start));
    state.jobs.spawn_quiet(
        move || crate::util::block_on(fut),
        |state, picked| {
            let f = &mut state.ws.find;
            if let Some(p) = picked {
                f.directory = p.display().to_string();
                f.where_ = Where::Directory;
                f.debounce_at = Some(f64::NEG_INFINITY);
            }
            f.focus = f.dialog_open;
        },
    );
}

fn body(state: &mut AppState, ui: &mut Ui, rect: Rect, root: &Path, fresh: bool, actions: &mut Vec<Action>) {
    let t = &theme::T;
    let inner = rect.shrink2(vec2(PAD, 0.0));
    let mut y = rect.top();
    let mut take = |h: f32| {
        let r = Rect::from_min_size(pos2(inner.left(), y), vec2(inner.width(), h));
        y += h;
        r
    };
    let header = take(HEADER_H);
    header_row(state, ui, header);
    let lines = if state.ws.find.multiline { state.ws.find.query.lines().count().clamp(1, 5) as f32 } else { 1.0 };
    let field = take(FIELD_H + (lines - 1.0) * 17.0);
    search_field(state, ui, field, fresh);
    if state.ws.find.replace_mode {
        take(6.0);
        let r = take(FIELD_H);
        replace_field(state, ui, r);
    }
    let where_row = take(WHERE_H);
    where_row_ui(state, ui, where_row, actions);
    let bottom = Rect::from_min_max(pos2(inner.left(), rect.bottom() - BOTTOM_H), pos2(inner.right(), rect.bottom()));
    let rest = (bottom.top() - y).max(80.0);
    let list = Rect::from_min_size(pos2(rect.left() + 4.0, y), vec2(rect.width() - 8.0, (rest * 0.42).round()));
    results_list(state, ui, list, root, actions);
    let preview = Rect::from_min_max(pos2(rect.left() + 1.0, list.bottom() + 1.0), pos2(rect.right() - 1.0, bottom.top()));
    ui.painter().hline(rect.x_range(), list.bottom() + 0.5, Stroke::new(1.0_f32, t.border));
    ui.painter().rect_filled(preview, CornerRadius::ZERO, t.island_bg);
    let mut p = std::mem::take(&mut state.ws.find.preview);
    ui.scope_builder(UiBuilder::new().max_rect(preview).id_salt(wid("find-preview")), |ui| {
        ui.set_clip_rect(preview);
        crate::preview::show(state, &mut p, ui);
    });
    state.ws.find.preview = p;
    ui.painter().hline(rect.x_range(), bottom.top() + 0.5, Stroke::new(1.0_f32, t.border));
    bottom_bar(state, ui, bottom, actions);
}

fn header_row(state: &mut AppState, ui: &mut Ui, rect: Rect) {
    let t = &theme::T;
    let deterministic = state.deterministic;
    let f = &mut state.ws.find;
    ui.scope_builder(UiBuilder::new().max_rect(rect).layout(Layout::left_to_right(Align::Center)), |ui| {
        ui.spacing_mut().item_spacing.x = 10.0;
        let title = if f.replace_mode { "Replace in Files" } else { "Find in Files" };
        ui.label(egui::RichText::new(title).font(t.semibold(t.font.ui)).color(t.text_bright));
        if let Some(text) = status_text(f) {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 6.0;
                // A spinner's angle follows the clock, so snapshots leave it out.
                if f.searching && !deterministic {
                    ui.add(egui::Spinner::new().size(t.font.small));
                }
                ui.label(egui::RichText::new(text).color(t.text_dim));
            });
        }
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 4.0;
            let hist = menu_button(ui, "File Mask History", wid("find-mask-history"));
            if crate::clicks::pressed(&hist) {
                toggle_menu(f, Menu::Masks, hist.rect);
            }
            ui.add_space(4.0);
            let field = framed_edit(ui, &mut f.mask, "*.ts, !*.test.ts", 130.0, wid("find-mask"), "File mask pattern");
            if field.changed() && !f.mask.trim().is_empty() {
                f.mask_on = true;
            }
            ui.add_space(4.0);
            if checkbox(ui, f.mask_on, "File mask:").clicked() {
                f.mask_on = !f.mask_on;
            }
        });
    });
}

/// Whether the search runs and what it found: `Searching… N matches in M files` while it runs,
/// then `N matches in M files` or `No matches`, and `limit reached` once the cap cut the list off.
pub(super) fn status_text(f: &super::FindInFiles) -> Option<String> {
    if f.query.is_empty() || f.error.is_some() {
        return None;
    }
    let counts = (!f.results.is_empty()).then(|| count_text(f));
    if f.searching {
        return Some(counts.map_or("Searching…".to_string(), |c| format!("Searching… {c}")));
    }
    match counts {
        // Before the first search of a new query starts, the old answer says nothing.
        None if f.debounce_at.is_some() => None,
        None => Some("No matches".to_string()),
        Some(c) if f.truncated => Some(format!("{c} · limit reached")),
        Some(c) => Some(c),
    }
}

/// `N matches in M files`, with `+` once the cap cut the list off.
fn count_text(f: &super::FindInFiles) -> String {
    let plus = if f.truncated { "+" } else { "" };
    let (n, files) = (f.hit_count(), f.results.len());
    let s = |k: usize, one: &str, many: &str| if k == 1 && plus.is_empty() { one.to_string() } else { many.to_string() };
    format!("{n}{plus} {} in {files}{plus} {}", s(n, "match", "matches"), s(files, "file", "files"))
}

fn toggle_menu(f: &mut super::FindInFiles, menu: Menu, anchor: Rect) {
    f.menu = match f.menu {
        Some((m, _)) if m == menu => None,
        _ => Some((menu, anchor)),
    };
}

fn search_field(state: &mut AppState, ui: &mut Ui, rect: Rect, fresh: bool) {
    let t = &theme::T;
    let f = &mut state.ws.find;
    let id = wid("find-query");
    let focused = ui.ctx().memory(|m| m.has_focus(id));
    field_frame(ui, rect, focused);
    // egui takes the focus from a widget under a modal on every frame. Taking it back on every
    // frame keeps the field drawn focused while the Replace All question is open; taking it
    // back only on the next frame made the border blink, frame by frame.
    let mut refocus = fresh || f.replace_confirm.is_some();
    ui.scope_builder(UiBuilder::new().max_rect(rect.shrink2(vec2(6.0, 0.0))).layout(Layout::left_to_right(Align::Center)), |ui| {
        ui.spacing_mut().item_spacing.x = 2.0;
        let (hist, _) = ui.allocate_exact_size(vec2(30.0, BTN), Sense::hover());
        let resp = ui.interact(hist, wid("find-query-history"), Sense::click());
        crate::util::label_widget(&resp, egui::WidgetType::Button, "Search History");
        if resp.hovered() {
            ui.painter().rect_filled(hist, t.radius.button, t.hover);
        }
        icons::paint(ui.painter(), Rect::from_center_size(hist.center() - vec2(4.0, 0.0), vec2(15.0, 15.0)), Icon::Search, t.icon);
        icons::paint(ui.painter(), Rect::from_center_size(pos2(hist.right() - 5.0, hist.center().y + 1.0), vec2(8.0, 8.0)), Icon::ChevronDown, t.icon);
        if crate::clicks::pressed(&resp) {
            toggle_menu(f, Menu::Queries, hist);
        }
        let toggles_w = 4.0 * (BTN + 2.0) + if f.query.is_empty() { 0.0 } else { BTN + 2.0 } + 8.0;
        let width = (ui.available_width() - toggles_w).max(80.0);
        let edit = if f.multiline { TextEdit::multiline(&mut f.query).desired_rows(1) } else { TextEdit::singleline(&mut f.query) };
        let out = edit.id(id).frame(false).hint_text("Text to find").desired_width(width).font(t.ui_font()).show(ui);
        if refocus && !out.response.has_focus() {
            out.response.request_focus();
            if std::mem::take(&mut f.select_query) {
                // Like IDEA, the old query is selected so typing replaces it.
                let mut st = out.state.clone();
                st.cursor.set_char_range(Some(egui::text::CCursorRange::two(egui::text::CCursor::new(0), egui::text::CCursor::new(f.query.chars().count()))));
                st.store(ui.ctx(), id);
            }
            refocus = false;
        }
        ui.add_space(ui.available_width() - toggles_w + 8.0);
        if !f.query.is_empty() && glyph_button(ui, "×", "Clear search", false).clicked() {
            f.query.clear();
            refocus = true;
        }
        let toggles: [(&str, &str, &mut bool); 4] = [("⏎", "Multiline", &mut f.multiline), ("Cc", "Match Case", &mut f.case_sensitive), ("W", "Words", &mut f.whole_words), (".*", "Regex", &mut f.regex)];
        for (glyph, label, on) in toggles {
            if glyph_button(ui, glyph, label, *on).clicked() {
                *on = !*on;
                refocus = true;
            }
        }
    });
    // A press on a row or a toggle drops the text focus; the field takes it back.
    let nothing_focused = ui.ctx().memory(|m| m.focused().is_none());
    if refocus || (nothing_focused && f.menu.is_none()) {
        f.focus = true;
    }
}

fn replace_field(state: &mut AppState, ui: &mut Ui, rect: Rect) {
    let f = &mut state.ws.find;
    let id = wid("find-replacement");
    let focused = ui.ctx().memory(|m| m.has_focus(id));
    field_frame(ui, rect, focused);
    ui.scope_builder(UiBuilder::new().max_rect(rect.shrink2(vec2(38.0, 0.0))).layout(Layout::left_to_right(Align::Center)), |ui| {
        let r = TextEdit::singleline(&mut f.replacement).id(id).frame(false).hint_text("Replace with").desired_width(ui.available_width()).font(theme::T.ui_font()).show(ui);
        crate::util::label_widget(&r.response, egui::WidgetType::TextEdit, "Replace with");
    });
}

fn where_row_ui(state: &mut AppState, ui: &mut Ui, rect: Rect, actions: &mut Vec<Action>) {
    let t = &theme::T;
    let f = &mut state.ws.find;
    ui.scope_builder(UiBuilder::new().max_rect(rect).layout(Layout::left_to_right(Align::Center)), |ui| {
        ui.spacing_mut().item_spacing.x = 2.0;
        for (w, title) in [(Where::Project, "In Project"), (Where::Directory, "Directory"), (Where::Scope, "Scope")] {
            if tab(ui, title, f.where_ == w).clicked() {
                f.where_ = w;
                f.focus = true;
            }
        }
        ui.add_space(16.0);
        match f.where_ {
            Where::Project => {}
            Where::Directory => {
                let side = 3.0 * (BTN + 4.0);
                let w = (ui.available_width() - side).max(120.0);
                framed_edit(ui, &mut f.directory, "Directory", w, wid("find-directory"), "Directory path");
                let hist = menu_button(ui, "Directory History", wid("find-dir-history"));
                if crate::clicks::pressed(&hist) {
                    toggle_menu(f, Menu::Dirs, hist.rect);
                }
                if glyph_button(ui, "…", "Choose Directory", false).clicked() {
                    actions.push(Action::PickFolder);
                }
                let (r, resp) = ui.allocate_exact_size(vec2(BTN, BTN), Sense::click());
                crate::util::label_selectable(&resp, "Recursive", f.recursive);
                paint_toggle_bg(ui, r, f.recursive, resp.hovered());
                icons::paint(ui.painter(), Rect::from_center_size(r.center(), vec2(15.0, 15.0)), Icon::ExpandAll, if f.recursive { t.icon_active } else { t.icon });
                if resp.on_hover_text("Search recursively").clicked() {
                    f.recursive = !f.recursive;
                    f.focus = true;
                }
            }
            Where::Scope => {
                let text = f.named.title();
                let galley = ui.painter().layout_no_wrap(text.to_string(), t.ui_font(), t.text);
                let (r, _) = ui.allocate_exact_size(vec2(galley.size().x.max(140.0) + 34.0, 26.0), Sense::hover());
                let resp = ui.interact(r, wid("find-scope-choice"), Sense::click());
                crate::util::label_widget(&resp, egui::WidgetType::ComboBox, "Choose scope");
                ui.painter().rect(r, t.radius.button, t.input_bg, Stroke::new(1.0_f32, if resp.hovered() { t.button_border } else { t.input_border }), StrokeKind::Inside);
                ui.painter().galley(pos2(r.left() + 8.0, r.center().y - galley.size().y / 2.0), galley, t.text);
                icons::paint(ui.painter(), Rect::from_center_size(pos2(r.right() - 12.0, r.center().y), vec2(12.0, 12.0)), Icon::ChevronDown, t.icon);
                if crate::clicks::pressed(&resp) {
                    toggle_menu(f, Menu::Scopes, r);
                }
            }
        }
    });
}

fn results_list(state: &mut AppState, ui: &mut Ui, rect: Rect, root: &Path, actions: &mut Vec<Action>) {
    let t = &theme::T;
    let clicks = state.clicks;
    let excluded = state.ws.tree.excluded.clone();
    let f = &mut state.ws.find;
    // "No matches" is the header's status; the empty list says nothing more.
    if let Some(e) = &f.error {
        let (text, color) = (format!("Invalid pattern: {e}"), t.error);
        ui.scope_builder(UiBuilder::new().max_rect(rect).layout(Layout::centered_and_justified(egui::Direction::TopDown)), |ui| {
            ui.label(egui::RichText::new(text).color(color));
        });
        return;
    }
    let selected = f.selected.clone();
    let scroll = std::mem::take(&mut f.scroll_to_selected);
    let mut select = None;
    ui.scope_builder(UiBuilder::new().max_rect(rect), |ui| {
        egui::ScrollArea::vertical().id_salt(wid("find-results")).auto_shrink([false, false]).max_height(rect.height()).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 0.0;
            let width = ui.available_width();
            for (path, hits) in &f.results {
                let dim = super::is_dim(path, root, &excluded);
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let rel = path.strip_prefix(root).unwrap_or(path).display().to_string();
                for h in hits {
                    let key = super::hit_key(h);
                    let (r, _) = ui.allocate_exact_size(vec2(width, ROW_H), Sense::hover());
                    let resp = ui.interact(r, wid(("find-row", &key)), Sense::click());
                    let is_sel = selected.as_ref() == Some(&key);
                    crate::util::label_selectable(&resp, format!("Result {rel}:{}", h.line + 1), is_sel);
                    if is_sel {
                        ui.painter().rect_filled(r, t.radius.row, t.tree_selection);
                        if scroll {
                            ui.scroll_to_rect(r, None);
                        }
                    } else if resp.hovered() {
                        ui.painter().rect_filled(r, t.radius.row, t.tree_hover);
                    }
                    let file_label = format!("{name} {}", h.line + 1);
                    let file_color = if is_sel { t.text_bright } else if dim { t.text_dim } else { t.text };
                    let fg = ui.painter().layout_no_wrap(file_label, t.ui_font(), file_color);
                    let fx = r.right() - 8.0 - fg.size().x;
                    let text_clip = Rect::from_min_max(r.min, pos2(fx - 16.0, r.max.y));
                    let job = row_job(h, if is_sel { t.text_bright } else { t.text });
                    let galley = ui.fonts(|fo| fo.layout_job(job));
                    ui.painter().with_clip_rect(text_clip.intersect(ui.clip_rect())).galley(pos2(r.left() + 8.0, r.center().y - galley.size().y / 2.0), galley, t.text);
                    ui.painter().galley(pos2(fx, r.center().y - fg.size().y / 2.0), fg, file_color);
                    if crate::clicks::pressed(&resp) {
                        select = Some(key.clone());
                    }
                    if clicks.double(&resp) {
                        actions.push(Action::Open(h.clone()));
                    }
                }
            }
        });
    });
    if let Some(k) = select {
        f.selected = Some(k);
        f.user_selected = true;
    }
}

/// The line without its indent, the match highlighted; in Replace the match struck through and
/// the replacement after it.
fn row_job(h: &FindHit, color: Color32) -> LayoutJob {
    let t = &theme::T;
    let chars: Vec<char> = h.line_text.chars().collect();
    let col = h.column.min(chars.len());
    let end = h.end_column.clamp(col, chars.len());
    let lead = chars[..col].iter().take_while(|c| c.is_whitespace()).count();
    let font = t.ui_font();
    let plain = TextFormat { font_id: font.clone(), color, ..Default::default() };
    let mut job = LayoutJob::default();
    job.append(&chars[lead..col].iter().collect::<String>(), 0.0, plain.clone());
    let mut matched = TextFormat { font_id: font.clone(), color: t.text_bright, background: t.match_text.gamma_multiply(0.45), ..Default::default() };
    if h.replacement.is_some() {
        matched.strikethrough = Stroke::new(1.0_f32, t.text_bright);
    }
    job.append(&chars[col..end].iter().collect::<String>(), 0.0, matched);
    if let Some(rep) = &h.replacement {
        // A multiline replacement stays on the row's one line.
        let rep = rep.replace("\r\n", "⏎").replace('\n', "⏎");
        job.append(&rep, 0.0, TextFormat { font_id: font.clone(), color: t.text_bright, background: t.git_added.gamma_multiply(0.35), ..Default::default() });
    }
    job.append(&chars[end..].iter().collect::<String>(), 0.0, plain);
    job.wrap.max_rows = 1;
    job
}

fn bottom_bar(state: &mut AppState, ui: &mut Ui, rect: Rect, actions: &mut Vec<Action>) {
    let t = &theme::T;
    let f = &mut state.ws.find;
    ui.scope_builder(UiBuilder::new().max_rect(rect).layout(Layout::left_to_right(Align::Center)), |ui| {
        if checkbox(ui, f.new_tab, "Open results in new tab").clicked() {
            f.new_tab = !f.new_tab;
            f.focus = true;
        }
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            let any = !f.query.is_empty() && f.error.is_none();
            if ui.add_enabled(any, egui::Button::new("Open in Find Window")).clicked() {
                actions.push(Action::OpenInFindWindow);
            }
            ui.label(egui::RichText::new("⌘⏎").color(t.text_dim));
            if f.replace_mode {
                let can = any && !f.replacing && f.hit_count() > 0;
                if ui.add_enabled(can, egui::Button::new("Replace All")).clicked() {
                    actions.push(Action::ReplaceAll);
                }
                if ui.add_enabled(can && f.selected.is_some(), egui::Button::new("Replace")).clicked() {
                    actions.push(Action::Replace);
                }
            }
        });
    });
}

/// "Replace N occurrences in M files?" over the popup. Replace waits for the count.
fn confirm_dialog(state: &AppState, ctx: &Context, actions: &mut Vec<Action>) {
    let Some(confirm) = &state.ws.find.replace_confirm else { return };
    let t = &theme::T;
    let counts = confirm.counts();
    let modal = egui::Modal::new(wid("find-replace-confirm")).show(ctx, |ui| {
        ui.set_width(360.0);
        ui.label(egui::RichText::new("Replace All").strong());
        ui.add_space(6.0);
        match counts {
            None => ui.label(egui::RichText::new("Counting…").color(t.text_dim)),
            Some((0, _)) => ui.label("Nothing to replace."),
            Some((n, files)) => ui.label(format!("Replace {n} {} in {files} {}?", plural(n, "occurrence", "occurrences"), plural(files, "file", "files"))),
        };
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            let replace = ui.add_enabled(counts.is_some_and(|(n, _)| n > 0), egui::Button::new("Replace"));
            // The popup's own Replace button is still in the tree under the dialog.
            crate::util::label_widget(&replace, egui::WidgetType::Button, "Confirm Replace All");
            if crate::clicks::pressed(&replace) {
                actions.push(Action::ConfirmReplaceAll);
            }
            let cancel = ui.button("Cancel");
            crate::util::label_widget(&cancel, egui::WidgetType::Button, "Cancel Replace All");
            if crate::clicks::pressed(&cancel) {
                actions.push(Action::CancelReplaceAll);
            }
        });
    });
    if modal.should_close() && actions.is_empty() {
        actions.push(Action::CancelReplaceAll);
    }
}

fn plural<'a>(n: usize, one: &'a str, many: &'a str) -> &'a str {
    if n == 1 {
        one
    } else {
        many
    }
}

/// The open dropdown (history lists, scope choice). Returns its rect for the outside-press test.
fn show_menu(state: &mut AppState, ctx: &Context) -> Option<Rect> {
    let (menu, anchor) = state.ws.find.menu?;
    let t = &theme::T;
    let root = state.ws.project.as_ref().map(|p| p.root.clone())?;
    let history = state.find_history.get(&root).cloned().unwrap_or_default();
    let items: Vec<(String, String)> = match menu {
        Menu::Queries => history.queries.iter().map(|q| (q.replace('\n', "⏎"), format!("Recent search {q}"))).collect(),
        Menu::Masks => history.masks.iter().map(|m| (m.clone(), format!("Recent mask {m}"))).collect(),
        Menu::Dirs => history.dirs.iter().map(|d| (d.clone(), format!("Recent directory {d}"))).collect(),
        Menu::Scopes => [NamedScope::OpenFiles, NamedScope::ChangedFiles].iter().map(|s| (s.title().to_string(), format!("Scope {}", s.title()))).collect(),
    };
    let width = anchor.width().max(220.0);
    let mut chosen = None;
    let resp = egui::Area::new(wid("find-in-files-menu")).fixed_pos(pos2(anchor.left(), anchor.bottom() + 2.0)).order(egui::Order::Tooltip).constrain(true).show(ctx, |ui| {
        Frame::popup(ui.style()).fill(t.popup_bg).show(ui, |ui| {
            ui.set_width(width);
            if items.is_empty() {
                ui.label(egui::RichText::new("No history yet").color(t.text_dim));
            }
            for (i, (text, label)) in items.iter().enumerate() {
                let (r, _) = ui.allocate_exact_size(vec2(width, ROW_H), Sense::hover());
                let resp = ui.interact(r, wid(("find-menu-row", i)), Sense::click());
                crate::util::label_widget(&resp, egui::WidgetType::Button, label.clone());
                if resp.hovered() {
                    ui.painter().rect_filled(r, t.radius.row, t.tree_hover);
                }
                let g = ui.painter().layout_no_wrap(text.clone(), t.ui_font(), t.text);
                ui.painter().with_clip_rect(r).galley(pos2(r.left() + 6.0, r.center().y - g.size().y / 2.0), g, t.text);
                if crate::clicks::pressed(&resp) {
                    chosen = Some(i);
                }
            }
        });
    });
    if let Some(i) = chosen {
        let f = &mut state.ws.find;
        match menu {
            Menu::Queries => f.query = history.queries[i].clone(),
            Menu::Masks => {
                f.mask = history.masks[i].clone();
                f.mask_on = true;
            }
            Menu::Dirs => {
                f.directory = history.dirs[i].clone();
                f.where_ = Where::Directory;
            }
            Menu::Scopes => f.named = if i == 0 { NamedScope::OpenFiles } else { NamedScope::ChangedFiles },
        }
        f.menu = None;
        f.focus = true;
    }
    Some(resp.response.rect)
}

// ---------------------------------------------------------------------------------------------
// Small widgets

fn field_frame(ui: &Ui, rect: Rect, focused: bool) {
    let t = &theme::T;
    let border = if focused { Stroke::new(2.0_f32, t.accent) } else { Stroke::new(1.0_f32, t.input_border) };
    ui.painter().rect(rect, t.radius.button, t.input_bg, border, StrokeKind::Inside);
}

/// A bordered single-line field of `width`.
fn framed_edit(ui: &mut Ui, text: &mut String, hint: &str, width: f32, id: Id, label: &str) -> egui::Response {
    let t = &theme::T;
    let (r, _) = ui.allocate_exact_size(vec2(width, 26.0), Sense::hover());
    let focused = ui.ctx().memory(|m| m.has_focus(id));
    field_frame(ui, r, focused);
    let out = ui.scope_builder(UiBuilder::new().max_rect(r.shrink2(vec2(6.0, 0.0))).layout(Layout::left_to_right(Align::Center)), |ui| {
        TextEdit::singleline(text).id(id).frame(false).hint_text(hint).desired_width(ui.available_width()).font(t.ui_font()).show(ui).response
    });
    crate::util::label_widget(&out.inner, egui::WidgetType::TextEdit, label);
    out.inner
}

fn paint_toggle_bg(ui: &Ui, r: Rect, on: bool, hovered: bool) {
    let t = &theme::T;
    if on {
        ui.painter().rect_filled(r, t.radius.button, t.strip_active_bg);
    } else if hovered {
        ui.painter().rect_filled(r, t.radius.button, t.hover);
    }
}

/// A text toggle (`Cc`, `W`, `.*`, `⏎`) or a plain glyph button (`×`, `…`) when never on.
fn glyph_button(ui: &mut Ui, glyph: &str, label: &str, on: bool) -> egui::Response {
    let t = &theme::T;
    let (r, resp) = ui.allocate_exact_size(vec2(BTN, BTN), Sense::click());
    crate::util::label_selectable(&resp, label, on);
    paint_toggle_bg(ui, r, on, resp.hovered());
    let color = if on || resp.hovered() { t.text_bright } else { t.icon };
    ui.painter().text(r.center(), Align2::CENTER_CENTER, glyph, t.ui_font(), color);
    resp.on_hover_text(label)
}

/// A `⌄` button that opens a dropdown, with a stable id.
fn menu_button(ui: &mut Ui, label: &str, id: Id) -> egui::Response {
    let t = &theme::T;
    let (r, _) = ui.allocate_exact_size(vec2(20.0, BTN), Sense::hover());
    let resp = ui.interact(r, id, Sense::click());
    crate::util::label_widget(&resp, egui::WidgetType::Button, label);
    paint_toggle_bg(ui, r, false, resp.hovered());
    icons::paint(ui.painter(), Rect::from_center_size(r.center(), vec2(11.0, 11.0)), Icon::ChevronDown, t.icon);
    resp
}

/// The "where" tabs: highlighted while selected.
fn tab(ui: &mut Ui, title: &str, on: bool) -> egui::Response {
    let t = &theme::T;
    let galley = ui.painter().layout_no_wrap(title.to_string(), t.ui_font(), t.text);
    let (r, resp) = ui.allocate_exact_size(vec2(galley.size().x + 14.0, 26.0), Sense::click());
    crate::util::label_selectable(&resp, title, on);
    paint_toggle_bg(ui, r, on, resp.hovered());
    let color = if on { t.text_bright } else { t.text };
    ui.painter().galley(pos2(r.left() + 7.0, r.center().y - galley.size().y / 2.0), galley, color);
    resp
}

/// An IDEA checkbox with its label; the caller flips the value on click.
fn checkbox(ui: &mut Ui, on: bool, label: &str) -> egui::Response {
    let t = &theme::T;
    let galley = ui.painter().layout_no_wrap(label.to_string(), t.ui_font(), t.text);
    let size = theme::CHECKBOX_SIZE;
    let (r, resp) = ui.allocate_exact_size(vec2(size + 6.0 + galley.size().x, 24.0), Sense::click());
    let enabled = resp.enabled();
    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Checkbox, enabled, on, label));
    let bx = Rect::from_min_size(pos2(r.left(), r.center().y - size / 2.0), vec2(size, size));
    icons::checkbox(ui.painter(), bx, if on { icons::CheckState::Checked } else { icons::CheckState::Unchecked }, resp.hovered());
    ui.painter().galley(pos2(bx.right() + 6.0, r.center().y - galley.size().y / 2.0), galley, t.text);
    resp
}
