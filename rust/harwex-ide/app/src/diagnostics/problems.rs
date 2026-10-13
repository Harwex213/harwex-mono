//! The problem UI outside the editor widget: the counts widget at the top right of the
//! editor, the hover text, and the Problems tool window ("Current File").

use std::path::PathBuf;

use egui::{pos2, vec2, Align2, Color32, Rect, RichText, ScrollArea, Sense, Ui};
use ide_editor::{Position, ProblemSeverity};

use crate::icons::{self, Icon};
use crate::state::AppState;
use crate::tabs::EditorTab;
use crate::theme::T;

pub fn color(sev: ProblemSeverity) -> Color32 {
    match sev {
        ProblemSeverity::Error => T.error,
        ProblemSeverity::Warning => T.warning,
        ProblemSeverity::Weak | ProblemSeverity::Unused => T.text_dim,
    }
}

pub fn icon(sev: ProblemSeverity) -> Icon {
    match sev {
        ProblemSeverity::Error => Icon::Error,
        _ => Icon::Warning,
    }
}

fn group_title(sev: ProblemSeverity) -> &'static str {
    match sev {
        ProblemSeverity::Error => "Errors",
        ProblemSeverity::Warning => "Warnings",
        ProblemSeverity::Weak => "Weak Warnings",
        ProblemSeverity::Unused => "Unused Code",
    }
}

/// IDEA's widget at the top right of the editor: error and warning counts with their icons,
/// or a check mark when the file is clean. A click goes to the next problem. Draws nothing
/// before the first check of the file.
pub fn counts_widget(ui: &mut Ui, text_rect: Rect, e: &EditorTab) -> bool {
    if !e.problems.checked() {
        return false;
    }
    let (errors, warnings) = e.problems.counts();
    let font = T.ui_font();
    let mut parts: Vec<(Icon, Color32, String)> = Vec::new();
    if errors > 0 {
        parts.push((Icon::Error, T.error, errors.to_string()));
    }
    if warnings > 0 {
        parts.push((Icon::Warning, T.warning, warnings.to_string()));
    }
    let galleys: Vec<_> = parts.iter().map(|(_, _, n)| ui.painter().layout_no_wrap(n.clone(), font.clone(), T.text)).collect();
    let icon_w = 14.0;
    let w = if parts.is_empty() { 22.0 } else { 6.0 + galleys.iter().map(|g| icon_w + 3.0 + g.size().x + 6.0).sum::<f32>() };
    let h = 20.0;
    // Left of the scrollbar marks, under the top edge.
    let rect = Rect::from_min_size(pos2(text_rect.right() - 18.0 - w, text_rect.top() + 4.0), vec2(w, h));
    // Its own layer above the editor: the editor's text area must not see the press.
    let area = egui::Area::new(ui.id().with("problems-widget-area")).order(egui::Order::Middle).fixed_pos(rect.min).constrain(false);
    area.show(ui.ctx(), |ui| widget_body(ui, rect, &parts, galleys, errors, warnings)).inner
}

fn widget_body(ui: &mut Ui, rect: Rect, parts: &[(Icon, Color32, String)], galleys: Vec<std::sync::Arc<egui::Galley>>, errors: usize, warnings: usize) -> bool {
    let icon_w = 14.0;
    let (_, resp) = ui.allocate_exact_size(rect.size(), Sense::click());
    let label = if parts.is_empty() { "Problems: none".to_string() } else { format!("Problems: {errors} errors, {warnings} warnings") };
    crate::util::label_widget(&resp, egui::WidgetType::Button, label);
    let painter = ui.painter();
    painter.rect_filled(rect, T.radius.button, if resp.hovered() { T.hover } else { T.island_bg });
    if parts.is_empty() {
        icons::paint(painter, Rect::from_center_size(rect.center(), vec2(icon_w, icon_w)), Icon::Check, T.git_added);
    } else {
        let mut x = rect.min.x + 6.0;
        for ((icon, color, _), g) in parts.iter().zip(galleys) {
            icons::paint(painter, Rect::from_min_size(pos2(x, rect.center().y - icon_w / 2.0), vec2(icon_w, icon_w)), *icon, *color);
            x += icon_w + 3.0;
            painter.galley(pos2(x, rect.center().y - g.size().y / 2.0), g.clone(), T.text);
            x += g.size().x + 6.0;
        }
    }
    resp.on_hover_text("Next problem  F2").clicked()
}

/// The problem part of the editor hover, above quick info.
pub fn hover_ui(ui: &mut Ui, lines: &[(ProblemSeverity, String, String)]) {
    for (sev, message, origin) in lines {
        ui.horizontal(|ui| {
            let (r, _) = ui.allocate_exact_size(vec2(14.0, 14.0), Sense::hover());
            icons::paint(ui.painter(), r, icon(*sev), color(*sev));
            ui.label(RichText::new(message).color(T.text_bright));
        });
        ui.label(RichText::new(origin).color(T.text_dim).size(T.font.small));
    }
}

enum Row {
    Group(ProblemSeverity, usize),
    Item(Item),
}

/// One problem row of the Problems window, with what its copy actions need.
struct Item {
    sev: ProblemSeverity,
    pos: Position,
    /// The first line of the message, as the row shows it.
    line: String,
    message: String,
    origin: String,
    /// The problem's char offset: with the message, it keeps the selection on its problem when
    /// rows above it come or go.
    start: usize,
}

impl Item {
    fn key(&self) -> (usize, String) {
        (self.start, self.message.clone())
    }
}

/// The text "Copy with location" puts on the clipboard: `path:line:col: message [origin]`, the
/// form compilers print, so a terminal or an IDE can jump to it. Line and column are 1-based.
pub fn with_location(path: &str, pos: Position, message: &str, origin: &str) -> String {
    format!("{path}:{}:{}: {message} [{origin}]", pos.line + 1, pos.column + 1)
}

/// The Problems list: a focusable widget over the rows, so ⌘C and the arrows reach it.
pub fn list_id() -> egui::Id {
    crate::workspace::wid("problems-list")
}

fn selected_id() -> egui::Id {
    crate::workspace::wid("problems-selected")
}

/// The selected problem's (char offset, message), when one is selected.
pub fn selected(ctx: &egui::Context) -> Option<(usize, String)> {
    ctx.data(|d| d.get_temp::<(usize, String)>(selected_id()))
}

enum Action {
    /// Select the row and put the editor's caret on the problem; the keys stay in the list.
    Select(usize),
    /// Open the problem in the editor and give it the keys (double click, Enter).
    Open(usize),
    Copy(usize, bool),
}

/// The Problems tool window body: the active file's problems grouped by severity. A click
/// selects a row and moves the editor's caret to it, a double click or Enter also gives the
/// editor the keys. ⌘C copies the selected message; the row menu has Copy and Copy with
/// location.
pub fn tool_window(state: &mut AppState, ui: &mut Ui) {
    let file: Option<(PathBuf, String, Vec<Row>)> = state.ws.tabs.active_editor_mut().map(|e| {
        e.problems.refresh(&e.doc);
        let rows = super::file_rows(e);
        let mut out = Vec::new();
        for sev in ProblemSeverity::ALL {
            let items: Vec<_> = rows.iter().filter(|(_, p)| p.severity == sev).collect();
            if items.is_empty() {
                continue;
            }
            out.push(Row::Group(sev, items.len()));
            for (pos, p) in items {
                let line = p.message.lines().next().unwrap_or_default().to_string();
                out.push(Row::Item(Item { sev, pos: *pos, line, message: p.message.clone(), origin: p.origin(), start: p.start }));
            }
        }
        (e.path.clone(), e.file_name(), out)
    });
    // The one tab, like IDEA's "Current File".
    ui.horizontal(|ui| {
        let (r, resp) = ui.allocate_exact_size(vec2(96.0, 24.0), Sense::hover());
        crate::util::label_selectable(&resp, "Current File", true);
        ui.painter().rect_filled(r, T.radius.row, T.selection);
        ui.painter().text(r.center(), Align2::CENTER_CENTER, "Current File", T.ui_font(), T.text_bright);
        if let Some((_, name, rows)) = &file {
            let n = rows.iter().filter(|r| matches!(r, Row::Item(_))).count();
            ui.label(RichText::new(format!("{name}  {n} problems")).color(T.text_dim));
        }
    });
    ui.add_space(4.0);
    let Some((path, _, rows)) = file else {
        ui.label(RichText::new("No file is open").color(T.text_dim));
        return;
    };
    if rows.is_empty() {
        ui.label(RichText::new("No problems in this file").color(T.text_dim));
        return;
    }
    let ctx = ui.ctx().clone();
    // The list takes the keys like the project tree: a focusable widget under the rows.
    let list = ui.interact(ui.available_rect_before_wrap(), list_id(), Sense::focusable_noninteractive());
    let focused = list.has_focus();
    if focused {
        // The arrows walk the rows; egui must not move the focus with them.
        ui.memory_mut(|m| m.set_focus_lock_filter(list_id(), egui::EventFilter { vertical_arrows: true, ..Default::default() }));
    }
    let items: Vec<&Item> = rows.iter().filter_map(|r| if let Row::Item(i) = r { Some(i) } else { None }).collect();
    let sel = selected(&ctx).and_then(|k| items.iter().position(|i| i.key() == k));
    let mut action = if focused { list_keys(&ctx, sel, items.len()) } else { None };
    let row_h = T.space.row_h;
    let mut item_at = 0;
    ScrollArea::vertical().auto_shrink([false, false]).id_salt("problems").show_rows(ui, row_h, rows.len(), |ui, range| {
        // The index among the items of the first drawn row.
        item_at = rows[..range.start].iter().filter(|r| matches!(r, Row::Item(_))).count();
        for row in &rows[range] {
            let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), row_h), Sense::hover());
            let painter = ui.painter_at(rect);
            let y = rect.center().y;
            match row {
                Row::Group(sev, n) => {
                    let resp = ui.interact(rect, crate::workspace::wid(("problems-group", group_title(*sev))), Sense::hover());
                    crate::util::label_widget(&resp, egui::WidgetType::Label, format!("{} group", group_title(*sev)));
                    painter.text(pos2(rect.min.x + 6.0, y), Align2::LEFT_CENTER, format!("{}  {n}", group_title(*sev)), T.semibold(T.font.ui), T.text);
                }
                Row::Item(item) => {
                    let idx = item_at;
                    item_at += 1;
                    // The id follows the problem, so an open menu stays on its row.
                    let resp = ui.interact(rect, crate::workspace::wid(("problems-row", &path, item.start, &item.message)), Sense::click());
                    let is_selected = sel == Some(idx);
                    crate::util::label_selectable(&resp, format!("Problem {} at {}:{}", item.line, item.pos.line + 1, item.pos.column + 1), is_selected);
                    if is_selected {
                        painter.rect_filled(rect, T.radius.row, if focused { T.tree_selection } else { T.tree_selection_inactive });
                    } else if resp.hovered() {
                        painter.rect_filled(rect, T.radius.row, T.hover);
                    }
                    let x = rect.min.x + 22.0;
                    icons::paint(&painter, Rect::from_center_size(pos2(x + 7.0, y), vec2(14.0, 14.0)), icon(item.sev), color(item.sev));
                    let g = painter.layout_no_wrap(item.line.clone(), T.ui_font(), T.text);
                    let msg_w = g.size().x;
                    painter.galley(pos2(x + 20.0, y - g.size().y / 2.0), g, T.text);
                    painter.text(pos2(x + 20.0 + msg_w + 10.0, y), Align2::LEFT_CENTER, format!("{}  {}:{}", item.origin, item.pos.line + 1, item.pos.column + 1), T.ui_font(), T.text_dim);
                    // A press elsewhere drops the list's focus until the release; take it back
                    // on the press frame (`tree::show` does the same).
                    if resp.is_pointer_button_down_on() || resp.clicked() || resp.secondary_clicked() {
                        ctx.memory_mut(|m| m.request_focus(list_id()));
                    }
                    if state.clicks.double(&resp) {
                        action = Some(Action::Open(idx));
                    } else if resp.clicked() || resp.secondary_clicked() {
                        action = Some(Action::Select(idx));
                    }
                    resp.context_menu(|ui| {
                        if ui.button("Copy").clicked() {
                            action = Some(Action::Copy(idx, false));
                            ui.close_menu();
                        }
                        if ui.button("Copy with location").clicked() {
                            action = Some(Action::Copy(idx, true));
                            ui.close_menu();
                        }
                    });
                }
            }
        }
    });
    let Some(action) = action else { return };
    let idx = match action {
        Action::Select(i) | Action::Open(i) | Action::Copy(i, _) => i,
    };
    let Some(item) = items.get(idx) else { return };
    ctx.data_mut(|d| d.insert_temp(selected_id(), item.key()));
    // A press in the row menu took the focus from the list; the list keeps the keys.
    if !matches!(action, Action::Open(_)) {
        ctx.memory_mut(|m| m.request_focus(list_id()));
    }
    match action {
        Action::Select(_) => {
            // The caret moves like a jump (Back returns), and the editor does not take the keys.
            if let Some(cur) = state.current_point().filter(|c| c.pos != item.pos) {
                state.ws.nav.push_back(cur);
            }
            if let Some(e) = state.ws.tabs.active_editor_mut() {
                e.view.reveal(item.pos);
            }
        }
        Action::Open(_) => state.open_location(&path, Some(item.pos), true),
        Action::Copy(_, located) => {
            let text = if located {
                let root = state.ws.project.as_ref().map(|p| p.root.clone());
                let shown = root.and_then(|r| path.strip_prefix(r).ok().map(|p| p.to_path_buf())).unwrap_or_else(|| path.clone());
                with_location(&shown.to_string_lossy(), item.pos, &item.message, &item.origin)
            } else {
                item.message.clone()
            };
            state.platform.copy_text(&ctx, &text);
        }
    }
}

/// The keys of the focused list: ⌘C copies (macOS sends it as `Event::Copy`, no key event),
/// the arrows move the selection, Enter opens it.
fn list_keys(ctx: &egui::Context, sel: Option<usize>, n: usize) -> Option<Action> {
    use egui::{Key, Modifiers};
    ctx.input_mut(|i| {
        let mut copy = false;
        i.events.retain(|e| {
            let hit = matches!(e, egui::Event::Copy);
            copy |= hit;
            !hit
        });
        if copy || i.consume_key(Modifiers::COMMAND, Key::C) {
            return sel.map(|s| Action::Copy(s, false));
        }
        if n == 0 {
            return None;
        }
        if i.consume_key(Modifiers::NONE, Key::ArrowDown) {
            return Some(Action::Select(sel.map_or(0, |s| (s + 1).min(n - 1))));
        }
        if i.consume_key(Modifiers::NONE, Key::ArrowUp) {
            return Some(Action::Select(sel.map_or(0, |s| s.saturating_sub(1))));
        }
        if i.consume_key(Modifiers::NONE, Key::Enter) {
            return sel.map(Action::Open);
        }
        None
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_with_location_reads_like_a_compiler_line() {
        let pos = Position { line: 32, column: 0 };
        assert_eq!(with_location("Source/Game.h", pos, "Unknown type name 'X'", "clangd(unknown_typename)"), "Source/Game.h:33:1: Unknown type name 'X' [clangd(unknown_typename)]");
    }
}
