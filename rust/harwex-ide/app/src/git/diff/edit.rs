//! Edits on the working-tree side of a diff. The commands are the editor's own
//! (`ide_editor::editing`, `ide_editor::carets`) on the shared document, so typing, Enter, Tab,
//! Backspace, undo, cut and paste behave as in an editor tab and land in its undo history.

use egui::{Event, Key, Modifiers};
use ide_editor::{carets, editing, Carets, Document, EditKind, Selection};

/// One edit request from the keyboard or the clipboard.
#[derive(Clone, Debug)]
pub(super) enum Edit {
    Text(String),
    Paste(String),
    Cut,
    Key(Key, Modifiers),
}

/// The edit an input event asks for. `mods` are the frame's modifiers: a `Text` event carries
/// none, and text typed with Cmd or Ctrl held is a shortcut, not text.
pub(super) fn edit_of(e: &Event, mods: Modifiers) -> Option<Edit> {
    match e {
        Event::Text(t) if !t.is_empty() && !mods.command && !mods.ctrl => Some(Edit::Text(t.clone())),
        Event::Paste(t) => Some(Edit::Paste(t.clone())),
        Event::Cut => Some(Edit::Cut),
        Event::Key { key, pressed: true, modifiers: m, .. } if is_edit_key(*key, *m) => Some(Edit::Key(*key, *m)),
        _ => None,
    }
}

/// Keys that change the text, as in the editor (`ide_editor::view::is_edit_key`).
fn is_edit_key(key: Key, m: Modifiers) -> bool {
    match key {
        Key::Backspace | Key::Delete | Key::Enter | Key::Tab => true,
        Key::Z | Key::D | Key::Slash => m.command,
        Key::Y => m.ctrl && !m.mac_cmd,
        _ => false,
    }
}

/// Applies `edit` at `sel`. Returns the new selection and the text a Cut took.
pub(super) fn apply(doc: &mut Document, sel: Selection, edit: &Edit) -> (Selection, Option<String>) {
    let mut c = Carets::single(sel);
    let mut cut = None;
    match edit {
        Edit::Text(t) => {
            let single = t.chars().count() == 1;
            carets::edit_each(doc, &mut c, |doc, s, _| {
                if single {
                    editing::type_char(doc, s, t);
                } else {
                    // IME and multi-char input never merge with typing, like the editor.
                    let r = s.range();
                    let after = Selection::caret(r.start + t.chars().count());
                    doc.edit(r, t, *s, after, EditKind::Other);
                    *s = after;
                }
            });
        }
        Edit::Paste(t) => carets::paste(doc, &mut c, t),
        Edit::Cut => cut = Some(carets::cut(doc, &mut c)),
        Edit::Key(key, m) => match key {
            Key::Backspace if m.command => carets::edit_each(doc, &mut c, |doc, s, _| editing::delete_line(doc, s)),
            Key::Backspace => carets::edit_each(doc, &mut c, |doc, s, _| editing::backspace(doc, s, m.alt)),
            Key::Delete => carets::edit_each(doc, &mut c, |doc, s, _| editing::delete_forward(doc, s, m.alt)),
            Key::Enter => carets::edit_each(doc, &mut c, |doc, s, _| {
                if m.shift {
                    *s = Selection::caret(editing::line_end_of(doc, s.head));
                }
                editing::newline(doc, s);
            }),
            Key::Tab if m.shift => carets::dedent(doc, &mut c),
            Key::Tab => carets::tab(doc, &mut c),
            Key::Z | Key::Y => {
                let redo = *key == Key::Y || m.shift;
                let restored = if redo { doc.redo_carets() } else { doc.undo_carets() };
                if let Some(mut r) = restored {
                    r.clamp(doc.len_chars());
                    c = r;
                }
            }
            Key::D => carets::edit_each(doc, &mut c, |doc, s, _| editing::duplicate(doc, s)),
            Key::Slash => carets::toggle_comment(doc, &mut c),
            _ => {}
        },
    }
    (c.primary(), cut)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ide_editor::Language;

    fn key(k: Key, m: Modifiers) -> Edit {
        Edit::Key(k, m)
    }

    #[test]
    fn typing_enter_and_undo_follow_the_editor() {
        let mut d = Document::from_text("fn a() {\n}\n", Language::Plain);
        let (s, _) = apply(&mut d, Selection::caret(8), &key(Key::Enter, Modifiers::NONE));
        let (s, _) = apply(&mut d, s, &Edit::Text("x".into()));
        let (s, _) = apply(&mut d, s, &Edit::Text("y".into()));
        assert_eq!(d.text(), "fn a() {\n    xy\n}\n");
        assert_eq!(s.head, 15);
        let (s, _) = apply(&mut d, s, &key(Key::Z, Modifiers::COMMAND));
        assert_eq!(d.text(), "fn a() {\n    \n}\n", "typed chars are one undo step");
        let (_, _) = apply(&mut d, s, &key(Key::Z, Modifiers::COMMAND | Modifiers::SHIFT));
        assert_eq!(d.text(), "fn a() {\n    xy\n}\n");
    }

    #[test]
    fn cut_takes_the_line_and_paste_puts_it_back() {
        let mut d = Document::from_text("one\ntwo\n", Language::Plain);
        let (s, cut) = apply(&mut d, Selection::caret(1), &Edit::Cut);
        assert_eq!(cut.as_deref(), Some("one\n"));
        assert_eq!(d.text(), "two\n");
        let (_, _) = apply(&mut d, Selection::caret(s.head + 4), &Edit::Paste("one\n".into()));
        assert_eq!(d.text(), "two\none\n");
    }

    #[test]
    fn shortcut_text_is_not_typed() {
        assert!(edit_of(&Event::Text("s".into()), Modifiers::COMMAND).is_none());
        assert!(edit_of(&Event::Text("s".into()), Modifiers::NONE).is_some());
        let k = |key, modifiers| Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers };
        assert!(edit_of(&k(Key::Z, Modifiers::NONE), Modifiers::NONE).is_none());
        assert!(edit_of(&k(Key::Z, Modifiers::COMMAND), Modifiers::COMMAND).is_some());
        assert!(edit_of(&k(Key::ArrowLeft, Modifiers::NONE), Modifiers::NONE).is_none());
    }
}
