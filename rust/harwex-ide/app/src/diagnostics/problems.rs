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
    Item { sev: ProblemSeverity, pos: Position, message: String, origin: String },
}

/// The Problems tool window body: the active file's problems grouped by severity.
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
                let message = p.message.lines().next().unwrap_or_default().to_string();
                out.push(Row::Item { sev, pos: *pos, message, origin: p.origin() });
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
            let n = rows.iter().filter(|r| matches!(r, Row::Item { .. })).count();
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
    let row_h = T.space.row_h;
    let mut open = None;
    ScrollArea::vertical().auto_shrink([false, false]).id_salt("problems").show_rows(ui, row_h, rows.len(), |ui, range| {
        for row in &rows[range] {
            let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), row_h), Sense::click());
            let painter = ui.painter_at(rect);
            if resp.hovered() {
                painter.rect_filled(rect, T.radius.row, T.hover);
            }
            let y = rect.center().y;
            match row {
                Row::Group(sev, n) => {
                    crate::util::label_widget(&resp, egui::WidgetType::Label, format!("{} group", group_title(*sev)));
                    painter.text(pos2(rect.min.x + 6.0, y), Align2::LEFT_CENTER, format!("{}  {n}", group_title(*sev)), T.semibold(T.font.ui), T.text);
                }
                Row::Item { sev, pos, message, origin } => {
                    crate::util::label_widget(&resp, egui::WidgetType::Button, format!("Problem {message} at {}:{}", pos.line + 1, pos.column + 1));
                    let x = rect.min.x + 22.0;
                    icons::paint(&painter, Rect::from_center_size(pos2(x + 7.0, y), vec2(14.0, 14.0)), icon(*sev), color(*sev));
                    let g = painter.layout_no_wrap(message.clone(), T.ui_font(), T.text);
                    let msg_w = g.size().x;
                    painter.galley(pos2(x + 20.0, y - g.size().y / 2.0), g, T.text);
                    painter.text(pos2(x + 20.0 + msg_w + 10.0, y), Align2::LEFT_CENTER, format!("{origin}  {}:{}", pos.line + 1, pos.column + 1), T.ui_font(), T.text_dim);
                    if resp.clicked() {
                        open = Some(*pos);
                    }
                }
            }
        }
    });
    if let Some(pos) = open {
        state.open_location(&path, Some(pos), true);
    }
}
