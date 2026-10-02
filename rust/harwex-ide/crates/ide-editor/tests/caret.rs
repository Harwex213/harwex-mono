//! Caret drift regression (user report): the longer the line, the further the caret and mouse
//! hit-testing moved away from the drawn glyphs. egui snaps every glyph to the pixel grid, so the
//! column math must use the laid-out advance, not the font's nominal glyph width.
//!
//! The test reads the painted shapes: the caret rect and the line galley's glyph positions.

use std::sync::Arc;

use egui::epaint::{Shape, TextShape};
use egui::{CentralPanel, Context, Event, FontData, FontDefinitions, FontFamily, Modifiers, PointerButton, Pos2, RawInput, Rect, Vec2};
use ide_editor::{Document, EditorState, EditorTheme, EditorView, Language, Position};

const LINE_LEN: usize = 300;

fn line_text() -> String {
    // Mixed glyphs, so a font with per-glyph differences would show up too.
    let unit = "let value_1 = call(arg, \"str\"); // ok ";
    unit.repeat(LINE_LEN / unit.len() + 1).chars().take(LINE_LEN).collect()
}

struct Harness {
    ctx: Context,
    doc: Document,
    state: EditorState,
    ppp: f32,
    events: Vec<Event>,
    time: f64,
}

impl Harness {
    fn new(ppp: f32, jetbrains_mono: bool) -> Harness {
        let ctx = Context::default();
        if jetbrains_mono {
            let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../app/assets/fonts/JetBrainsMono-Regular.ttf");
            let bytes = std::fs::read(path).expect("the app bundles JetBrains Mono");
            let mut fonts = FontDefinitions::default();
            fonts.font_data.insert("jbm".into(), Arc::new(FontData::from_owned(bytes)));
            fonts.families.get_mut(&FontFamily::Monospace).expect("monospace family").insert(0, "jbm".into());
            ctx.set_fonts(fonts);
        }
        let text = format!("{}\nshort line\n", line_text());
        let doc = Document::from_text(&text, Language::TypeScript);
        Harness { ctx, doc, state: EditorState::new(), ppp, events: Vec::new(), time: 0.0 }
    }

    fn frame(&mut self) -> Vec<Shape> {
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(2800.0, 300.0))),
            events: std::mem::take(&mut self.events),
            // Far apart frames: two clicks never merge into a double click.
            time: Some(self.time),
            ..Default::default()
        };
        self.time += 1.0;
        self.ctx.set_pixels_per_point(self.ppp);
        let (doc, state) = (&mut self.doc, &mut self.state);
        let out = self.ctx.run(input, |ctx| {
            CentralPanel::default().show(ctx, |ui| {
                EditorView::new(doc, state).show(ui);
            });
        });
        let mut shapes = Vec::new();
        for c in out.shapes {
            flatten(c.shape, &mut shapes);
        }
        shapes
    }

    fn caret_at(&mut self, column: usize) -> Vec<Shape> {
        let p = Position::new(0, column);
        self.state.set_selection(p, p);
        self.frame();
        self.frame()
    }
}

fn flatten(shape: Shape, out: &mut Vec<Shape>) {
    match shape {
        Shape::Vec(v) => v.into_iter().for_each(|s| flatten(s, out)),
        s => out.push(s),
    }
}

/// The galley of the long line and the x of the caret rect.
fn find(shapes: &[Shape]) -> (TextShape, f32) {
    let text = shapes
        .iter()
        .find_map(|s| match s {
            Shape::Text(t) if t.galley.job.text.len() == LINE_LEN => Some(t.clone()),
            _ => None,
        })
        .expect("the long line is drawn");
    let caret = EditorTheme::default().caret_unfocused();
    let caret_x = shapes
        .iter()
        .find_map(|s| match s {
            Shape::Rect(r) if (r.rect.width() - 2.0).abs() < 0.01 && r.fill == caret => Some(r.rect.center().x),
            _ => None,
        })
        .expect("the caret is drawn");
    (text, caret_x)
}

fn glyph_x(text: &TextShape, column: usize) -> f32 {
    let glyphs = &text.galley.rows[0].glyphs;
    match glyphs.get(column) {
        Some(g) => text.pos.x + g.pos.x,
        None => {
            let last = glyphs.last().expect("glyphs");
            text.pos.x + last.pos.x + last.advance_width
        }
    }
}

fn check(ppp: f32, jetbrains_mono: bool) {
    let mut h = Harness::new(ppp, jetbrains_mono);
    h.frame();
    let mut worst = 0.0_f32;
    for column in [0, 1, 7, 50, 120, 199, 250, 299, LINE_LEN] {
        let shapes = h.caret_at(column);
        let (text, caret_x) = find(&shapes);
        let expected = glyph_x(&text, column);
        let err = (caret_x - expected).abs();
        worst = worst.max(err);
        assert!(err <= 0.5, "ppp {ppp}, jbm {jetbrains_mono}: caret at column {column} is at x {caret_x}, the glyph at {expected} ({err} px off)");
    }

    // A click just right of a glyph's left edge puts the caret before that glyph.
    let shapes = h.frame();
    let (text, _) = find(&shapes);
    let row_y = text.pos.y + text.galley.rows[0].rect.center().y;
    for column in [3, 90, 180, 260, 298] {
        let g = text.galley.rows[0].glyphs[column];
        let p = Pos2::new(text.pos.x + g.pos.x + g.advance_width * 0.3, row_y);
        h.events.push(Event::PointerMoved(p));
        h.frame();
        h.events.push(Event::PointerButton { pos: p, button: PointerButton::Primary, pressed: true, modifiers: Modifiers::NONE });
        h.frame();
        h.events.push(Event::PointerButton { pos: p, button: PointerButton::Primary, pressed: false, modifiers: Modifiers::NONE });
        h.frame();
        assert_eq!(h.state.cursor(), Position::new(0, column), "ppp {ppp}, jbm {jetbrains_mono}: click on glyph {column}");
    }
    // The geometry the app and the UI tests use agrees with the glyphs too.
    let g = h.state.geometry().expect("drawn");
    let center = g.char_center(&h.doc, Position::new(0, 250));
    let gl = text.galley.rows[0].glyphs[250];
    let expected = text.pos.x + gl.pos.x + gl.advance_width / 2.0;
    assert!((center.x - expected).abs() <= 1.0, "char_center {} vs glyph center {expected}", center.x);
    eprintln!("ppp {ppp}, jbm {jetbrains_mono}: worst caret error {worst:.2} px");
}

#[test]
fn caret_matches_glyphs_on_a_long_line() {
    check(1.0, false);
    check(2.0, false);
}

#[test]
fn caret_matches_glyphs_with_jetbrains_mono() {
    check(1.0, true);
    check(2.0, true);
    check(1.5, true);
}
