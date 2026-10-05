//! Horizontal scroll of the unwrapped layout (task 049): the trackpad's horizontal delta and
//! Shift+wheel scroll sideways, the caret drags the view along, the horizontal scrollbar is ours
//! and shows only when a line is wider than the view, the gutter stays put. Soft-wrapped text
//! never scrolls sideways.

use egui::{CentralPanel, Context, Event, Key, Modifiers, MouseWheelUnit, PointerButton, Pos2, RawInput, Rect, Vec2};
use ide_editor::{Document, EditorState, EditorView, Language, Position};

struct Harness {
    ctx: Context,
    doc: Document,
    state: EditorState,
    events: Vec<Event>,
    modifiers: Modifiers,
    time: f64,
}

impl Harness {
    fn new(text: &str, language: Language) -> Harness {
        let doc = Document::from_text(text, language);
        let mut h = Harness { ctx: Context::default(), doc, state: EditorState::new(), events: Vec::new(), modifiers: Modifiers::NONE, time: 0.0 };
        h.frame();
        h.frame();
        h
    }

    /// 60 lines; line 3 is 400 chars long, the others are short.
    fn long_line() -> Harness {
        let text: String = (0..60).map(|i| if i == 3 { format!("let wide = \"{}\";\n", "x".repeat(400)) } else { format!("let v{i} = {i};\n") }).collect();
        Harness::new(&text, Language::TypeScript)
    }

    fn frame(&mut self) {
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(800.0, 400.0))),
            events: std::mem::take(&mut self.events),
            modifiers: self.modifiers,
            time: Some(self.time),
            ..Default::default()
        };
        self.time += 0.5;
        let (doc, state) = (&mut self.doc, &mut self.state);
        let _ = self.ctx.run(input, |ctx| {
            CentralPanel::default().frame(egui::Frame::NONE).show(ctx, |ui| {
                EditorView::new(doc, state).show(ui);
            });
        });
    }

    fn settle(&mut self) {
        for _ in 0..4 {
            self.frame();
        }
    }

    /// A wheel event over the text area, `delta` in points (positive x scrolls left).
    fn wheel(&mut self, delta: Vec2, modifiers: Modifiers) {
        let g = self.state.geometry().expect("drawn");
        self.events.push(Event::PointerMoved(g.text_rect.center()));
        self.events.push(Event::MouseWheel { unit: MouseWheelUnit::Point, delta, modifiers });
        self.modifiers = modifiers;
        self.frame();
        self.modifiers = Modifiers::NONE;
        self.settle();
    }

    fn key(&mut self, key: Key) {
        self.events.push(Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers: Modifiers::NONE });
        self.events.push(Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers: Modifiers::NONE });
        self.settle();
    }

    fn button(&mut self, p: Pos2, pressed: bool) {
        self.events.push(Event::PointerMoved(p));
        self.events.push(Event::PointerButton { pos: p, button: PointerButton::Primary, pressed, modifiers: Modifiers::NONE });
        self.frame();
    }

    fn click(&mut self, p: Pos2) {
        self.button(p, true);
        self.button(p, false);
        self.settle();
    }

    fn scroll_x(&self) -> f32 {
        self.state.scroll_offset().x
    }

    /// The horizontal scrollbar's track, if it was drawn last frame.
    fn hbar(&self) -> Option<Rect> {
        self.state.hbar_rect()
    }
}

/// egui smooths a wheel step over frames, which leaves float noise.
fn assert_close(a: f32, b: f32, what: &str) {
    assert!((a - b).abs() < 0.01, "{what}: {a} != {b}");
}

#[test]
fn horizontal_delta_and_shift_wheel_scroll_sideways_and_the_gutter_stays() {
    let mut h = Harness::long_line();
    let g0 = h.state.geometry().expect("drawn");
    assert_eq!(h.scroll_x(), 0.0);

    // A trackpad's two-finger swipe to the left.
    h.wheel(Vec2::new(-120.0, 0.0), Modifiers::NONE);
    assert_close(h.scroll_x(), 120.0, "swipe");
    let g1 = h.state.geometry().expect("drawn");
    assert_eq!(g1.gutter_rect, g0.gutter_rect, "the gutter stays fixed");
    assert_eq!(g1.text_rect, g0.text_rect);
    assert_close(g1.origin.x, g0.origin.x - 120.0, "the text moves by the scroll");

    // A mouse wheel with Shift scrolls sideways, not down.
    let y = h.state.scroll_offset().y;
    h.wheel(Vec2::new(0.0, -80.0), Modifiers::SHIFT);
    assert_close(h.scroll_x(), 200.0, "Shift+wheel");
    assert_eq!(h.state.scroll_offset().y, y);

    // Scrolling back stops at the left edge, and far right stops at the end of the longest line.
    h.wheel(Vec2::new(5000.0, 0.0), Modifiers::NONE);
    assert_eq!(h.scroll_x(), 0.0);
    h.wheel(Vec2::new(-50_000.0, 0.0), Modifiers::NONE);
    let g = h.state.geometry().expect("drawn");
    let end = g.char_center(&h.doc, Position::new(3, h.doc.line_len(3)));
    assert!(end.x < g.text_rect.right() && end.x > g.text_rect.right() - 20.0 * g.char_w, "the line end is in view at the far right: {end:?} {:?}", g.text_rect);
}

#[test]
fn a_click_after_scrolling_lands_on_the_char_under_the_pointer() {
    let mut h = Harness::long_line();
    h.wheel(Vec2::new(-400.0, 0.0), Modifiers::NONE);
    let g = h.state.geometry().expect("drawn");
    // Left of the cell's center, so the caret goes before the char.
    let p = g.char_center(&h.doc, Position::new(3, 100)) - Vec2::new(g.char_w * 0.3, 0.0);
    h.click(p);
    assert_eq!(h.state.cursor(), Position::new(3, 100));
    assert_close(h.scroll_x(), 400.0, "a click in view does not move the view");
}

#[test]
fn end_and_home_on_a_long_line_scroll_to_the_caret() {
    let mut h = Harness::long_line();
    let p = h.state.geometry().expect("drawn").char_center(&h.doc, Position::new(3, 0));
    h.click(p);
    h.key(Key::End);
    assert_eq!(h.state.cursor(), Position::new(3, h.doc.line_len(3)));
    assert!(h.scroll_x() > 0.0);
    let g = h.state.geometry().expect("drawn");
    let caret = g.char_center(&h.doc, h.state.cursor());
    assert!(g.text_rect.contains(caret), "the caret is in view after End: {caret:?} {:?}", g.text_rect);

    h.key(Key::Home);
    assert_eq!(h.scroll_x(), 0.0, "Home brings the view back to the line start");

    // Walking down from the end of the long line onto short lines scrolls back to them.
    h.key(Key::End);
    h.key(Key::ArrowDown);
    assert_eq!(h.state.cursor(), Position::new(4, h.doc.line_len(4)));
    assert_eq!(h.scroll_x(), 0.0);
}

#[test]
fn the_scrollbar_shows_only_when_a_line_is_wider_than_the_view() {
    let mut short = Harness::new("let a = 1;\nlet b = 2;\n", Language::TypeScript);
    assert!(short.hbar().is_none(), "short lines: no horizontal scrollbar");
    short.wheel(Vec2::new(-100.0, 0.0), Modifiers::NONE);
    assert_eq!(short.scroll_x(), 0.0, "nothing to scroll");

    // A line that just fits gets no bar either, although the scroll range keeps some slack.
    let g = short.state.geometry().expect("drawn");
    let fits = ((g.text_rect.width() - 12.0) / g.char_w).floor() as usize - 1;
    let mut snug = Harness::new(&format!("{}\n", "y".repeat(fits)), Language::TypeScript);
    assert!(snug.hbar().is_none(), "a line of {fits} chars fits");
    snug.wheel(Vec2::new(-100.0, 0.0), Modifiers::NONE);
    assert_eq!(snug.scroll_x(), 0.0);
    let snug_over = Harness::new(&format!("{}\n", "y".repeat(fits + 2)), Language::TypeScript);
    assert!(snug_over.hbar().is_some(), "two more chars do not fit");

    let h = Harness::long_line();
    let bar = h.hbar().expect("a long line shows the scrollbar");
    let g = h.state.geometry().expect("drawn");
    assert_eq!(bar.bottom(), g.text_rect.bottom(), "the bar sits at the bottom of the text area");
    assert!(bar.left() >= g.text_rect.left(), "the bar never covers the gutter");
}

#[test]
fn dragging_the_thumb_and_pressing_the_track_scroll() {
    let mut h = Harness::long_line();
    let bar = h.hbar().expect("bar");
    // The thumb starts at the left end of the track.
    let start = Pos2::new(bar.left() + 5.0, bar.center().y);
    h.button(start, true);
    for k in 1..=5 {
        h.events.push(Event::PointerMoved(start + Vec2::new(20.0 * k as f32, 0.0)));
        h.frame();
    }
    h.button(start + Vec2::new(100.0, 0.0), false);
    h.settle();
    let dragged = h.scroll_x();
    assert!(dragged > 100.0, "dragging the thumb 100 pt scrolls the wider content further: {dragged}");

    // A press near the right end of the track jumps there.
    let right = Pos2::new(bar.right() - 3.0, bar.center().y);
    h.click(right);
    assert!(h.scroll_x() > dragged * 2.0, "a press on the track jumps: {}", h.scroll_x());
    assert_eq!(h.state.cursor(), Position::new(0, 0), "a press on the bar never moves the caret");
}

#[test]
fn soft_wrapped_text_never_scrolls_sideways() {
    let text = format!("# Title\n\n{}\n", "word ".repeat(200));
    let mut h = Harness::new(&text, Language::Markdown);
    h.state.set_soft_wrap(true);
    h.settle();
    assert!(h.hbar().is_none());
    h.wheel(Vec2::new(-200.0, 0.0), Modifiers::NONE);
    h.wheel(Vec2::new(0.0, -200.0), Modifiers::SHIFT);
    assert_eq!(h.scroll_x(), 0.0);
}

#[test]
fn view_state_restores_into_a_new_state_on_its_first_frame() {
    let mut h = Harness::long_line();
    h.wheel(Vec2::new(-120.0, -300.0), Modifiers::NONE);
    let scroll = h.state.scroll_offset();
    assert!(scroll.x > 100.0 && scroll.y > 200.0, "{scroll:?}");
    let v = h.state.view_state(&h.doc).expect("drawn");
    assert!(v.line > 0 && v.column == 0, "{v:?}");

    // A reopened tab: a fresh state, a caret off screen and the old view. The first frame
    // draws the old offset, not the caret's.
    h.state = EditorState::new();
    h.state.reveal(Position::new(55, 2));
    h.state.restore_view(v);
    h.frame();
    assert_eq!(h.state.scroll_offset(), scroll);
    assert_eq!(h.state.view_state(&h.doc), Some(v));
    assert_eq!(h.state.cursor(), Position::new(55, 2), "the caret still moves");
}
