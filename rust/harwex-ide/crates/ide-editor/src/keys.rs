//! The two keymaps: IDEA's macOS keymap on macOS, its Windows/Linux keymap elsewhere.
//!
//! egui sets `Modifiers::command` to Cmd on macOS and to Ctrl elsewhere, so a binding written
//! with `command` already follows the platform. The bindings below are the ones where the two
//! IDEA keymaps differ in more than the modifier name: word moves (Alt on macOS, Ctrl
//! elsewhere), line and document edges, Delete Line and the occurrence keys. Every function has
//! a `_for(.., mac)` twin so tests cover both keymaps on any machine.

use std::borrow::Cow;

use egui::{Key, Modifiers};

/// The keymap of this build.
pub const MAC: bool = cfg!(target_os = "macos");

/// How far a horizontal caret move goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reach {
    Char,
    Word,
    /// The line start or end (Home/End, ⌘←/⌘→ on macOS).
    Line,
    /// The document start or end (Ctrl+Home/End off macOS).
    Document,
}

/// ←/→: ⌘ goes to the line edge and ⌥ by words on macOS; Ctrl goes by words elsewhere.
pub fn arrow_reach(m: Modifiers) -> Reach {
    arrow_reach_for(m, MAC)
}

pub fn arrow_reach_for(m: Modifiers, mac: bool) -> Reach {
    if mac && m.command {
        Reach::Line
    } else if word_modifier_for(m, mac) {
        Reach::Word
    } else {
        Reach::Char
    }
}

/// Home/End: the line edge; with Ctrl the document edge off macOS (macOS uses ⌘↑/⌘↓).
pub fn home_end_reach(m: Modifiers) -> Reach {
    home_end_reach_for(m, MAC)
}

pub fn home_end_reach_for(m: Modifiers, mac: bool) -> Reach {
    if !mac && m.ctrl {
        Reach::Document
    } else {
        Reach::Line
    }
}

/// What ↑/↓ with a modifier do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Vertical {
    /// A plain line move (also PageUp/PageDown by a page).
    Move,
    /// ⌘↑/⌘↓ on macOS: the document start or end.
    DocumentEdge,
    /// Ctrl+↑/↓ elsewhere: scroll the view by one line, the caret stays.
    Scroll,
}

pub fn vertical(m: Modifiers) -> Vertical {
    vertical_for(m, MAC)
}

pub fn vertical_for(m: Modifiers, mac: bool) -> Vertical {
    match (mac, m.command) {
        (true, true) => Vertical::DocumentEdge,
        (false, true) => Vertical::Scroll,
        _ => Vertical::Move,
    }
}

/// The modifier of word-wise moves and deletes: ⌥ on macOS, Ctrl elsewhere.
pub fn word_modifier(m: Modifiers) -> bool {
    word_modifier_for(m, MAC)
}

pub fn word_modifier_for(m: Modifiers, mac: bool) -> bool {
    if mac {
        m.alt
    } else {
        m.ctrl && !m.alt
    }
}

/// Delete Line: ⌘⌫ on macOS, Ctrl+Y elsewhere (IDEA's keymaps). Off macOS Ctrl+Backspace
/// deletes a word instead.
pub fn is_delete_line(key: Key, m: Modifiers) -> bool {
    is_delete_line_for(key, m, MAC)
}

pub fn is_delete_line_for(key: Key, m: Modifiers, mac: bool) -> bool {
    if mac {
        key == Key::Backspace && m.command
    } else {
        key == Key::Y && m.ctrl && !m.shift && !m.alt
    }
}

/// Redo besides ⇧⌘Z / Ctrl+Shift+Z: ⌃Y on macOS. Off macOS Ctrl+Y is Delete Line.
pub fn is_extra_redo(key: Key, m: Modifiers) -> bool {
    is_extra_redo_for(key, m, MAC)
}

pub fn is_extra_redo_for(key: Key, m: Modifiers, mac: bool) -> bool {
    mac && key == Key::Y && m.ctrl && !m.mac_cmd
}

/// Add Selection for Next Occurrence: ⌃G on macOS, Alt+J elsewhere; with Shift it unselects
/// the last one.
pub fn is_next_occurrence(key: Key, m: Modifiers) -> bool {
    is_next_occurrence_for(key, m, MAC)
}

pub fn is_next_occurrence_for(key: Key, m: Modifiers, mac: bool) -> bool {
    if mac {
        key == Key::G && m.ctrl && !m.command
    } else {
        key == Key::J && m.alt && !m.ctrl
    }
}

/// The modifiers of Select All Occurrences with its key: ⌃⌘G on macOS, Ctrl+Alt+Shift+J
/// elsewhere (Ctrl+G is Go to Line there).
pub fn select_all_occurrences() -> (Modifiers, Key) {
    select_all_occurrences_for(MAC)
}

pub fn select_all_occurrences_for(mac: bool) -> (Modifiers, Key) {
    if mac {
        (Modifiers::COMMAND | Modifiers::CTRL, Key::G)
    } else {
        (Modifiers::CTRL | Modifiers::ALT | Modifiers::SHIFT, Key::J)
    }
}

/// Find Next and Find Previous: ⌘G / ⇧⌘G on macOS, F3 / Shift+F3 elsewhere.
pub fn find_next() -> (Modifiers, Key) {
    if MAC {
        (Modifiers::COMMAND, Key::G)
    } else {
        (Modifiers::NONE, Key::F3)
    }
}

pub fn find_previous() -> (Modifiers, Key) {
    if MAC {
        (Modifiers::COMMAND | Modifiers::SHIFT, Key::G)
    } else {
        (Modifiers::SHIFT, Key::F3)
    }
}

/// Labels of the bindings above that differ in more than the modifier names.
pub fn select_all_occurrences_label() -> &'static str {
    if MAC { "⌃⌘G" } else { "Ctrl+Alt+Shift+J" }
}

pub fn next_occurrence_label() -> &'static str {
    if MAC { "⌃G" } else { "Alt+J" }
}

pub fn find_next_label() -> &'static str {
    if MAC { "⌘G" } else { "F3" }
}

pub fn find_previous_label() -> &'static str {
    if MAC { "⇧⌘G" } else { "Shift+F3" }
}

pub fn delete_line_label() -> &'static str {
    if MAC { "⌘⌫" } else { "Ctrl+Y" }
}

/// A shortcut written in macOS glyphs (`⇧⌘F`, `⌥⏎`) as this platform shows it. On macOS the
/// text is returned as is. Elsewhere ⌘ and ⌃ become `Ctrl+`, ⌥ `Alt+`, ⇧ `Shift+`, and the
/// key glyphs their names (`Ctrl+Shift+F`, `Alt+Enter`). Several shortcuts in one label
/// (`⌘G / ⇧⌘G`) keep their separators. The bindings that differ in more than the names
/// (word moves, Delete Line, the occurrence keys) are written per platform by the caller.
pub fn shortcut_label(text: &str) -> Cow<'_, str> {
    shortcut_label_for(text, MAC)
}

pub fn shortcut_label_for(text: &str, mac: bool) -> Cow<'_, str> {
    const GLYPHS: &str = "⌘⌃⌥⇧⏎↩⌫⌦⎋⇥";
    if mac || !text.chars().any(|c| GLYPHS.contains(c)) {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len() + 8);
    // Modifiers collect until the key, then print in the Windows order: Ctrl, Alt, Shift.
    let (mut ctrl, mut alt, mut shift) = (false, false, false);
    let flush = |out: &mut String, ctrl: &mut bool, alt: &mut bool, shift: &mut bool| {
        for (on, name) in [(&mut *ctrl, "Ctrl+"), (&mut *alt, "Alt+"), (&mut *shift, "Shift+")] {
            if *on {
                out.push_str(name);
                *on = false;
            }
        }
    };
    for c in text.chars() {
        let flag = match c {
            '⌘' | '⌃' => Some((&mut ctrl, "Ctrl")),
            '⌥' => Some((&mut alt, "Alt")),
            '⇧' => Some((&mut shift, "Shift")),
            _ => None,
        };
        if let Some((on, name)) = flag {
            if *on {
                // `⇧⇧` is a double press, not a chord.
                *on = false;
                out.push_str("Double ");
                out.push_str(name);
            } else {
                *on = true;
            }
            continue;
        }
        match c {
            // `⌘ click`: the modifier belongs to the mouse word after the space.
            c if c.is_whitespace() && (ctrl || alt || shift) => flush(&mut out, &mut ctrl, &mut alt, &mut shift),
            _ => {
                flush(&mut out, &mut ctrl, &mut alt, &mut shift);
                let name = match c {
                    '⏎' | '↩' => Some("Enter"),
                    '⌫' => Some("Backspace"),
                    '⌦' => Some("Delete"),
                    '⎋' => Some("Esc"),
                    '⇥' => Some("Tab"),
                    _ => None,
                };
                match name {
                    Some(n) => out.push_str(n),
                    None => out.push(c),
                }
            }
        }
    }
    // A label of modifiers only (a "hold ⌥" hint) names them without a trailing `+`.
    if ctrl || alt || shift {
        flush(&mut out, &mut ctrl, &mut alt, &mut shift);
        if out.ends_with('+') {
            out.pop();
        }
    }
    Cow::Owned(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_stay_on_mac_and_get_names_elsewhere() {
        assert_eq!(shortcut_label_for("⇧⌘F", true), "⇧⌘F");
        assert_eq!(shortcut_label_for("⇧⌘F", false), "Ctrl+Shift+F");
        assert_eq!(shortcut_label_for("⌥⌘B", false), "Ctrl+Alt+B");
        assert_eq!(shortcut_label_for("⌥⏎", false), "Alt+Enter");
        assert_eq!(shortcut_label_for("⌃G", false), "Ctrl+G");
        assert_eq!(shortcut_label_for("⌘⌫", false), "Ctrl+Backspace");
        assert_eq!(shortcut_label_for("⌥F7", false), "Alt+F7");
        assert_eq!(shortcut_label_for("⇧F6", false), "Shift+F6");
        assert_eq!(shortcut_label_for("⌘G / ⇧⌘G", false), "Ctrl+G / Ctrl+Shift+G");
        assert_eq!(shortcut_label_for("⎋", false), "Esc");
        assert_eq!(shortcut_label_for("⌘↑", false), "Ctrl+↑");
        assert_eq!(shortcut_label_for("⌥", false), "Alt");
        assert_eq!(shortcut_label_for("⇧⇧ or ⇧⌘O", false), "Double Shift or Ctrl+Shift+O");
        assert_eq!(shortcut_label_for("Double ⇧", false), "Double Shift");
        assert_eq!(shortcut_label_for("⌘B or ⌘ click", false), "Ctrl+B or Ctrl+click");
        assert_eq!(shortcut_label_for("⌥ click on ×", false), "Alt+click on ×");
        assert_eq!(shortcut_label_for("Hide  ⇧⎋", false), "Hide  Shift+Esc");
        assert_eq!(shortcut_label_for("F2", false), "F2");
        assert!(matches!(shortcut_label_for("Alt+F12", false), Cow::Borrowed(_)));
    }

    #[test]
    fn word_moves_use_alt_on_mac_and_ctrl_elsewhere() {
        let (alt, ctrl, cmd_mac) = (Modifiers::ALT, Modifiers::CTRL | Modifiers::COMMAND, Modifiers::MAC_CMD | Modifiers::COMMAND);
        assert_eq!(arrow_reach_for(alt, true), Reach::Word);
        assert_eq!(arrow_reach_for(cmd_mac, true), Reach::Line);
        assert_eq!(arrow_reach_for(ctrl, false), Reach::Word);
        assert_eq!(arrow_reach_for(alt, false), Reach::Char);
        assert!(word_modifier_for(alt, true) && !word_modifier_for(ctrl, true));
        assert!(word_modifier_for(ctrl, false) && !word_modifier_for(alt, false));
        assert_eq!(home_end_reach_for(ctrl, false), Reach::Document);
        assert_eq!(home_end_reach_for(Modifiers::NONE, false), Reach::Line);
        assert_eq!(home_end_reach_for(Modifiers::CTRL, true), Reach::Line);
        assert_eq!(vertical_for(cmd_mac, true), Vertical::DocumentEdge);
        assert_eq!(vertical_for(ctrl, false), Vertical::Scroll);
        assert_eq!(vertical_for(Modifiers::NONE, false), Vertical::Move);
    }

    #[test]
    fn delete_line_redo_and_occurrences_follow_the_idea_keymaps() {
        let ctrl = Modifiers::CTRL | Modifiers::COMMAND;
        assert!(is_delete_line_for(Key::Backspace, Modifiers::MAC_CMD | Modifiers::COMMAND, true));
        assert!(!is_delete_line_for(Key::Backspace, ctrl, false));
        assert!(is_delete_line_for(Key::Y, ctrl, false));
        assert!(!is_extra_redo_for(Key::Y, ctrl, false));
        assert!(is_extra_redo_for(Key::Y, Modifiers::CTRL, true));
        assert!(is_next_occurrence_for(Key::G, Modifiers::CTRL, true));
        assert!(!is_next_occurrence_for(Key::G, ctrl, false));
        assert!(is_next_occurrence_for(Key::J, Modifiers::ALT, false));
        assert!(is_next_occurrence_for(Key::J, Modifiers::ALT | Modifiers::SHIFT, false));
        assert_eq!(select_all_occurrences_for(false), (Modifiers::CTRL | Modifiers::ALT | Modifiers::SHIFT, Key::J));
    }
}
