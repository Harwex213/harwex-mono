//! The IME rect (task 090): while the editor has the focus, every frame hands the primary
//! caret's drawn rect to `PlatformOutput::ime`, so macOS puts the input-source indicator and
//! the IME windows at the caret. Preedit text shows at the caret; a commit types it.

use egui::{CentralPanel, Context, Event, ImeEvent, Key, Modifiers, MouseWheelUnit, PointerButton, Pos2, RawInput, Rect, Vec2};
use ide_editor::{Document, EditorState, EditorView, Language, Position};

struct Harness {
    ctx: Context,
    doc: Document,
    state: EditorState,
    events: Vec<Event>,
    time: f64,
    /// `PlatformOutput::ime` of the last frame.
    ime: Option<Rect>,
}

impl Harness {
    fn new(text: &str, language: Language, wrap: bool) -> Harness {
        let doc = Document::from_text(text, language);
        let mut state = EditorState::new();
        state.set_soft_wrap(wrap);
        let mut h = Harness { ctx: Context::default(), doc, state, events: Vec::new(), time: 0.0, ime: None };
        h.settle();
        h
    }

    fn lines(n: usize) -> Harness {
        let text: String = (0..n).map(|i| format!("let value{i} = {i};\n")).collect();
        Harness::new(&text, Language::TypeScript, false)
    }

    fn frame(&mut self) {
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(800.0, 400.0))),
            events: std::mem::take(&mut self.events),
            time: Some(self.time),
            ..Default::default()
        };
        self.time += 0.5;
        let (doc, state) = (&mut self.doc, &mut self.state);
        let out = self.ctx.run(input, |ctx| {
            CentralPanel::default().frame(egui::Frame::NONE).show(ctx, |ui| {
                EditorView::new(doc, state).show(ui);
            });
        });
        let ime = out.platform_output.ime;
        if let Some(i) = ime {
            assert_eq!(i.rect, i.cursor_rect, "the whole IME rect is the caret");
        }
        self.ime = ime.map(|i| i.rect);
    }

    fn settle(&mut self) {
        for _ in 0..4 {
            self.frame();
        }
    }

    fn click(&mut self, p: Pos2) {
        for pressed in [true, false] {
            self.events.push(Event::PointerMoved(p));
            self.events.push(Event::PointerButton { pos: p, button: PointerButton::Primary, pressed, modifiers: Modifiers::NONE });
            self.frame();
        }
        self.settle();
    }

    fn click_at(&mut self, pos: Position) {
        let p = self.state.char_center(&self.doc, pos).expect("drawn");
        self.click(p - Vec2::new(self.state.geometry().expect("drawn").char_w * 0.4, 0.0));
        assert_eq!(self.state.cursor(), pos);
    }

    fn text(&mut self, t: &str) {
        self.events.push(Event::Text(t.into()));
        self.settle();
    }

    fn wheel(&mut self, dy: f32) {
        let g = self.state.geometry().expect("drawn");
        self.events.push(Event::PointerMoved(g.text_rect.center()));
        self.events.push(Event::MouseWheel { unit: MouseWheelUnit::Point, delta: Vec2::new(0.0, dy), modifiers: Modifiers::NONE });
        for _ in 0..30 {
            self.frame();
        }
    }

    /// The IME rect is the caret as drawn, and the caret sits at `pos`.
    fn assert_ime_at_caret(&self, pos: Position, what: &str) {
        let caret = self.state.caret_rect().unwrap_or_else(|| panic!("{what}: the caret is drawn"));
        assert_eq!(self.ime, Some(caret), "{what}: the IME rect is the caret rect");
        assert_eq!(self.state.ime_rect(), Some(caret), "{what}");
        let c = self.state.char_center(&self.doc, pos).expect("drawn");
        let g = self.state.geometry().expect("drawn");
        assert!((caret.center().x - (c.x - g.char_w / 2.0)).abs() <= 1.0, "{what}: caret x {caret:?} vs char {c:?}");
        assert!(caret.top() <= c.y && c.y <= caret.bottom(), "{what}: caret row {caret:?} vs char {c:?}");
        assert!(g.text_rect.contains(caret.center()), "{what}: inside the text area");
    }
}

#[test]
fn the_ime_rect_follows_the_caret_through_typing_and_scrolling() {
    let mut h = Harness::lines(200);
    assert_eq!(h.ime, None, "no focus, no IME rect");

    h.click_at(Position::new(5, 4));
    h.assert_ime_at_caret(Position::new(5, 4), "after the click");

    h.text("abc");
    assert!(h.doc.line(5).starts_with("let abcvalue5"));
    h.assert_ime_at_caret(Position::new(5, 7), "after typing");
    let before = h.ime.expect("set");

    // Three lines down: the caret stays in view and moves up on screen.
    let line_h = h.state.geometry().expect("drawn").line_h;
    h.wheel(-3.0 * line_h);
    assert!(h.state.scroll_offset().y > 0.0, "scrolled");
    h.assert_ime_at_caret(Position::new(5, 7), "after scrolling");
    let dy = before.top() - h.ime.expect("set").top();
    assert!((dy - h.state.scroll_offset().y).abs() <= 1.0, "the rect moved by the scroll: {dy}");

    // Far down: the caret is off screen, so the rect waits at the top edge of the text area.
    h.wheel(-60.0 * line_h);
    assert_eq!(h.state.caret_rect(), None, "the caret is scrolled away");
    let g = h.state.geometry().expect("drawn");
    let r = h.ime.expect("the IME stays allowed while the editor has the focus");
    assert!(g.text_rect.contains(r.center()), "{r:?} inside {:?}", g.text_rect);
    assert_eq!(r.top(), g.text_rect.top(), "the edge nearest to the caret");

    // Typing brings the caret back, and the rect with it.
    h.text("d");
    h.assert_ime_at_caret(Position::new(5, 8), "after typing off screen");
}

#[test]
fn the_ime_rect_follows_a_soft_wrapped_caret() {
    let long = "word ".repeat(60);
    let mut h = Harness::new(&format!("# Title\n\n{long}\n"), Language::Markdown, true);
    h.click_at(Position::new(2, 0));
    let row0 = h.state.caret_rect().expect("drawn");
    // Down moves to the second visual row of the same line.
    h.events.push(Event::Key { key: Key::ArrowDown, physical_key: None, pressed: true, repeat: false, modifiers: Modifiers::NONE });
    h.settle();
    assert_eq!(h.state.cursor().line, 2, "the line wraps");
    let caret = h.state.caret_rect().expect("drawn");
    assert_eq!(h.ime, Some(caret));
    assert!(caret.top() > row0.top(), "the rect moved to the next visual row: {caret:?} {row0:?}");
    let c = h.state.char_center(&h.doc, h.state.cursor()).expect("drawn");
    assert!(caret.top() <= c.y && c.y <= caret.bottom());
}

#[test]
fn preedit_shows_at_the_caret_and_a_commit_types_it() {
    let mut h = Harness::lines(10);
    h.click_at(Position::new(1, 4));
    let v = h.doc.version();

    // A dead key (Option+E) opens a composition; the text does not change yet.
    h.events.push(Event::Ime(ImeEvent::Enabled));
    h.events.push(Event::Ime(ImeEvent::Preedit("´".into())));
    h.settle();
    assert_eq!(h.state.preedit(), "´");
    assert_eq!(h.doc.version(), v, "preedit is not an edit");
    h.assert_ime_at_caret(Position::new(1, 4), "during preedit");

    h.events.push(Event::Ime(ImeEvent::Preedit(String::new())));
    h.events.push(Event::Ime(ImeEvent::Commit("é".into())));
    h.settle();
    assert_eq!(h.state.preedit(), "");
    assert!(h.doc.line(1).starts_with("let évalue1"), "{}", h.doc.line(1));
    h.assert_ime_at_caret(Position::new(1, 5), "after the commit");

    // A CJK composition commits several chars as one undo step.
    h.events.push(Event::Ime(ImeEvent::Preedit("nihao".into())));
    h.frame();
    h.events.push(Event::Ime(ImeEvent::Commit("你好".into())));
    h.settle();
    assert!(h.doc.line(1).starts_with("let é你好value1"), "{}", h.doc.line(1));
    assert_eq!(h.state.cursor(), Position::new(1, 7));
}

#[test]
fn a_read_only_editor_ignores_commits() {
    let doc = Document::from_text("let a = 1;\n", Language::TypeScript);
    let mut state = EditorState::new();
    state.request_focus();
    let ctx = Context::default();
    let mut doc = doc;
    let mut ime = None;
    for i in 0..4 {
        let events = if i == 2 { vec![Event::Ime(ImeEvent::Commit("x".into()))] } else { Vec::new() };
        let input = RawInput { screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(400.0, 200.0))), events, ..Default::default() };
        let out = ctx.run(input, |ctx| {
            CentralPanel::default().show(ctx, |ui| {
                EditorView::new(&mut doc, &mut state).read_only(true).show(ui);
            });
        });
        ime = out.platform_output.ime;
    }
    assert_eq!(doc.text(), "let a = 1;\n");
    assert!(ime.is_some(), "a read-only editor still places the IME rect (navigation, Find)");
}
