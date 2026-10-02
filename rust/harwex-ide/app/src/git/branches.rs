//! Branches popup from the top-bar button: search, Recent / Local / Remote groups with
//! ahead/behind arrows, a per-branch submenu, and the dialogs those actions need. The popup
//! also carries the repository-wide actions (Update, Push, Fetch, Stash, Unstash), like the
//! top of IDEA's branches popup.

use egui::{pos2, vec2, Align2, Area, Context, Frame, Id, Key, Modal, Order, Pos2, Rect, RichText, ScrollArea, Sense, TextEdit, Ui};
use ide_git::{BranchInfo, Branches};

use super::remote::run_op;
use crate::state::AppState;
use crate::theme;

const POPUP_W: f32 = 380.0;
const ROW_H: f32 = 22.0;

#[derive(Default)]
pub struct BranchesUi {
    open: bool,
    anchor: Pos2,
    query: String,
    focus_search: bool,
    loading: bool,
    data: Option<Branches>,
    /// Branch whose submenu is open: name, group (0 recent, 1 local, 2 remote), row y.
    expanded: Option<(String, u8, f32)>,
    /// Popup and submenu rects of the last frame, for click-outside detection.
    rects: Vec<Rect>,
    /// Height of the list's content in the last frame.
    list_h: f32,
    dialog: Option<BranchDialog>,
}

enum BranchDialog {
    New { from: Option<String>, name: String, checkout: bool },
    Rename { old: String, name: String },
    Delete { name: String, remote: bool, force: bool, upstream: Option<String>, delete_upstream: bool },
}

#[derive(Clone)]
enum Action {
    Checkout(String),
    NewFrom(Option<String>),
    Merge(String),
    Rebase(String),
    Rename(String),
    Delete(String, bool),
    Update,
    Push,
    Fetch,
    Stash,
    Unstash,
}

impl BranchesUi {
    pub fn is_open(&self) -> bool {
        self.open
    }
}

pub fn open_popup(state: &mut AppState, anchor: egui::Pos2) {
    let b = &mut state.git_ui.branches;
    if b.open {
        b.open = false;
        return;
    }
    b.open = true;
    b.anchor = anchor + vec2(0.0, 2.0);
    b.query.clear();
    b.focus_search = true;
    b.expanded = None;
    b.rects.clear();
    reload(state);
}

fn reload(state: &mut AppState) {
    let Some(repo) = state.git.repo.clone() else { return };
    state.git_ui.branches.loading = true;
    state.jobs.spawn_quiet(
        move || repo.branches(),
        |state, res| {
            let b = &mut state.git_ui.branches;
            b.loading = false;
            match res {
                Ok(d) => b.data = Some(d),
                Err(e) => state.notifications.error("Cannot list branches", e.to_string()),
            }
        },
    );
}

pub fn show_windows(state: &mut AppState, ctx: &Context) {
    dialogs(state, ctx);
    if !state.git_ui.branches.open {
        return;
    }
    let mut action: Option<Action> = None;
    let mut new_rects = Vec::new();
    let b = &mut state.git_ui.branches;
    let current = b.data.as_ref().and_then(|d| d.current.clone());
    let area = Area::new(Id::new("git-branches-popup")).order(Order::Foreground).fixed_pos(b.anchor).show(ctx, |ui| {
        Frame::popup(ui.style()).show(ui, |ui| {
            ui.set_width(POPUP_W);
            let r = ui.add(TextEdit::singleline(&mut b.query).hint_text("Search for branches and actions").desired_width(f32::INFINITY));
            if b.focus_search {
                b.focus_search = false;
                r.request_focus();
            }
            if r.changed() {
                b.expanded = None;
            }
            let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
            ui.add_space(4.0);
            let q = b.query.trim().to_lowercase();
            // An Area only offers last frame's size to its content, so a list that grows (the
            // branches arrive after "Loading...", or the search is cleared) would stay clipped.
            // Asking for last frame's content height makes the popup grow in one frame.
            let list_h = b.list_h.min(480.0);
            let out = ScrollArea::vertical().max_height(480.0).min_scrolled_height(list_h).auto_shrink([false, true]).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 0.0;
                let actions: [(&str, Action); 6] = [
                    ("+ New Branch...", Action::NewFrom(None)),
                    ("Update Project...", Action::Update),
                    ("Push...", Action::Push),
                    ("Fetch", Action::Fetch),
                    ("Stash Changes...", Action::Stash),
                    ("Unstash Changes...", Action::Unstash),
                ];
                for (label, a) in actions {
                    if !q.is_empty() && !label.to_lowercase().contains(&q) {
                        continue;
                    }
                    if action_row(ui, label).clicked() {
                        action = Some(a);
                    }
                }
                let Some(data) = &b.data else {
                    ui.add_space(4.0);
                    ui.label(RichText::new("Loading...").color(theme::T.text_dim));
                    return;
                };
                let matches = |name: &str| q.is_empty() || name.to_lowercase().contains(&q);
                let recent: Vec<&BranchInfo> = data.recent.iter().filter_map(|n| data.local.iter().find(|x| &x.name == n)).filter(|x| matches(&x.name)).collect();
                let local: Vec<&BranchInfo> = data.local.iter().filter(|x| matches(&x.name)).collect();
                let remote: Vec<&BranchInfo> = data.remote.iter().filter(|x| matches(&x.name)).collect();
                if enter {
                    if let Some(first) = local.iter().chain(&remote).find(|x| !x.is_current) {
                        action = Some(Action::Checkout(first.name.clone()));
                    }
                }
                let mut hovered: Option<(String, u8, f32)> = None;
                for (group, (title, list)) in [("Recent", &recent), ("Local", &local), ("Remote", &remote)].into_iter().enumerate() {
                    let group = group as u8;
                    if list.is_empty() {
                        continue;
                    }
                    ui.add_space(4.0);
                    ui.separator();
                    ui.label(RichText::new(title).small().color(theme::T.text_dim));
                    for info in list.iter() {
                        let expanded = b.expanded.as_ref().is_some_and(|(n, g, _)| n == &info.name && *g == group);
                        let resp = branch_row(ui, info, expanded, title);
                        if resp.hovered() || resp.clicked() {
                            hovered = Some((info.name.clone(), group, resp.rect.top()));
                        }
                    }
                }
                if q.is_empty() && data.local.is_empty() && data.remote.is_empty() {
                    ui.label(RichText::new("No branches yet.").color(theme::T.text_dim));
                }
                if let Some(h) = hovered {
                    b.expanded = Some(h);
                }
            });
            b.list_h = out.content_size.y;
        });
    });
    new_rects.push(area.response.rect);

    // The submenu sits to the right of the hovered row, like IDEA's.
    if let (Some((name, group, y)), Some(data)) = (b.expanded.clone(), b.data.as_ref()) {
        let remote = group == 2;
        let info = if remote { data.remote.iter().find(|x| x.name == name) } else { data.local.iter().find(|x| x.name == name) };
        if let Some(info) = info {
            let pos = pos2(area.response.rect.right() + 2.0, y - 6.0);
            let sub = Area::new(Id::new("git-branches-submenu")).order(Order::Foreground).fixed_pos(pos).show(ctx, |ui| {
                Frame::popup(ui.style()).show(ui, |ui| {
                    ui.set_min_width(240.0);
                    ui.spacing_mut().item_spacing.y = 0.0;
                    let cur = current.clone().unwrap_or_else(|| "HEAD".into());
                    let is_current = info.is_current;
                    if !is_current && action_row(ui, "Checkout").clicked() {
                        action = Some(Action::Checkout(name.clone()));
                    }
                    if action_row(ui, &format!("New Branch from '{name}'...")).clicked() {
                        action = Some(Action::NewFrom(Some(name.clone())));
                    }
                    if !is_current {
                        ui.separator();
                        if action_row(ui, &format!("Merge '{name}' into '{cur}'")).clicked() {
                            action = Some(Action::Merge(name.clone()));
                        }
                        if action_row(ui, &format!("Rebase '{cur}' onto '{name}'")).clicked() {
                            action = Some(Action::Rebase(name.clone()));
                        }
                    }
                    if is_current {
                        ui.separator();
                        if action_row(ui, "Update").clicked() {
                            action = Some(Action::Update);
                        }
                        if action_row(ui, "Push...").clicked() {
                            action = Some(Action::Push);
                        }
                    }
                    ui.separator();
                    if !remote && action_row(ui, "Rename...").clicked() {
                        action = Some(Action::Rename(name.clone()));
                    }
                    if !is_current && action_row(ui, "Delete").clicked() {
                        action = Some(Action::Delete(name.clone(), remote));
                    }
                });
            });
            new_rects.push(sub.response.rect);
        }
    }

    let (escape, clicked_at) = ctx.input(|i| (i.key_pressed(Key::Escape), if i.pointer.any_pressed() { i.pointer.interact_pos() } else { None }));
    let b = &mut state.git_ui.branches;
    // Rects of the previous frame avoid closing on the click that opened the popup.
    let outside = clicked_at.is_some_and(|p| !b.rects.is_empty() && !b.rects.iter().chain(&new_rects).any(|r| r.contains(p)));
    b.rects = new_rects;
    if escape || outside {
        b.open = false;
    }
    if let Some(a) = action {
        state.git_ui.branches.open = false;
        run_action(state, a);
    }
}

fn action_row(ui: &mut Ui, label: &str) -> egui::Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::click());
    crate::util::label_widget(&resp, egui::WidgetType::Button, label);
    if resp.hovered() {
        ui.painter().rect_filled(rect, 3.0, theme::T.selection);
    }
    ui.painter().text(rect.left_center() + vec2(8.0, 0.0), Align2::LEFT_CENTER, label, theme::T.ui_font(), theme::T.text_bright);
    resp
}

fn branch_row(ui: &mut Ui, info: &BranchInfo, expanded: bool, group: &str) -> egui::Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::click());
    crate::util::label_selectable(&resp, format!("{group} branch {}", info.name), expanded);
    let p = ui.painter();
    if expanded || resp.hovered() {
        p.rect_filled(rect, 3.0, if expanded { theme::T.selection } else { theme::T.hover });
    }
    let cy = rect.center().y;
    if info.is_current {
        // A small tag marks the current branch, like IDEA's star/label icon.
        p.circle_filled(pos2(rect.left() + 10.0, cy), 3.5, theme::T.match_text);
    }
    let color = if info.is_current { theme::T.match_text } else { theme::T.text_bright };
    p.text(pos2(rect.left() + 20.0, cy), Align2::LEFT_CENTER, &info.name, theme::T.ui_font(), color);
    crate::icons::paint(p, Rect::from_center_size(pos2(rect.right() - 10.0, cy), vec2(11.0, 11.0)), crate::icons::Icon::ChevronRight, theme::T.text_dim);
    // Arrows are drawn as shapes: the default fonts have no arrow glyphs.
    let mut x = rect.right() - 22.0;
    for (count, up, color) in [(info.behind, false, theme::T.git_modified), (info.ahead, true, theme::T.git_added)] {
        if count == 0 {
            continue;
        }
        let r = p.text(pos2(x, cy), Align2::RIGHT_CENTER, count.to_string(), theme::T.small_font(), color);
        arrow(p, pos2(r.left() - 5.0, cy), up, color);
        x = r.left() - 16.0;
    }
    let tip = match (&info.upstream, info.ahead, info.behind) {
        (Some(up), 0, 0) => format!("Tracks {up}; up to date"),
        (Some(up), a, b) => format!("Tracks {up}; {a} to push, {b} to pull"),
        (None, ..) => info.name.clone(),
    };
    resp.on_hover_text(tip)
}

/// A small vertical arrow centered at `c`: up = commits to push, down = commits to pull.
pub(crate) fn arrow(p: &egui::Painter, c: Pos2, up: bool, color: egui::Color32) {
    let s = if up { -1.0 } else { 1.0 };
    let stroke = egui::Stroke::new(1.4_f32, color);
    p.line_segment([pos2(c.x, c.y - 5.0 * s), pos2(c.x, c.y + 5.0 * s)], stroke);
    p.line_segment([pos2(c.x - 3.5, c.y + 1.5 * s), pos2(c.x, c.y + 5.0 * s)], stroke);
    p.line_segment([pos2(c.x + 3.5, c.y + 1.5 * s), pos2(c.x, c.y + 5.0 * s)], stroke);
}

fn run_action(state: &mut AppState, a: Action) {
    let current = state.git.branch.clone().unwrap_or_else(|| "HEAD".into());
    match a {
        Action::Checkout(name) => {
            let body = format!("Checked out {name}");
            run_op(state, "Checkout", body, false, move |r| r.checkout(&name).map(|_| None), |_, _| {});
        }
        Action::NewFrom(from) => state.git_ui.branches.dialog = Some(BranchDialog::New { from, name: String::new(), checkout: true }),
        Action::Merge(name) => {
            let title = format!("Merge {name} into {current}");
            run_op(state, title, "Merged", true, move |r| r.merge(&name).map(Some), |_, _| {});
        }
        Action::Rebase(name) => {
            let title = format!("Rebase {current} onto {name}");
            run_op(state, title, "Rebased", true, move |r| r.rebase(&name).map(Some), |_, _| {});
        }
        Action::Rename(old) => state.git_ui.branches.dialog = Some(BranchDialog::Rename { name: old.clone(), old }),
        Action::Delete(name, remote) => {
            let upstream = if remote { None } else { state.git_ui.branches.data.as_ref().and_then(|d| d.local.iter().find(|x| x.name == name)).and_then(|x| x.upstream.clone()) };
            state.git_ui.branches.dialog = Some(BranchDialog::Delete { name, remote, force: false, upstream, delete_upstream: false });
        }
        Action::Update => super::remote::open_update_dialog(state),
        Action::Push => super::remote::open_push_dialog(state),
        Action::Fetch => run_op(state, "Fetch", "Fetched all remotes", false, |r| r.fetch().map(Some), |_, _| {}),
        Action::Stash => super::remote::open_stash_dialog(state),
        Action::Unstash => super::remote::open_unstash_dialog(state),
    }
}

fn dialogs(state: &mut AppState, ctx: &Context) {
    let Some(dialog) = state.git_ui.branches.dialog.as_mut() else { return };
    let mut close = false;
    let mut submit: super::remote::Deferred = None;
    match dialog {
        BranchDialog::New { from, name, checkout } => {
            let m = Modal::new(Id::new("git-new-branch")).show(ctx, |ui| {
                ui.set_width(400.0);
                let title = match from {
                    Some(f) => format!("Create New Branch from {f}"),
                    None => "Create New Branch".to_string(),
                };
                ui.label(RichText::new(title).strong().color(theme::T.text_bright));
                ui.add_space(6.0);
                let r = ui.add(TextEdit::singleline(name).hint_text("New branch name").desired_width(f32::INFINITY));
                // Re-grabbing the focus on the frame Enter released it would hide that Enter.
                if !r.lost_focus() {
                    r.request_focus();
                }
                ui.checkbox(checkout, "Checkout branch");
                let valid = valid_name(name);
                let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    if ui.add_enabled(valid, egui::Button::new("Create")).clicked() || (enter && valid) {
                        let n = name.trim().to_string();
                        let f = from.clone();
                        let co = *checkout;
                        submit = Some(Box::new(move |state| {
                            let body = if co { format!("Created and checked out {n}") } else { format!("Created {n}") };
                            run_op(state, "New Branch", body, false, move |r| r.create_branch(&n, f.as_deref(), co).map(|_| None), |_, _| {});
                        }));
                    }
                    if ui.button("Cancel").clicked() {
                        close = true;
                    }
                });
            });
            close |= m.should_close();
        }
        BranchDialog::Rename { old, name } => {
            let m = Modal::new(Id::new("git-rename-branch")).show(ctx, |ui| {
                ui.set_width(400.0);
                ui.label(RichText::new(format!("Rename {old}")).strong().color(theme::T.text_bright));
                ui.add_space(6.0);
                let r = ui.add(TextEdit::singleline(name).desired_width(f32::INFINITY));
                // Re-grabbing the focus on the frame Enter released it would hide that Enter.
                if !r.lost_focus() {
                    r.request_focus();
                }
                let valid = valid_name(name) && name.trim() != old.as_str();
                let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    if ui.add_enabled(valid, egui::Button::new("Rename")).clicked() || (enter && valid) {
                        let (o, n) = (old.clone(), name.trim().to_string());
                        submit = Some(Box::new(move |state| {
                            let body = format!("Renamed {o} to {n}");
                            run_op(state, "Rename Branch", body, false, move |r| r.rename_branch(&o, &n).map(|_| None), |_, _| {});
                        }));
                    }
                    if ui.button("Cancel").clicked() {
                        close = true;
                    }
                });
            });
            close |= m.should_close();
        }
        BranchDialog::Delete { name, remote, force, upstream, delete_upstream } => {
            let m = Modal::new(Id::new("git-delete-branch")).show(ctx, |ui| {
                ui.set_width(420.0);
                let what = if *remote { "remote branch" } else { "branch" };
                ui.label(RichText::new(format!("Delete {what} {name}?")).strong().color(theme::T.text_bright));
                ui.add_space(6.0);
                if *remote {
                    ui.label(RichText::new("The branch is deleted on the remote server (git push --delete).").color(theme::T.warning));
                } else {
                    ui.checkbox(force, "Force delete, even if it is not fully merged");
                    if let Some(up) = upstream {
                        ui.checkbox(delete_upstream, format!("Also delete the tracked remote branch {up}"));
                    }
                }
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    if ui.button("Delete").clicked() {
                        let (n, r, f) = (name.clone(), *remote, *force);
                        let up = if *delete_upstream { upstream.clone() } else { None };
                        submit = Some(Box::new(move |state| {
                            if r {
                                let body = format!("Deleted remote branch {n}");
                                run_op(state, "Delete Remote Branch", body, false, move |repo| repo.delete_remote_branch(&n).map(Some), |_, _| {});
                            } else {
                                let body = format!("Deleted branch {n}");
                                run_op(state, "Delete Branch", body, false, move |repo| repo.delete_branch(&n, f).map(|_| None), move |state, ok| {
                                    if let (true, Some(up)) = (ok, up) {
                                        let body = format!("Deleted remote branch {up}");
                                        run_op(state, "Delete Remote Branch", body, false, move |repo| repo.delete_remote_branch(&up).map(Some), |_, _| {});
                                    }
                                });
                            }
                        }));
                    }
                    if ui.button("Cancel").clicked() {
                        close = true;
                    }
                });
            });
            close |= m.should_close();
        }
    }
    if let Some(f) = submit {
        state.git_ui.branches.dialog = None;
        f(state);
    } else if close {
        state.git_ui.branches.dialog = None;
    }
}

/// The checks git's check-ref-format would fail on most often; git reports the rest.
fn valid_name(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty() && !n.contains(char::is_whitespace) && !n.contains("..") && !n.starts_with('-') && !n.ends_with('/') && !n.ends_with(".lock")
}

/// Test hook: opens the submenu of a branch (local first, then remote).
pub(crate) fn test_expand(state: &mut AppState, name: &str) {
    let b = &mut state.git_ui.branches;
    let remote = b.data.as_ref().is_some_and(|d| !d.local.iter().any(|x| x.name == name));
    let y = b.anchor.y + 200.0;
    b.expanded = Some((name.to_string(), if remote { 2 } else { 1 }, y));
}

/// Test hook: runs a branch action as if picked from the submenu.
pub(crate) fn test_action(state: &mut AppState, what: &str, name: &str) {
    let n = name.to_string();
    let a = match what {
        "checkout" => Action::Checkout(n),
        "merge" => Action::Merge(n),
        _ => Action::Rebase(n),
    };
    run_action(state, a);
}
