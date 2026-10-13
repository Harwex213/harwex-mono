//! Folds and line bands of the unwrapped layout (the merge window, task 106): a fold hides its
//! lines behind one row, rows below move up, a press on the row opens it, Up/Down step over
//! it, a caret moved into it opens it, and a band paints behind its lines.

use egui::epaint::Shape;
use egui::{CentralPanel, Color32, Context, Event, Key, Modifiers, PointerButton, Pos2, RawInput, Rect, Vec2};
use ide_editor::{Document, EditorState, EditorView, Fold, Language, LineBand, Position};

const BAND: Color32 = Color32::from_rgb(10, 200, 30);

struct Harness {
    ctx: Context,
    doc: Document,
    state: EditorState,
    bands: Vec<LineBand>,
    events: Vec<Event>,
    time: f64,
    unfolded: Option<Fold>,
}

impl Harness {
    fn new() -> Harness {
        let text: String = (0..60).map(|i| format!("let v{i} = {i};\n")).collect();
        let mut h = Harness { ctx: Context::default(), doc: Document::from_text(&text, Language::TypeScript), state: EditorState::new(), bands: Vec::new(), events: Vec::new(), time: 0.0, unfolded: None };
        h.state.set_folds(vec![Fold { lines: 5..15, label: "10 unchanged lines".into() }]);
        h.frame();
        h.frame();
        h
    }

    fn frame(&mut self) -> Vec<Shape> {
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(800.0, 400.0))),
            events: std::mem::take(&mut self.events),
            time: Some(self.time),
            ..Default::default()
        };
        self.time += 1.0;
        let (doc, state, bands) = (&mut self.doc, &mut self.state, &self.bands);
        let mut unfolded = None;
        let out = self.ctx.run(input, |ctx| {
            CentralPanel::default().frame(egui::Frame::NONE).show(ctx, |ui| {
                unfolded = EditorView::new(doc, state).line_bands(bands).show(ui).unfolded;
            });
        });
        if unfolded.is_some() {
            self.unfolded = unfolded;
        }
        out.shapes.into_iter().map(|c| c.shape).collect()
    }

    fn click(&mut self, p: Pos2) {
        for pressed in [true, false] {
            self.events.push(Event::PointerMoved(p));
            self.events.push(Event::PointerButton { pos: p, button: PointerButton::Primary, pressed, modifiers: Modifiers::NONE });
            self.frame();
        }
        self.frame();
    }

    fn key(&mut self, key: Key) {
        self.events.push(Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers: Modifiers::NONE });
        self.frame();
        self.frame();
    }

    fn caret_line(&self) -> usize {
        self.state.cursor().line
    }
}

#[test]
fn a_fold_hides_its_lines_behind_one_row() {
    let mut h = Harness::new();
    let line_h = h.state.geometry().expect("drawn").line_h;
    let (top4, _) = h.state.line_span(4).expect("drawn");
    let (top15, _) = h.state.line_span(15).expect("drawn");
    assert!((top15 - top4 - 2.0 * line_h).abs() < 1.0, "line 15 sits two rows under line 4: {top4} {top15}");
    assert_eq!(h.state.line_span(9), h.state.line_span(5), "a hidden line answers with the fold's row");
    assert_eq!(h.state.visual_row(&h.doc, Position::new(20, 0)), 11);
    let rects = h.state.fold_rects().to_vec();
    assert_eq!(rects.len(), 1);
    // A press on the row opens the fold and places no caret.
    h.click(rects[0].1.center());
    assert_eq!(h.unfolded.as_ref().map(|f| f.lines.clone()), Some(5..15));
    assert!(h.state.folds().is_empty());
    assert_eq!(h.caret_line(), 0);
    let (top15, _) = h.state.line_span(15).expect("drawn");
    assert!((top15 - top4 - 11.0 * line_h).abs() < 1.0, "the lines are back");
}

#[test]
fn up_and_down_step_over_a_fold() {
    let mut h = Harness::new();
    let p = h.state.char_center(&h.doc, Position::new(4, 2)).expect("drawn");
    h.click(p);
    assert_eq!(h.caret_line(), 4);
    h.key(Key::ArrowDown);
    assert_eq!(h.caret_line(), 15, "Down lands on the line under the fold");
    assert_eq!(h.state.folds().len(), 1, "stepping over keeps the fold");
    h.key(Key::ArrowUp);
    assert_eq!(h.caret_line(), 4);
}

#[test]
fn a_caret_moved_into_a_fold_opens_it() {
    let mut h = Harness::new();
    h.state.reveal(Position::new(9, 0));
    h.frame();
    h.frame();
    assert_eq!(h.caret_line(), 9);
    assert!(h.state.folds().is_empty(), "the fold opened for the caret");
    assert_eq!(h.unfolded.as_ref().map(|f| f.lines.clone()), Some(5..15));
}

#[test]
fn bands_paint_behind_their_lines() {
    let mut h = Harness::new();
    h.bands = vec![LineBand { lines: 2..4, fill: BAND }, LineBand { lines: 20..20, fill: BAND }];
    let shapes = h.frame();
    let mut rects = Vec::new();
    fn walk(s: &Shape, out: &mut Vec<Rect>) {
        match s {
            Shape::Rect(r) if r.fill == BAND => out.push(r.rect),
            Shape::Vec(v) => v.iter().for_each(|s| walk(s, out)),
            _ => {}
        }
    }
    for s in &shapes {
        walk(s, &mut rects);
    }
    assert_eq!(rects.len(), 3, "two band rows and one bar: {rects:?}");
    let (top2, _) = h.state.line_span(2).expect("drawn");
    assert!(rects.iter().any(|r| (r.min.y - top2).abs() < 0.5));
    let (top20, _) = h.state.line_span(20).expect("drawn");
    assert!(rects.iter().any(|r| r.height() <= 2.0 && (r.center().y - top20).abs() < 1.0), "the empty band is a bar at the top of line 20");
}
