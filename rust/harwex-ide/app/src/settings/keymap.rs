//! Settings › Keymap: the actions and their keys, read-only, with a filter. The list mirrors
//! the shortcuts in `app::shortcuts`, the tree, the editor and the Git UI; a new shortcut gets a
//! row here.
//!
//! Each group is a card (IDEA's groups): a header with a chevron and the action count, which
//! collapses the group, and the rows with their keys drawn as key caps. A filter shows only the
//! matching rows, keeps them in their groups, hides empty groups and opens collapsed ones.

use egui::{RichText, Sense, TextEdit, Ui};

use crate::theme;

/// The groups in their order.
pub const GROUPS: &[&str] = &["General", "Search", "Navigation", "Editing", "Tool Windows", "Tabs", "Project Tree", "Git", "Terminal"];

/// (group, action, keys). Keys: modifiers first (⌃⌥⇧⌘), alternatives split by " or ", pairs
/// by " / "; a word with a space ("click on ×") is drawn as text, not as a cap.
pub const ACTIONS: &[(&str, &str, &str)] = &[
    ("General", "Settings", "⌘,"),
    ("General", "Save", "⌘S"),
    ("General", "Save All", "⌥⌘S"),
    ("General", "Move Project Up / Down (project selector)", "⌥⇧↑ / ⌥⇧↓"),
    ("Search", "Search Everywhere (files)", "⇧⇧ or ⇧⌘O"),
    ("Search", "Find in Files", "⇧⌘F"),
    ("Search", "Replace in Files", "⇧⌘R"),
    ("Search", "Find", "⌘F"),
    ("Search", "Replace", "⌘R"),
    ("Search", "Find Next", "⌘G"),
    ("Search", "Find Previous", "⇧⌘G"),
    ("Search", "Find Usages", "⌥F7"),
    ("Navigation", "Recent Files", "⌘E"),
    ("Navigation", "Go to Declaration", "⌘B or ⌘ click"),
    ("Navigation", "Go to Type Definition", "⇧⌘B"),
    ("Navigation", "Go to Implementation", "⌥⌘B"),
    ("Navigation", "Back", "⌘[ or ⌥⌘← or mouse button 4"),
    ("Navigation", "Forward", "⌘] or ⌥⌘→ or mouse button 5"),
    ("Navigation", "Next Problem", "F2"),
    ("Navigation", "Previous Problem", "⇧F2"),
    ("Navigation", "Select in Project View", "⌥F1"),
    ("Navigation", "Breadcrumbs", "⌥Home"),
    ("Navigation", "Line Start / End", "⌘← / ⌘→"),
    ("Navigation", "File Start / End", "⌘↑ / ⌘↓"),
    ("Editing", "Undo", "⌘Z"),
    ("Editing", "Redo", "⇧⌘Z"),
    ("Editing", "Duplicate Line", "⌘D"),
    ("Editing", "Delete Line", "⌘⌫"),
    ("Editing", "Comment Line", "⌘/"),
    ("Editing", "Reformat File (oxfmt)", "⌥⌘L"),
    ("Editing", "Rename Symbol", "⇧F6"),
    ("Editing", "Select All Occurrences", "⌃⌘G"),
    ("Editing", "Add Caret at Next Occurrence", "⌃G"),
    ("Editing", "Add Caret", "⌥ click"),
    ("Tool Windows", "Project", "⌘1"),
    ("Tool Windows", "Problems", "⌘6"),
    ("Tool Windows", "Git", "⌘9"),
    ("Tool Windows", "Commit", "⌘0"),
    ("Tool Windows", "Terminal", "⌥F12"),
    ("Tool Windows", "Return to the Editor", "Esc"),
    ("Tool Windows", "Hide Active Tool Window", "⇧Esc"),
    ("Tool Windows", "Hide All Tool Windows", "⇧⌘F12"),
    ("Tabs", "Close Tab", "⌘W"),
    ("Tabs", "Reopen Closed Tab", "⇧⌘T"),
    ("Tabs", "Close Others", "⌥ click on ×"),
    ("Project Tree", "New File or Directory", "⌘."),
    ("Project Tree", "Cut / Copy / Paste", "⌘X / ⌘C / ⌘V"),
    ("Project Tree", "Copy Absolute Path", "⇧⌘C"),
    ("Project Tree", "Delete", "⌫ or ⌘⌫"),
    ("Git", "Commit", "⌘K"),
    ("Git", "Commit (from the message)", "⌘⏎"),
    ("Git", "Push", "⇧⌘K"),
    ("Git", "Branches", "⌃⇧`"),
    ("Git", "Jump to Source (diff)", "F4"),
    ("Terminal", "New Terminal", "⌘T"),
    ("Terminal", "Clear", "⌘K"),
    ("Terminal", "Open In Terminal", "⌘3"),
];

type Row = (&'static str, &'static str, &'static str);

/// The page's own state, per dialog.
#[derive(Default)]
pub struct KeymapView {
    pub filter: String,
    /// Groups the user folded. A filter shows them open.
    pub collapsed: Vec<&'static str>,
}

impl KeymapView {
    /// Whether `group` shows its rows now.
    pub fn is_open(&self, group: &str) -> bool {
        !self.filter.trim().is_empty() || !self.collapsed.contains(&group)
    }

    pub fn toggle(&mut self, group: &'static str) {
        match self.collapsed.iter().position(|g| *g == group) {
            Some(i) => {
                self.collapsed.remove(i);
            }
            None => self.collapsed.push(group),
        }
    }
}

/// The rows whose group, action or keys contain every word of `filter`, any case.
pub fn filter(filter: &str) -> Vec<&'static Row> {
    let words: Vec<String> = filter.split_whitespace().map(str::to_lowercase).collect();
    ACTIONS
        .iter()
        .filter(|(group, action, keys)| {
            let hay = format!("{group} {action} {keys}").to_lowercase();
            words.iter().all(|w| hay.contains(w.as_str()))
        })
        .collect()
}

/// The groups that have rows under `filter`, in order, with their rows.
pub fn grouped(filter_text: &str) -> Vec<(&'static str, Vec<&'static Row>)> {
    let rows = filter(filter_text);
    GROUPS.iter().map(|g| (*g, rows.iter().copied().filter(|r| r.0 == *g).collect::<Vec<_>>())).filter(|(_, rows)| !rows.is_empty()).collect()
}

/// One piece of a key text: a key cap or a word between caps ("or", "click").
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeyPart {
    Cap(String),
    Text(String),
}

const MODIFIERS: &str = "⌃⌥⇧⌘";

/// Splits a keys text into caps and words.
pub fn key_parts(keys: &str) -> Vec<KeyPart> {
    let mut out = Vec::new();
    for (i, alt) in keys.split(" or ").enumerate() {
        if i > 0 {
            out.push(KeyPart::Text("or".into()));
        }
        for (j, part) in alt.split(" / ").enumerate() {
            if j > 0 {
                out.push(KeyPart::Text("/".into()));
            }
            let mut rest = part;
            while let Some(c) = rest.chars().next().filter(|c| MODIFIERS.contains(*c)) {
                out.push(KeyPart::Cap(c.to_string()));
                rest = &rest[c.len_utf8()..];
            }
            let rest = rest.trim();
            if rest.is_empty() {
                continue;
            }
            if rest.contains(' ') || rest == "click" {
                out.push(KeyPart::Text(rest.into()));
            } else {
                out.push(KeyPart::Cap(rest.into()));
            }
        }
    }
    out
}

pub fn page(ui: &mut Ui, view: &mut KeymapView) {
    let t = &theme::T;
    // The keys are the same in every project.
    super::pages::section(ui, "Shortcuts", super::Scope::Global);
    ui.add_space(4.0);
    let edit = ui.add(TextEdit::singleline(&mut view.filter).hint_text("Filter actions or keys").desired_width(f32::INFINITY));
    crate::util::label_widget(&edit, egui::WidgetType::TextEdit, "Filter keymap");
    ui.add_space(6.0);
    let groups = grouped(&view.filter);
    if groups.is_empty() {
        ui.label(RichText::new("Nothing found").color(t.text_dim));
        return;
    }
    let filtering = !view.filter.trim().is_empty();
    egui::ScrollArea::vertical().id_salt("keymap-rows").auto_shrink([false, false]).min_scrolled_height(0.0).show(ui, |ui| {
        ui.set_width(ui.available_width() - 14.0);
        ui.spacing_mut().item_spacing.y = 0.0;
        for (group, rows) in groups {
            let open = view.is_open(group);
            let total = ACTIONS.iter().filter(|r| r.0 == group).count();
            let frame = egui::Frame::new().fill(t.card_bg).stroke(egui::Stroke::new(1.0_f32, t.card_border)).corner_radius(t.radius.popup).inner_margin(egui::Margin::symmetric(10, 4));
            frame.show(ui, |ui| {
                ui.set_width(ui.available_width());
                if header(ui, group, rows.len(), total, open, filtering) && !filtering {
                    view.toggle(group);
                }
                if open {
                    for (i, (_, action, keys)) in rows.iter().enumerate() {
                        if i > 0 {
                            let y = ui.cursor().top();
                            let x = ui.max_rect().x_range();
                            ui.painter().hline(x, y, egui::Stroke::new(1.0_f32, t.card_border));
                        }
                        row(ui, action, keys);
                    }
                }
            });
            ui.add_space(8.0);
        }
    });
}

/// The group header: chevron, name and count. Returns whether it was clicked. A11y:
/// `Keymap group <name>`, selected while open.
fn header(ui: &mut Ui, group: &str, shown: usize, total: usize, open: bool, filtering: bool) -> bool {
    let t = &theme::T;
    let h = 28.0;
    let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), h), Sense::click());
    let p = ui.painter();
    crate::icons::tree_chevron(p, egui::pos2(rect.left() + 6.0, rect.center().y), open, if filtering { t.text_dim } else { t.tree_chevron });
    let name = p.layout_no_wrap(group.to_string(), t.semibold(t.font.ui), t.text_bright);
    let name_w = name.size().x;
    p.galley(egui::pos2(rect.left() + 18.0, rect.center().y - name.size().y / 2.0), name, t.text_bright);
    let count = if shown == total { total.to_string() } else { format!("{shown} of {total}") };
    let galley = p.layout_no_wrap(count, t.small_font(), t.count_badge_text);
    let pill = egui::Rect::from_min_size(egui::pos2(rect.left() + 26.0 + name_w, rect.center().y - galley.size().y / 2.0 - 1.0), galley.size() + egui::vec2(10.0, 2.0));
    p.rect_filled(pill, t.radius.badge, t.scope_global_bg);
    p.galley(pill.center() - galley.size() / 2.0, galley, t.count_badge_text);
    crate::util::label_selectable(&resp, format!("Keymap group {group}"), open);
    resp.clicked()
}

/// One action: its name on the left, its keys as caps on the right.
fn row(ui: &mut Ui, action: &str, keys: &str) {
    let t = &theme::T;
    ui.horizontal(|ui| {
        ui.set_min_height(28.0);
        ui.set_min_width(ui.available_width());
        ui.label(action);
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 3.0;
            // Right to left: the last part goes first.
            for part in key_parts(keys).iter().rev() {
                match part {
                    KeyPart::Cap(k) => cap(ui, k),
                    KeyPart::Text(w) => {
                        ui.label(RichText::new(w.as_str()).color(t.text_dim).size(t.font.small));
                    }
                }
            }
        });
    });
}

/// A key cap: the key in a rounded box with a darker bottom edge.
fn cap(ui: &mut Ui, key: &str) {
    let t = &theme::T;
    let galley = ui.painter().layout_no_wrap(key.to_string(), t.small_font(), t.text);
    let w = (galley.size().x + 10.0).max(20.0);
    let (rect, _) = ui.allocate_exact_size(egui::vec2(w, 20.0), Sense::hover());
    let radius = t.radius.small;
    ui.painter().rect(rect, radius, t.keycap_bg, egui::Stroke::new(1.0_f32, t.keycap_border), egui::StrokeKind::Inside);
    ui.painter().hline(rect.x_range().shrink(radius), rect.bottom() - 0.5, egui::Stroke::new(1.0_f32, t.keycap_border));
    ui.painter().galley(rect.center() - galley.size() / 2.0, galley, t.text);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_matches_words_anywhere() {
        assert_eq!(filter("").len(), ACTIONS.len());
        let save: Vec<&str> = filter("save").iter().map(|r| r.1).collect();
        assert_eq!(save, ["Save", "Save All"]);
        let cmd_k: Vec<&str> = filter("⌘k git").iter().map(|r| r.1).collect();
        assert_eq!(cmd_k, ["Commit", "Push"]);
        assert!(filter("no such action").is_empty());
    }

    #[test]
    fn groups_keep_order_and_hide_empty_ones() {
        // Every row is in a known group, and the groups list in order.
        assert!(ACTIONS.iter().all(|r| GROUPS.contains(&r.0)), "a row names an unknown group");
        let all = grouped("");
        assert_eq!(all.iter().map(|g| g.0).collect::<Vec<_>>(), GROUPS);
        assert_eq!(all.iter().map(|g| g.1.len()).sum::<usize>(), ACTIONS.len());
        let find: Vec<(&str, usize)> = grouped("find").iter().map(|(g, rows)| (*g, rows.len())).collect();
        assert_eq!(find, [("Search", 5)]);
        let commit: Vec<&str> = grouped("commit").iter().map(|g| g.0).collect();
        assert_eq!(commit, ["Tool Windows", "Git"]);
    }

    #[test]
    fn collapsed_groups_open_while_filtering() {
        let mut v = KeymapView::default();
        v.toggle("Git");
        assert!(!v.is_open("Git") && v.is_open("Tabs"));
        v.filter = "push".into();
        assert!(v.is_open("Git"));
        v.filter.clear();
        v.toggle("Git");
        assert!(v.is_open("Git"));
    }

    #[test]
    fn keys_split_into_caps() {
        use KeyPart::{Cap, Text};
        let cap = |s: &str| Cap(s.into());
        assert_eq!(key_parts("⇧⌘F12"), [cap("⇧"), cap("⌘"), cap("F12")]);
        assert_eq!(key_parts("⇧⇧ or ⇧⌘O"), [cap("⇧"), cap("⇧"), Text("or".into()), cap("⇧"), cap("⌘"), cap("O")]);
        assert_eq!(key_parts("⌘B or ⌘ click"), [cap("⌘"), cap("B"), Text("or".into()), cap("⌘"), Text("click".into())]);
        assert_eq!(key_parts("⌥ click on ×"), [cap("⌥"), Text("click on ×".into())]);
        assert_eq!(key_parts("⌘X / ⌘C"), [cap("⌘"), cap("X"), Text("/".into()), cap("⌘"), cap("C")]);
        assert_eq!(key_parts("⌘[ or mouse button 4"), [cap("⌘"), cap("["), Text("or".into()), Text("mouse button 4".into())]);
        assert_eq!(key_parts("Esc"), [cap("Esc")]);
    }
}
