//! The IME rect in the IDE (task 090): while an editor tab has the focus, each frame's
//! `PlatformOutput::ime` is its caret as drawn, so macOS puts the input-source indicator and
//! the IME windows at the caret, not at a rect another widget left behind. The real bubble is
//! drawn by macOS; these tests check the rect the app hands to winit.

use crate::common::*;
use egui::{Event, Key, Modifiers, MouseWheelUnit, Rect, Vec2};

const SUITE: &str = "editor_ime";

fn ime(ide: &Ide) -> Option<Rect> {
    ide.harness.output().platform_output.ime.map(|i| i.rect)
}

fn caret_rect(ide: &Ide) -> Option<Rect> {
    ide.state().ws.tabs.active_editor().expect("editor").view.caret_rect()
}

#[test]
fn the_ime_rect_is_the_caret_after_typing_and_scrolling() {
    let fx = Fixture::new(SUITE, "caret");
    let repo = basic_repo(fx.path("repo"));
    let text: String = (0..300).map(|i| format!("export const value{i} = {i};\n")).collect();
    repo.write("src/long.ts", &text);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/long.ts");

    ide.click_at(ide.caret_pos(10, 13));
    assert_eq!(ide.cursor(), (10, 13));
    let caret = caret_rect(&ide).expect("the caret is drawn");
    assert_eq!(ime(&ide), Some(caret), "after the click");

    ide.type_text("Typed");
    ide.settle();
    assert_eq!(ide.cursor(), (10, 18));
    let typed = caret_rect(&ide).expect("drawn");
    assert_eq!(ime(&ide), Some(typed), "after typing");
    assert!(typed.left() > caret.left(), "the rect moved right with the caret");
    let c = ide.char_pos(10, 18);
    let g = ide.editor_geometry();
    assert!((typed.center().x - (c.x - g.char_w / 2.0)).abs() <= 1.0, "{typed:?} vs {c:?}");
    assert!(typed.top() <= c.y && c.y <= typed.bottom());

    // Five lines down: the caret stays in view and the rect follows it up.
    let line_h = g.line_h;
    ide.move_to(g.text_rect.center());
    ide.harness.input_mut().events.push(Event::MouseWheel { unit: MouseWheelUnit::Point, delta: Vec2::new(0.0, -5.0 * line_h), modifiers: Modifiers::NONE });
    ide.steps(10);
    ide.settle();
    let scrolled = caret_rect(&ide).expect("still in view");
    assert_eq!(ime(&ide), Some(scrolled), "after scrolling");
    assert!((typed.top() - scrolled.top() - 5.0 * line_h).abs() <= 1.0, "{typed:?} -> {scrolled:?}");

    // The find field takes the focus: the rect is the field's, not the editor caret.
    ide.cmd(Key::F);
    ide.settle();
    let field = ime(&ide).expect("a focused text field places the IME");
    assert_ne!(field, scrolled);
    assert!(field.bottom() <= g.text_rect.top() + 40.0, "in the find bar at the top: {field:?}");

    // Escape returns to the editor, and the rect to its caret.
    ide.key(Key::Escape);
    ide.settle();
    assert_eq!(ime(&ide), caret_rect(&ide), "back at the caret");
    assert!(ime(&ide).is_some());

    // A tool window without text input: the editor no longer places the rect.
    ide.click("README.md");
    ide.settle();
    assert_eq!(ime(&ide), None, "no stale editor rect while the tree has the focus");
}
