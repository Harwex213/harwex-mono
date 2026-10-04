//! The project selector: a press on the project widget in the title bar opens this popup, like
//! IDEA's. It lists Open... (the folder picker), the projects open in this window (switch,
//! close) and the Recent Projects (open, remove from the list).
//!
//! The popup is window-level: one per window, drawn over every workspace, with plain `Id::new`
//! ids. Rows act on the press (`pressed`), like the other popups of the app. The Recent list is
//! app storage (`persist.rs`, key `recent_projects`), newest first; it also holds the open
//! projects, which the popup hides.

use std::path::{Path, PathBuf};

use egui::{pos2, vec2, Align2, Context, Id, Key, Modifiers, Rect, Response, Sense, Ui};

use crate::icons::{self, Icon};
use crate::state::AppState;
use crate::theme;
use crate::workspace::WorkspaceId;

/// Entries kept in storage. The popup shows at most `MAX_SHOWN` of the ones not open now.
const MAX_STORED: usize = 30;
const MAX_SHOWN: usize = 10;

const ACTION_H: f32 = 26.0;
const HEADER_H: f32 = 26.0;
const PROJECT_H: f32 = 48.0;
const SEPARATOR_H: f32 = 11.0;
const PAD: f32 = 6.0;
const BADGE: f32 = 20.0;
const CROSS_W: f32 = 28.0;

#[derive(Default)]
struct Keys {
    escape: bool,
    up: bool,
    down: bool,
    enter: bool,
}

/// The popup's state and the Recent Projects list. Lives in `AppState::projects`.
#[derive(Default)]
pub struct ProjectsUi {
    pub open: bool,
    /// Canonical roots, newest first. Open projects stay in the list.
    pub recent: Vec<PathBuf>,
    /// The keyboard row (an index into this frame's items).
    selected: usize,
    /// The project widget's rect, drawn this frame. The popup hangs below it.
    widget: Option<Rect>,
    keys: Keys,
    /// `$HOME`, read once, for the `~` paths.
    home: Option<Option<PathBuf>>,
}

impl ProjectsUi {
    /// `root` was opened or activated: it moves to the front of the Recent list.
    pub fn note_opened(&mut self, root: &Path) {
        if self.recent.first().is_some_and(|r| r == root) {
            return;
        }
        self.recent.retain(|r| r != root);
        self.recent.insert(0, root.to_path_buf());
        self.recent.truncate(MAX_STORED);
    }

    /// Drops `root` from the Recent list (the cross on a Recent row).
    pub fn remove_recent(&mut self, root: &Path) {
        self.recent.retain(|r| r != root);
    }

    /// The Recent rows: the entries that are not open in this window, newest first.
    pub fn recent_shown(&self, open: &[PathBuf]) -> Vec<PathBuf> {
        self.recent.iter().filter(|r| !open.contains(r)).take(MAX_SHOWN).cloned().collect()
    }

    fn tilde(&mut self, path: &Path) -> String {
        let home = self.home.get_or_insert_with(|| std::env::var_os("HOME").map(PathBuf::from).filter(|h| h.is_absolute()));
        match home.as_ref().and_then(|h| path.strip_prefix(h).ok()) {
            Some(rest) if rest.as_os_str().is_empty() => "~".into(),
            Some(rest) => format!("~/{}", rest.display()),
            None => path.display().to_string(),
        }
    }
}

/// A row of the popup that can be selected.
#[derive(Clone, Debug, PartialEq)]
enum Item {
    OpenFolder,
    Project { id: WorkspaceId, name: String, root: PathBuf, active: bool },
    Recent { name: String, root: PathBuf },
}

enum Action {
    OpenFolder,
    Activate(WorkspaceId),
    Close(WorkspaceId),
    OpenRecent(PathBuf),
    Remove(PathBuf),
}

/// The press on a widget this frame. Rows act on the press, not on the release.
fn pressed(ui: &Ui, resp: &Response) -> bool {
    resp.is_pointer_button_down_on() && ui.input(|i| i.pointer.primary_pressed())
}

/// Called by the title bar with the project widget's response: a press toggles the popup.
pub fn on_widget(s: &mut AppState, ui: &Ui, resp: &Response) {
    s.projects.widget = Some(resp.rect);
    if pressed(ui, resp) {
        if s.projects.open {
            s.projects.open = false;
        } else {
            s.projects.open = true;
            s.projects.selected = 0;
        }
    }
}

/// Takes the popup's keys at the start of the frame, before the editor or a terminal sees them.
pub fn take_keys(s: &mut AppState, ctx: &Context) {
    if !s.projects.open {
        return;
    }
    let none = Modifiers::NONE;
    s.projects.keys = ctx.input_mut(|i| Keys {
        escape: i.consume_key(none, Key::Escape),
        up: i.consume_key(none, Key::ArrowUp),
        down: i.consume_key(none, Key::ArrowDown),
        enter: i.consume_key(none, Key::Enter),
    });
}

fn name_of(root: &Path) -> String {
    root.file_name().map_or_else(|| root.display().to_string(), |n| n.to_string_lossy().into_owned())
}

fn items(s: &AppState) -> Vec<Item> {
    let mut out = vec![Item::OpenFolder];
    let open = s.workspaces();
    let roots: Vec<PathBuf> = open.iter().filter_map(|w| w.root.clone()).collect();
    out.extend(open.into_iter().filter_map(|w| Some(Item::Project { id: w.id, name: w.name, root: w.root?, active: w.is_active })));
    out.extend(s.projects.recent_shown(&roots).into_iter().map(|root| Item::Recent { name: name_of(&root), root }));
    out
}

fn item_h(item: &Item) -> f32 {
    match item {
        Item::OpenFolder => ACTION_H,
        _ => PROJECT_H,
    }
}

/// Each frame: keeps the Recent list in step with the active project, then draws the popup
/// when it is open. Call after the panels, with the other popups.
pub fn show(s: &mut AppState, ctx: &Context) {
    if let Some(root) = s.workspace(s.active_id()).and_then(|w| w.project.as_ref()).map(|p| p.root.clone()) {
        if s.projects.recent.first() != Some(&root) {
            s.projects.note_opened(&root);
        }
    }
    let keys = std::mem::take(&mut s.projects.keys);
    if !s.projects.open {
        return;
    }
    let Some(widget) = s.projects.widget else {
        s.projects.open = false;
        return;
    };
    let items = items(s);
    let len = items.len();
    let mut sel = s.projects.selected.min(len - 1);
    if keys.up {
        sel = (sel + len - 1) % len;
    }
    if keys.down {
        sel = (sel + 1) % len;
    }
    let mut actions = Vec::new();
    if keys.enter {
        actions.push(match &items[sel] {
            Item::OpenFolder => Action::OpenFolder,
            Item::Project { id, .. } => Action::Activate(*id),
            Item::Recent { root, .. } => Action::OpenRecent(root.clone()),
        });
    }

    let t = &theme::T;
    let header_font = t.semibold(t.font.small);
    let name_font = t.ui_font();
    let path_font = t.small_font();
    let paths: Vec<String> = items
        .iter()
        .map(|i| match i {
            Item::Project { root, .. } | Item::Recent { root, .. } => s.projects.tilde(root),
            Item::OpenFolder => String::new(),
        })
        .collect();
    let text_w = ctx.fonts(|f| {
        items
            .iter()
            .zip(&paths)
            .map(|(i, p)| match i {
                Item::Project { name, .. } | Item::Recent { name, .. } => f.layout_no_wrap(name.clone(), name_font.clone(), t.text).size().x.max(f.layout_no_wrap(p.clone(), path_font.clone(), t.text).size().x),
                Item::OpenFolder => 0.0,
            })
            .fold(0.0_f32, f32::max)
    });
    let width = (PAD + 8.0 + BADGE + 10.0 + text_w + CROSS_W + PAD).clamp(320.0, 560.0);
    let n_open = items.iter().filter(|i| matches!(i, Item::Project { .. })).count();
    let n_recent = items.iter().filter(|i| matches!(i, Item::Recent { .. })).count();
    let section_h = |n: usize| if n == 0 { 0.0 } else { SEPARATOR_H + HEADER_H + n as f32 * PROJECT_H };
    let height = ACTION_H + section_h(n_open) + section_h(n_recent);

    let frame = egui::Frame::popup(&ctx.style())
        .fill(t.popup_bg)
        .stroke(egui::Stroke::new(1.0_f32, t.popup_border))
        .corner_radius(egui::CornerRadius::same(t.radius.popup as u8))
        .inner_margin(egui::Margin::same(PAD as i8))
        .shadow(t.popup_shadow());
    let margin = frame.total_margin().sum();
    let screen = ctx.screen_rect();
    let x = (widget.min.x - 4.0).min(screen.max.x - width - margin.x).max(screen.min.x);
    let pos = pos2(x, widget.max.y + 4.0);
    let pointer_moved = ctx.input(|i| i.pointer.delta() != egui::Vec2::ZERO);

    let area = egui::Area::new(Id::new("projects-popup")).order(egui::Order::Foreground).fixed_pos(pos).constrain(false).show(ctx, |ui| {
        frame.show(ui, |ui| {
            // An explicit size: an Area otherwise offers its content last frame's size.
            ui.set_width(width);
            ui.set_height(height);
            let mut y = ui.min_rect().min.y;
            let left = ui.min_rect().min.x;
            let mut section = 0;
            for (i, item) in items.iter().enumerate() {
                let kind = match item {
                    Item::OpenFolder => 0,
                    Item::Project { .. } => 1,
                    Item::Recent { .. } => 2,
                };
                if kind != section {
                    section = kind;
                    let line_y = y + (SEPARATOR_H / 2.0).floor() + 0.5;
                    ui.painter().hline(left + 4.0..=left + width - 4.0, line_y, egui::Stroke::new(1.0_f32, t.popup_border));
                    y += SEPARATOR_H;
                    let title = if kind == 1 { "Open Projects" } else { "Recent Projects" };
                    ui.painter().text(pos2(left + 10.0, y + HEADER_H / 2.0), Align2::LEFT_CENTER, title, header_font.clone(), t.text_dim);
                    y += HEADER_H;
                }
                let rect = Rect::from_min_size(pos2(left, y), vec2(width, item_h(item)));
                y += rect.height();
                let resp = ui.interact(rect, Id::new(("projects-popup-row", i, item_key(item))), Sense::click());
                let label = match item {
                    Item::OpenFolder => "Open...".to_string(),
                    Item::Project { name, .. } => format!("Open project {name}"),
                    Item::Recent { name, .. } => format!("Recent project {name}"),
                };
                crate::util::label_selectable(&resp, label, i == sel);
                if resp.hovered() && pointer_moved {
                    sel = i;
                }
                let cross = Rect::from_min_max(pos2(rect.max.x - CROSS_W, rect.min.y), rect.max);
                // The cross is no click widget of its own: the row decides by the pointer x.
                // It still gets an a11y node, so tests and screen readers find it.
                let cross_label = match item {
                    Item::OpenFolder => None,
                    Item::Project { name, .. } => Some(format!("Close project {name}")),
                    Item::Recent { name, .. } => Some(format!("Remove recent project {name}")),
                };
                if let Some(l) = &cross_label {
                    let c = ui.interact(cross, Id::new(("projects-popup-cross", i, item_key(item))), Sense::hover());
                    crate::util::label_widget(&c, egui::WidgetType::Button, l.clone());
                }
                let on_cross = cross_label.is_some() && ui.input(|inp| inp.pointer.interact_pos()).is_some_and(|p| cross.contains(p));
                if pressed(ui, &resp) {
                    actions.push(match (item, on_cross) {
                        (Item::OpenFolder, _) => Action::OpenFolder,
                        (Item::Project { id, .. }, true) => Action::Close(*id),
                        (Item::Project { id, .. }, false) => Action::Activate(*id),
                        (Item::Recent { root, .. }, true) => Action::Remove(root.clone()),
                        (Item::Recent { root, .. }, false) => Action::OpenRecent(root.clone()),
                    });
                }
                paint_row(ui, rect, item, &paths[i], i == sel, resp.hovered(), on_cross);
            }
        });
    });
    s.projects.selected = sel;
    let popup_rect = area.response.rect;
    let pressed_outside = ctx.input(|i| i.pointer.any_pressed() && i.pointer.interact_pos().is_some_and(|p| !popup_rect.contains(p) && !widget.contains(p)));
    if pressed_outside {
        s.projects.open = false;
    }
    if keys.escape {
        s.projects.open = false;
        if let Some(e) = s.ws.tabs.active_editor_mut() {
            e.view.request_focus();
        }
    }
    for a in actions {
        match a {
            Action::OpenFolder => {
                s.projects.open = false;
                s.pick_folder();
            }
            Action::Activate(id) => {
                s.projects.open = false;
                s.activate(id);
            }
            Action::OpenRecent(root) => {
                s.projects.open = false;
                s.open_workspace(root);
            }
            Action::Close(id) => {
                s.close_workspace(id);
                // Unsaved files: the prompt takes over.
                if s.confirm_close_ws.is_some() {
                    s.projects.open = false;
                }
            }
            Action::Remove(root) => s.projects.remove_recent(&root),
        }
    }
}

fn item_key(item: &Item) -> Option<&Path> {
    match item {
        Item::OpenFolder => None,
        Item::Project { root, .. } | Item::Recent { root, .. } => Some(root),
    }
}

fn paint_row(ui: &Ui, rect: Rect, item: &Item, path: &str, selected: bool, hovered: bool, on_cross: bool) {
    let t = &theme::T;
    let painter = ui.painter().with_clip_rect(rect);
    if selected {
        painter.rect_filled(rect, t.radius.row, t.selection);
    }
    let text_color = if selected { t.text_bright } else { t.text };
    match item {
        Item::OpenFolder => {
            icons::paint(&painter, Rect::from_center_size(pos2(rect.min.x + 8.0 + 8.0, rect.center().y), vec2(16.0, 16.0)), Icon::Project, t.icon);
            painter.text(pos2(rect.min.x + 8.0 + 16.0 + 8.0, rect.center().y), Align2::LEFT_CENTER, "Open...", t.ui_font(), text_color);
        }
        Item::Project { name, .. } | Item::Recent { name, .. } => {
            let active = matches!(item, Item::Project { active: true, .. });
            let badge = Rect::from_min_size(pos2(rect.min.x + 8.0, rect.min.y + 7.0), vec2(BADGE, BADGE));
            painter.rect_filled(badge, t.radius.badge, t.badge_color(name));
            painter.text(badge.center(), Align2::CENTER_CENTER, crate::app::initials(name), t.semibold(t.font.badge), t.badge_text);
            let x = badge.max.x + 10.0;
            let name_font = if active { t.semibold(t.font.ui) } else { t.ui_font() };
            painter.text(pos2(x, badge.center().y), Align2::LEFT_CENTER, name, name_font, text_color);
            painter.text(pos2(x, rect.min.y + 36.0), Align2::LEFT_CENTER, path, t.small_font(), t.text_dim);
            let cross = Rect::from_center_size(pos2(rect.max.x - CROSS_W / 2.0, badge.center().y), vec2(14.0, 14.0));
            if hovered {
                if on_cross {
                    painter.rect_filled(cross.expand(3.0), t.radius.small, t.button_hover);
                }
                icons::paint(&painter, cross, Icon::Close, if on_cross { t.icon_active } else { t.icon });
            } else if active {
                icons::paint(&painter, cross, Icon::Check, t.text_dim);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_moves_to_front_and_hides_open_projects() {
        let mut p = ProjectsUi::default();
        for r in ["/a", "/b", "/c"] {
            p.note_opened(Path::new(r));
        }
        p.note_opened(Path::new("/a"));
        assert_eq!(p.recent, vec![PathBuf::from("/a"), PathBuf::from("/c"), PathBuf::from("/b")]);
        assert_eq!(p.recent_shown(&[PathBuf::from("/a")]), vec![PathBuf::from("/c"), PathBuf::from("/b")]);
        p.remove_recent(Path::new("/c"));
        assert_eq!(p.recent_shown(&[]), vec![PathBuf::from("/a"), PathBuf::from("/b")]);
        for i in 0..40 {
            p.note_opened(&PathBuf::from(format!("/x{i}")));
        }
        assert_eq!(p.recent.len(), MAX_STORED);
        assert_eq!(p.recent_shown(&[]).len(), MAX_SHOWN);
    }

    #[test]
    fn home_paths_are_shortened() {
        let mut p = ProjectsUi { home: Some(Some(PathBuf::from("/home-dir/me"))), ..Default::default() };
        assert_eq!(p.tilde(Path::new("/home-dir/me/Projects/x")), "~/Projects/x");
        assert_eq!(p.tilde(Path::new("/home-dir/me")), "~");
        assert_eq!(p.tilde(Path::new("/opt/x")), "/opt/x");
    }
}
