//! The filter bar of a Log tab: Text or hash (with regex and case toggles), Branch, User and
//! Paths popups, and the No Merges and Refresh actions on the right.

use std::path::Path;
use std::sync::Arc;

use egui::popup::PopupCloseBehavior;
use egui::{pos2, vec2, Align, Align2, Frame, Id, Layout, Margin, Rect, Response, RichText, ScrollArea, Sense, Stroke, TextEdit, Ui};

use super::{reload, Author, LogView};
use crate::icons::{self, Icon};
use crate::state::AppState;
use crate::theme;

const BAR_H: f32 = 30.0;
/// The Paths popup lists at most this many matches.
const PATH_MATCHES: usize = 200;

/// Search texts and caches of the filter popups.
#[derive(Default)]
pub(super) struct Popups {
    branch_query: String,
    user_query: String,
    path_query: String,
    /// Every file and folder of the project index (`/`-separated, relative to the project
    /// root), built when the Paths popup opens; keyed by the index list it came from.
    path_candidates: Option<(usize, Vec<String>)>,
    /// The matches of the last Paths query.
    path_matches: Option<(String, Vec<String>)>,
}

#[derive(Default)]
struct Changes {
    /// A filter changed; reload now.
    now: bool,
    /// The text box changed; reload after the debounce.
    text: bool,
    refresh: bool,
}

pub(super) fn bar(state: &mut AppState, view: &mut LogView, ui: &mut Ui) {
    let t = &theme::T;
    let mut ch = Changes::default();
    let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), BAR_H), Sense::hover());
    let mut row = ui.new_child(egui::UiBuilder::new().max_rect(rect).layout(Layout::left_to_right(Align::Center)));
    row.spacing_mut().item_spacing.x = 4.0;
    search_box(&mut row, view, &mut ch);
    row.add_space(8.0);
    branch_filter(state, &mut row, view, &mut ch);
    user_filter(state, &mut row, view, &mut ch);
    paths_filter(state, &mut row, view, &mut ch);

    let mut right = row.new_child(egui::UiBuilder::new().max_rect(rect).layout(Layout::right_to_left(Align::Center)));
    right.spacing_mut().item_spacing.x = 4.0;
    if crate::layout::icon_button(&mut right, Icon::Refresh, "Refresh log", "Refresh").clicked() {
        ch.refresh = true;
    }
    if toggle(&mut right, "No Merges", "No Merges", view.filter.no_merges, "Hide merge commits").clicked() {
        view.filter.no_merges = !view.filter.no_merges;
        ch.now = true;
    }
    let count = view.commits.len();
    let more = if view.has_more { "+" } else { "" };
    let text = if view.loading { format!("{count}{more} commits, loading...") } else { format!("{count}{more} commits") };
    right.add_space(6.0);
    right.label(RichText::new(text).size(t.font.small).color(t.text_dim));
    ui.painter().hline(rect.x_range(), rect.bottom() - 0.5, Stroke::new(1.0_f32, t.border));

    if ch.now {
        view.filter_changed(state);
    } else if ch.text {
        view.text_edited(state);
    } else if ch.refresh {
        let keep = view.commits.len();
        reload(state, view, keep);
    }
}

fn search_box(ui: &mut Ui, view: &mut LogView, ch: &mut Changes) {
    let t = &theme::T;
    Frame::NONE
        .fill(t.input_bg)
        .stroke(Stroke::new(1.0_f32, t.input_border))
        .corner_radius(t.radius.button)
        .inner_margin(Margin { left: 6, right: 4, top: 2, bottom: 2 })
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing.x = 2.0;
            let (icon, _) = ui.allocate_exact_size(vec2(16.0, 18.0), Sense::hover());
            icons::paint(ui.painter(), Rect::from_center_size(icon.center(), vec2(14.0, 14.0)), Icon::Search, t.icon);
            let r = ui.add(TextEdit::singleline(&mut view.filter.text).hint_text("Text or hash").frame(false).desired_width(170.0));
            if r.changed() {
                ch.text = true;
            }
            if toggle(ui, ".*", "Regex", view.filter.regex, "Regex").clicked() {
                view.filter.regex = !view.filter.regex;
                ch.now = true;
            }
            if toggle(ui, "Cc", "Match Case", view.filter.case_sensitive, "Match Case").clicked() {
                view.filter.case_sensitive = !view.filter.case_sensitive;
                ch.now = true;
            }
        });
}

/// A small text toggle: highlighted while on. `label` is its accessibility name.
fn toggle(ui: &mut Ui, text: &str, label: &str, on: bool, tooltip: &str) -> Response {
    let t = &theme::T;
    let galley = ui.painter().layout_no_wrap(text.to_string(), t.small_font(), t.text);
    let size = vec2(galley.size().x + 10.0, 20.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    crate::util::label_selectable(&resp, label, on);
    let fill = if on {
        Some(t.strip_active_bg)
    } else if resp.hovered() {
        Some(t.hover)
    } else {
        None
    };
    if let Some(f) = fill {
        ui.painter().rect_filled(rect, t.radius.button, f);
    }
    let color = if on { t.text_bright } else { t.text };
    ui.painter().text(rect.center(), Align2::CENTER_CENTER, text, t.small_font(), color);
    resp.on_hover_text(tooltip)
}

/// A filter label that opens a popup: "Branch: HEAD", or "User" with a chevron while unset.
fn chip(ui: &mut Ui, text: &str, set: bool, label: &str) -> Response {
    let t = &theme::T;
    let galley = ui.painter().layout_no_wrap(text.to_string(), t.ui_font(), t.text);
    let chevron = if set { 0.0 } else { 14.0 };
    let size = vec2(galley.size().x + 10.0 + chevron, 22.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    crate::util::label_widget(&resp, egui::WidgetType::Button, label);
    if resp.hovered() {
        ui.painter().rect_filled(rect, t.radius.button, t.hover);
    }
    let color = if set { t.text_bright } else { t.text_dim };
    ui.painter().galley(pos2(rect.left() + 5.0, rect.center().y - galley.size().y / 2.0), galley, color);
    if !set {
        icons::paint(ui.painter(), Rect::from_center_size(pos2(rect.right() - 9.0, rect.center().y), vec2(12.0, 12.0)), Icon::ChevronDown, t.icon);
    }
    resp
}

/// The cross after a set filter that clears it.
fn cross(ui: &mut Ui, label: &str) -> bool {
    let t = &theme::T;
    let (rect, resp) = ui.allocate_exact_size(vec2(16.0, 22.0), Sense::click());
    crate::util::label_widget(&resp, egui::WidgetType::Button, label);
    let color = if resp.hovered() { t.icon_active } else { t.icon };
    icons::paint(ui.painter(), Rect::from_center_size(rect.center(), vec2(11.0, 11.0)), Icon::Close, color);
    resp.on_hover_text(label).clicked()
}

/// Opens or closes `id` under `resp`; returns true on the frame it opened.
fn popup_toggle(ui: &Ui, id: Id, resp: &Response) -> bool {
    if !resp.clicked() {
        return false;
    }
    let was_open = ui.memory(|m| m.is_popup_open(id));
    ui.memory_mut(|m| m.toggle_popup(id));
    !was_open
}

fn search_field(ui: &mut Ui, text: &mut String, hint: &str, focus: bool) {
    let r = ui.add(TextEdit::singleline(text).hint_text(hint).desired_width(f32::INFINITY));
    if focus {
        r.request_focus();
    }
}

fn matches(query: &str, s: &str) -> bool {
    query.is_empty() || s.to_lowercase().contains(&query.to_lowercase())
}

/// A checkbox row that adds or removes `item` from `list`.
fn check<T: PartialEq + Clone>(ui: &mut Ui, list: &mut Vec<T>, item: &T, text: &str) -> bool {
    let mut on = list.contains(item);
    if ui.checkbox(&mut on, text).changed() {
        if on {
            list.push(item.clone());
        } else {
            list.retain(|x| x != item);
        }
        return true;
    }
    false
}

fn branch_filter(state: &mut AppState, ui: &mut Ui, view: &mut LogView, ch: &mut Changes) {
    let set = !view.filter.branches.is_empty();
    let text = if set { format!("Branch: {}", view.filter.branches.join(", ")) } else { "Branch".to_string() };
    let resp = chip(ui, &text, set, "Branch filter");
    let id = Id::new(("git-log-branch-popup", view.id));
    let opened = popup_toggle(ui, id, &resp);
    if set && cross(ui, "Reset branch filter") {
        view.filter.branches.clear();
        ch.now = true;
    }
    let (local, remote) = &state.git_ui.log.branch_names;
    let q = &mut view.popups.branch_query;
    let branches = &mut view.filter.branches;
    egui::popup_below_widget(ui, id, &resp, PopupCloseBehavior::CloseOnClickOutside, |ui| {
        ui.set_min_width(260.0);
        search_field(ui, q, "Search branches", opened);
        ScrollArea::vertical().id_salt("branches").max_height(320.0).show(ui, |ui| {
            let query = q.trim();
            if matches(query, "HEAD") {
                ch.now |= check(ui, branches, &"HEAD".to_string(), "HEAD");
            }
            for (title, names) in [("Local", local), ("Remote", remote)] {
                let shown: Vec<&String> = names.iter().filter(|b| matches(query, b)).collect();
                if shown.is_empty() {
                    continue;
                }
                ui.label(RichText::new(title).size(theme::T.font.small).color(theme::T.text_dim));
                for b in shown {
                    ch.now |= check(ui, branches, b, b);
                }
            }
        });
    });
}

fn user_filter(state: &mut AppState, ui: &mut Ui, view: &mut LogView, ch: &mut Changes) {
    let set = !view.filter.authors.is_empty();
    let text = if set {
        let names: Vec<&str> = view.filter.authors.iter().map(|a| match a {
            Author::Me => "me",
            Author::Name(n) => n.as_str(),
        }).collect();
        format!("User: {}", names.join(", "))
    } else {
        "User".to_string()
    };
    let resp = chip(ui, &text, set, "User filter");
    let id = Id::new(("git-log-user-popup", view.id));
    let opened = popup_toggle(ui, id, &resp);
    if set && cross(ui, "Reset user filter") {
        view.filter.authors.clear();
        ch.now = true;
    }
    let me = state.git_ui.log.me.clone();
    let q = &mut view.popups.user_query;
    let authors = &mut view.filter.authors;
    let seen = &view.authors_seen;
    egui::popup_below_widget(ui, id, &resp, PopupCloseBehavior::CloseOnClickOutside, |ui| {
        ui.set_min_width(220.0);
        search_field(ui, q, "Search users", opened);
        ScrollArea::vertical().id_salt("users").max_height(320.0).show(ui, |ui| {
            let query = q.trim();
            if me.is_some() && matches(query, "me") {
                ch.now |= check(ui, authors, &Author::Me, "me");
            }
            for name in seen.iter().filter(|n| matches(query, n)) {
                ch.now |= check(ui, authors, &Author::Name(name.clone()), name);
            }
        });
    });
}

fn paths_filter(state: &mut AppState, ui: &mut Ui, view: &mut LogView, ch: &mut Changes) {
    let root = state.project.as_ref().map(|p| p.root.clone()).unwrap_or_default();
    let rel = |p: &Path| p.strip_prefix(&root).unwrap_or(p).display().to_string();
    let set = !view.filter.paths.is_empty();
    let text = match view.filter.paths.as_slice() {
        [] => "Paths".to_string(),
        [one] => format!("Paths: {}", rel(one)),
        many => format!("Paths: {} paths", many.len()),
    };
    let resp = chip(ui, &text, set, "Paths filter");
    let id = Id::new(("git-log-paths-popup", view.id));
    let opened = popup_toggle(ui, id, &resp);
    if set && cross(ui, "Reset paths filter") {
        view.filter.paths.clear();
        ch.now = true;
    }
    if !ui.memory(|m| m.is_popup_open(id)) {
        return;
    }
    let files = state.index.files.clone();
    let key = Arc::as_ptr(&files) as usize;
    if view.popups.path_candidates.as_ref().is_none_or(|(k, _)| *k != key) {
        view.popups.path_candidates = Some((key, path_candidates(&files)));
        view.popups.path_matches = None;
    }
    let query = view.popups.path_query.trim().to_lowercase();
    if view.popups.path_matches.as_ref().is_none_or(|(q, _)| *q != query) {
        let all = view.popups.path_candidates.as_ref().map(|(_, c)| c.as_slice()).unwrap_or_default();
        let found: Vec<String> = if query.is_empty() {
            all.iter().filter(|p| !p.trim_end_matches('/').contains('/')).take(PATH_MATCHES).cloned().collect()
        } else {
            all.iter().filter(|p| p.to_lowercase().contains(&query)).take(PATH_MATCHES).cloned().collect()
        };
        view.popups.path_matches = Some((query, found));
    }
    let q = &mut view.popups.path_query;
    let paths = &mut view.filter.paths;
    let found = view.popups.path_matches.as_ref().map(|(_, f)| f.as_slice()).unwrap_or_default();
    egui::popup_below_widget(ui, id, &resp, PopupCloseBehavior::CloseOnClickOutside, |ui| {
        ui.set_min_width(320.0);
        search_field(ui, q, "Search files and folders", opened);
        ScrollArea::vertical().id_salt("paths").max_height(320.0).show(ui, |ui| {
            // The chosen paths stay on top, so they can be unchecked whatever the query.
            for p in paths.clone() {
                ch.now |= check(ui, paths, &p, &rel(&p));
            }
            for f in found {
                let abs = root.join(f.trim_end_matches('/'));
                if paths.contains(&abs) {
                    continue;
                }
                ch.now |= check(ui, paths, &abs, f);
            }
        });
    });
}

/// Files of the index plus every folder above them (folders end with `/`), sorted.
fn path_candidates(files: &[String]) -> Vec<String> {
    let mut dirs = std::collections::BTreeSet::new();
    for f in files {
        let mut end = f.len();
        while let Some(i) = f[..end].rfind('/') {
            if !dirs.insert(f[..=i].to_string()) {
                break;
            }
            end = i;
        }
    }
    let mut out: Vec<String> = dirs.into_iter().collect();
    out.extend(files.iter().cloned());
    out.sort_unstable();
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn candidates_list_folders_once() {
        let files = vec!["a/b/c.ts".to_string(), "a/b/d.ts".to_string(), "e.md".to_string()];
        assert_eq!(super::path_candidates(&files), ["a/", "a/b/", "a/b/c.ts", "a/b/d.ts", "e.md"]);
    }
}
