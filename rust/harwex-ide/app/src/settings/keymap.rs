//! Settings › Keymap: the actions and their keys, read-only, with a filter. The list mirrors
//! the shortcuts in `app::shortcuts`, the tree, the editor and the Git UI; a new shortcut gets a
//! row here.

use egui::{RichText, TextEdit, Ui};

use crate::theme;

/// (group, action, keys).
pub const ACTIONS: &[(&str, &str, &str)] = &[
    ("General", "Settings", "⌘,"),
    ("General", "Search Everywhere (files)", "⇧⇧ or ⇧⌘O"),
    ("General", "Recent Files", "⌘E"),
    ("General", "Find in Files", "⇧⌘F"),
    ("General", "Replace in Files", "⇧⌘R"),
    ("General", "Hide Active Tool Window", "⇧Esc"),
    ("General", "Hide All Tool Windows", "⇧⌘F12"),
    ("Tool Windows", "Project", "⌘1"),
    ("Tool Windows", "Problems", "⌘6"),
    ("Tool Windows", "Git", "⌘9"),
    ("Tool Windows", "Commit", "⌘0"),
    ("Tool Windows", "Terminal", "⌥F12"),
    ("Tool Windows", "Return to the Editor", "Esc"),
    ("Tabs", "Close Tab", "⌘W"),
    ("Tabs", "Reopen Closed Tab", "⇧⌘T"),
    ("Tabs", "Close Others", "⌥ click on ×"),
    ("Files", "Save", "⌘S"),
    ("Files", "Save All", "⌥⌘S"),
    ("Files", "Reformat File (oxfmt)", "⌥⌘L"),
    ("Navigation", "Go to Declaration", "⌘B or ⌘ click"),
    ("Navigation", "Go to Type Definition", "⇧⌘B"),
    ("Navigation", "Go to Implementation", "⌥⌘B"),
    ("Navigation", "Find Usages", "⌥F7"),
    ("Navigation", "Rename Symbol", "⇧F6"),
    ("Navigation", "Back", "⌘[ or ⌥⌘← or mouse button 4"),
    ("Navigation", "Forward", "⌘] or ⌥⌘→ or mouse button 5"),
    ("Navigation", "Next Problem", "F2"),
    ("Navigation", "Previous Problem", "⇧F2"),
    ("Navigation", "Select in Project View", "⌥F1"),
    ("Navigation", "Breadcrumbs", "⌥Home"),
    ("Editor", "Find", "⌘F"),
    ("Editor", "Replace", "⌘R"),
    ("Editor", "Find Next", "⌘G"),
    ("Editor", "Find Previous", "⇧⌘G"),
    ("Editor", "Select All Occurrences", "⌃⌘G"),
    ("Editor", "Add Caret at Next Occurrence", "⌃G"),
    ("Editor", "Add Caret", "⌥ click"),
    ("Editor", "Undo", "⌘Z"),
    ("Editor", "Redo", "⇧⌘Z"),
    ("Editor", "Duplicate Line", "⌘D"),
    ("Editor", "Delete Line", "⌘⌫"),
    ("Editor", "Comment Line", "⌘/"),
    ("Editor", "Line Start / End", "⌘← / ⌘→"),
    ("Editor", "File Start / End", "⌘↑ / ⌘↓"),
    ("Project Tree", "New File or Directory", "⌘."),
    ("Project Tree", "Cut / Copy / Paste", "⌘X / ⌘C / ⌘V"),
    ("Project Tree", "Copy Absolute Path", "⇧⌘C"),
    ("Project Tree", "Delete", "⌫ or ⌘⌫"),
    ("Project Tree", "Open In Terminal", "⌘3"),
    ("Git", "Commit", "⌘K"),
    ("Git", "Commit (from the message)", "⌘⏎"),
    ("Git", "Push", "⇧⌘K"),
    ("Git", "Branches", "⌃⇧`"),
    ("Git", "Jump to Source (diff)", "F4"),
    ("Terminal", "New Terminal", "⌘T"),
    ("Terminal", "Clear", "⌘K"),
];

/// The rows whose group, action or keys contain every word of `filter`, any case.
pub fn filter(filter: &str) -> Vec<&'static (&'static str, &'static str, &'static str)> {
    let words: Vec<String> = filter.split_whitespace().map(str::to_lowercase).collect();
    ACTIONS
        .iter()
        .filter(|(group, action, keys)| {
            let hay = format!("{group} {action} {keys}").to_lowercase();
            words.iter().all(|w| hay.contains(w.as_str()))
        })
        .collect()
}

pub fn page(ui: &mut Ui, text: &mut String) {
    let t = &theme::T;
    let edit = ui.add(TextEdit::singleline(text).hint_text("Filter actions or keys").desired_width(f32::INFINITY));
    crate::util::label_widget(&edit, egui::WidgetType::TextEdit, "Filter keymap");
    ui.add_space(6.0);
    let rows = filter(text);
    if rows.is_empty() {
        ui.label(RichText::new("Nothing found").color(t.text_dim));
        return;
    }
    egui::ScrollArea::vertical().id_salt("keymap-rows").auto_shrink([false, false]).min_scrolled_height(0.0).show(ui, |ui| {
        let mut group = "";
        for (g, action, keys) in rows {
            if *g != group {
                group = g;
                ui.add_space(4.0);
                ui.label(RichText::new(*g).color(t.text_dim).size(t.font.small));
            }
            ui.horizontal(|ui| {
                ui.set_min_width(ui.available_width());
                ui.label(*action);
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(RichText::new(*keys).font(t.mono_font()).color(t.text_dim));
                });
            });
        }
    });
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
}
