//! The click model (user reports): every pixel of a row maps to the line drawn there, and the
//! presses of one multi-click select caret, word, then the line for good, like IDEA.

use std::sync::Arc;

use egui::epaint::Shape;
use egui::{CentralPanel, Context, Event, FontData, FontDefinitions, FontFamily, Modifiers, MouseWheelUnit, PointerButton, Pos2, RawInput, Rect, Vec2};
use ide_editor::{Document, EditorState, EditorView, Language, Position};

/// The macOS default double-click interval; the app sets egui's to the system value.
const INTERVAL: f64 = 0.5;

struct Harness {
    ctx: Context,
    doc: Document,
    state: EditorState,
    ppp: f32,
    /// Space above the editor, so its top can sit between pixels.
    top: f32,
    events: Vec<Event>,
    modifiers: Modifiers,
    time: f64,
}

impl Harness {
    fn new(ppp: f32, top: f32) -> Harness {
        let ctx = Context::default();
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../app/assets/fonts/JetBrainsMono-Regular.ttf");
        let bytes = std::fs::read(path).expect("the app bundles JetBrains Mono");
        let mut fonts = FontDefinitions::default();
        fonts.font_data.insert("jbm".into(), Arc::new(FontData::from_owned(bytes)));
        fonts.families.get_mut(&FontFamily::Monospace).expect("monospace family").insert(0, "jbm".into());
        ctx.set_fonts(fonts);
        ctx.options_mut(|o| o.input_options.max_double_click_delay = INTERVAL);
        let text: String = (0..60).map(|i| format!("let value_{i} = call(arg, other);\n")).collect();
        let doc = Document::from_text(&text, Language::TypeScript);
        let mut h = Harness { ctx, doc, state: EditorState::new(), ppp, top, events: Vec::new(), modifiers: Modifiers::NONE, time: 0.0 };
        h.frame(1.0);
        h.frame(1.0);
        h
    }

    /// Runs a frame, then lets `dt` seconds pass.
    fn frame(&mut self, dt: f64) -> Vec<Shape> {
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(800.0, 400.0))),
            events: std::mem::take(&mut self.events),
            modifiers: self.modifiers,
            time: Some(self.time),
            ..Default::default()
        };
        self.time += dt;
        self.ctx.set_pixels_per_point(self.ppp);
        let (doc, state, top) = (&mut self.doc, &mut self.state, self.top);
        let out = self.ctx.run(input, |ctx| {
            CentralPanel::default().frame(egui::Frame::NONE).show(ctx, |ui| {
                ui.add_space(top);
                EditorView::new(doc, state).show(ui);
            });
        });
        let mut shapes = Vec::new();
        for c in out.shapes {
            flatten(c.shape, &mut shapes);
        }
        shapes
    }

    fn button(&mut self, p: Pos2, pressed: bool, modifiers: Modifiers, dt: f64) {
        self.events.push(Event::PointerMoved(p));
        self.events.push(Event::PointerButton { pos: p, button: PointerButton::Primary, pressed, modifiers });
        self.frame(dt);
    }

    /// A press and a release, `gap` seconds before the next press.
    fn click_mod(&mut self, p: Pos2, modifiers: Modifiers, gap: f64) {
        self.modifiers = modifiers;
        self.button(p, true, modifiers, 0.05);
        self.button(p, false, modifiers, gap - 0.05);
        self.modifiers = Modifiers::NONE;
    }

    fn click(&mut self, p: Pos2, gap: f64) {
        self.click_mod(p, Modifiers::NONE, gap);
    }

    /// A point at display column `col` (fractional) in the middle of `line`'s row.
    fn point(&self, line: usize, col: f32) -> Pos2 {
        let g = self.state.geometry().expect("drawn");
        let c = g.char_center(&self.doc, Position::new(line, 0));
        Pos2::new(c.x + (col - 0.5) * g.char_w, c.y)
    }

    fn sel(&self) -> (Position, Position) {
        let s = self.state.selection();
        (self.doc.char_to_position(s.start()), self.doc.char_to_position(s.end()))
    }
}

fn flatten(shape: Shape, out: &mut Vec<Shape>) {
    match shape {
        Shape::Vec(v) => v.into_iter().for_each(|s| flatten(s, out)),
        s => out.push(s),
    }
}

/// The caret rect: 2 points wide, one row tall.
fn caret_rect(shapes: &[Shape]) -> Rect {
    shapes
        .iter()
        .find_map(|s| match s {
            Shape::Rect(r) if (r.rect.width() - 2.0).abs() < 0.01 => Some(r.rect),
            _ => None,
        })
        .expect("the caret is drawn")
}

fn pos(line: usize, column: usize) -> Position {
    Position::new(line, column)
}

#[test]
fn every_pixel_maps_to_the_line_drawn_there() {
    for ppp in [1.0_f32, 1.5, 2.0] {
        for top in [0.0_f32, 0.3, 0.5, 0.7] {
            for scroll in [0.0_f32, 3.3, 7.5] {
                let mut h = Harness::new(ppp, top);
                if scroll > 0.0 {
                    h.events.push(Event::PointerMoved(Pos2::new(300.0, 100.0)));
                    h.events.push(Event::MouseWheel { unit: MouseWheelUnit::Point, delta: Vec2::new(0.0, -scroll), modifiers: Modifiers::NONE });
                    for _ in 0..3 {
                        h.frame(1.0);
                    }
                }
                let g = h.state.geometry().expect("drawn");
                // Quarter-pixel steps over five rows: pointer positions are fractional points.
                let steps = (5.0 * g.line_h * ppp * 4.0) as i32;
                let x = h.point(0, 4.0).x;
                for k in 0..steps {
                    let y = g.text_rect.min.y + 1.0 + k as f32 / (ppp * 4.0);
                    // Clicks one second apart never form a chain.
                    h.click(Pos2::new(x, y), 1.0);
                    let shapes = h.frame(1.0);
                    let row = caret_rect(&shapes);
                    let line = h.state.cursor().line;
                    assert!(
                        row.min.y <= y && y < row.max.y,
                        "ppp {ppp}, top {top}, scroll {scroll}: a click at y {y} put the caret on line {line}, drawn at {}..{}",
                        row.min.y,
                        row.max.y
                    );
                    assert!(h.state.selection().is_empty(), "a single click selects nothing");
                    let g = h.state.geometry().expect("drawn");
                    assert_eq!((g.row_top(line), g.row_top(line + 1)), (row.min.y, row.max.y), "geometry agrees with the drawn row");
                    assert_eq!(g.line_at(y), line as isize, "geometry hit test");
                }
            }
        }
    }
}

#[test]
fn a_click_chain_selects_word_then_line() {
    for ppp in [1.0_f32, 2.0] {
        // 0.4 s between presses: inside the system interval, past egui's 0.3 s default.
        for gap in [0.1, 0.4] {
            let mut h = Harness::new(ppp, 0.0);
            let p = h.point(3, 5.3);
            let expected = [(pos(3, 5), pos(3, 5)), (pos(3, 4), pos(3, 11)), (pos(3, 0), pos(4, 0)), (pos(3, 0), pos(4, 0)), (pos(3, 0), pos(4, 0))];
            for (i, want) in expected.into_iter().enumerate() {
                // Every press of the chain shows its selection already while the button is down.
                h.button(p, true, Modifiers::NONE, 0.05);
                assert_eq!(h.sel(), want, "ppp {ppp}, gap {gap}: press {} of the chain", i + 1);
                h.button(p, false, Modifiers::NONE, gap - 0.05);
                assert_eq!(h.sel(), want, "ppp {ppp}, gap {gap}: click {} of the chain", i + 1);
            }
            // A click after the chain has ended is a single click.
            h.frame(INTERVAL + 0.1);
            h.click(p, 1.0);
            assert_eq!(h.sel(), (pos(3, 5), pos(3, 5)), "a click after the chain timeout");
        }
    }
}

#[test]
fn quick_clicks_at_different_spots_are_single_clicks() {
    let mut h = Harness::new(2.0, 0.0);
    for (line, col) in [(1, 2.0), (5, 9.0), (9, 16.0)] {
        let p = h.point(line, col + 0.3);
        h.click(p, 0.1);
        assert_eq!(h.sel(), (pos(line, col as usize), pos(line, col as usize)), "a click on line {line} far from the last one");
    }
}

#[test]
fn modified_clicks_keep_their_meaning() {
    let mut h = Harness::new(2.0, 0.0);
    let p = h.point(3, 5.3);
    h.click(p, 0.1);
    h.click(p, 0.1);
    assert_eq!(h.sel(), (pos(3, 4), pos(3, 11)), "double click");
    // Alt+click adds a caret and does not continue the chain.
    let q = h.point(6, 2.0);
    h.click_mod(q, Modifiers::ALT, 0.1);
    assert_eq!(h.state.carets().all().len(), 2, "Alt+click adds a caret");
    assert_eq!(h.sel(), (pos(6, 2), pos(6, 2)), "the new caret is the primary");
    // Shift+click extends from the anchor and does not continue the chain either.
    h.click(p, 1.0);
    let r = h.point(5, 3.0);
    h.click_mod(r, Modifiers::SHIFT, 0.1);
    assert_eq!(h.sel(), (pos(3, 5), pos(5, 3)), "Shift+click extends");
    h.click_mod(r, Modifiers::SHIFT, 0.1);
    assert_eq!(h.sel(), (pos(3, 5), pos(5, 3)), "a second Shift+click is no word selection");
    // A plain click right after Shift+click starts a new chain.
    h.click(r, 0.1);
    assert_eq!(h.sel(), (pos(5, 3), pos(5, 3)), "a plain click after Shift+click");
}

#[test]
fn a_drag_after_a_double_or_triple_press_extends_by_words_or_lines() {
    let mut h = Harness::new(2.0, 0.0);
    let p = h.point(3, 5.3);
    h.click(p, 0.1);
    h.button(p, true, Modifiers::NONE, 0.05);
    let q = h.point(3, 15.3);
    h.events.push(Event::PointerMoved(q));
    h.frame(0.05);
    assert_eq!(h.sel(), (pos(3, 4), pos(3, 18)), "the drag extends to the end of the word under the pointer");
    h.button(q, false, Modifiers::NONE, 1.0);

    h.click(p, 0.1);
    h.click(p, 0.1);
    h.button(p, true, Modifiers::NONE, 0.05);
    let q = h.point(1, 3.0);
    h.events.push(Event::PointerMoved(q));
    h.frame(0.05);
    assert_eq!(h.sel(), (pos(1, 0), pos(4, 0)), "the drag up extends by whole lines");
    h.button(q, false, Modifiers::NONE, 1.0);
}
