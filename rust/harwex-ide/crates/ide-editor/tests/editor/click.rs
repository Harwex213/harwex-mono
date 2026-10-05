//! The click model (user reports): every pixel of a row maps to the line drawn there, and the
//! presses of one multi-click select caret, word, then the line for good, like IDEA. The line
//! selection keeps its caret at the press (task 020).

use std::sync::Arc;

use egui::epaint::Shape;
use egui::{CentralPanel, Context, Event, FontData, FontDefinitions, FontFamily, Key, Modifiers, MouseWheelUnit, OutputCommand, PointerButton, Pos2, RawInput, Rect, Vec2};
use ide_editor::{Document, EditorAction, EditorState, EditorView, Language, Position};

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
    /// The text of the last copy to the clipboard.
    copied: Option<String>,
    /// The last action the editor reported, and its cursor.
    action: Option<EditorAction>,
    cursor: Position,
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
        let mut h = Harness { ctx, doc, state: EditorState::new(), ppp, top, events: Vec::new(), modifiers: Modifiers::NONE, time: 0.0, copied: None, action: None, cursor: Position::default() };
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
        let mut resp = None;
        let out = self.ctx.run(input, |ctx| {
            CentralPanel::default().frame(egui::Frame::NONE).show(ctx, |ui| {
                ui.add_space(top);
                let r = EditorView::new(doc, state).show(ui);
                resp = Some((r.action, r.cursor));
            });
        });
        if let Some((action, cursor)) = resp {
            if action.is_some() {
                self.action = action;
            }
            self.cursor = cursor;
        }
        for c in &out.platform_output.commands {
            if let OutputCommand::CopyText(t) = c {
                self.copied = Some(t.clone());
            }
        }
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

    fn key(&mut self, key: Key, modifiers: Modifiers) {
        self.events.push(Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers });
        self.events.push(Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers });
        self.frame(0.05);
    }

    /// A chain of `cols.len()` presses on `line`, each at its own display column (each press
    /// stays within the chain distance of the one before).
    fn chain(&mut self, line: usize, cols: &[f32]) {
        for &c in cols {
            let p = self.point(line, c);
            self.click(p, 0.1);
        }
    }

    /// The selection as (anchor, head) positions.
    fn dir_sel(&self) -> (Position, Position) {
        let s = self.state.selection();
        (self.doc.char_to_position(s.anchor), self.doc.char_to_position(s.head))
    }

    /// The x of the caret drawn on `line`, if one is drawn there.
    fn caret_x_on(&mut self, line: usize) -> Vec<f32> {
        let shapes = self.frame(0.0);
        let g = self.state.geometry().expect("drawn");
        let (top, bottom) = (g.row_top(line), g.row_top(line + 1));
        shapes
            .iter()
            .filter_map(|s| match s {
                Shape::Rect(r) if (r.rect.width() - 2.0).abs() < 0.01 && r.rect.min.y == top && r.rect.max.y == bottom => Some(r.rect.center().x),
                _ => None,
            })
            .collect()
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

/// The x of the caret boundary before `col` on `line`.
fn boundary_x(h: &Harness, line: usize, col: usize) -> f32 {
    let g = h.state.geometry().expect("drawn");
    g.char_center(&h.doc, Position::new(line, col)).x - g.char_w / 2.0
}

#[test]
fn the_line_selection_keeps_the_caret_at_each_press() {
    for ppp in [1.0_f32, 2.0] {
        let mut h = Harness::new(ppp, 0.0);
        // Presses 3, 4 and 5 land on columns 5, 6 and 7; each moves the caret, the line stays.
        let cols = [5.3, 5.3, 5.3, 5.9, 6.6];
        let want_col = [5, 0, 5, 6, 7];
        for (i, &c) in cols.iter().enumerate() {
            let p = h.point(3, c);
            h.click(p, 0.1);
            if i < 2 {
                continue;
            }
            assert_eq!(h.sel(), (pos(3, 0), pos(4, 0)), "ppp {ppp}: press {} keeps the line selected", i + 1);
            assert_eq!(h.state.cursor(), pos(3, want_col[i]), "ppp {ppp}: press {} puts the caret at the press", i + 1);
            assert_eq!(h.cursor, pos(3, want_col[i]), "ppp {ppp}: EditorResponse.cursor of press {}", i + 1);
            assert_eq!(h.state.caret_char(&h.doc), h.doc.position_to_char(pos(3, want_col[i])));
            let xs = h.caret_x_on(3);
            assert_eq!(xs.len(), 1, "ppp {ppp}: one caret on the clicked line");
            assert!((xs[0] - boundary_x(&h, 3, want_col[i])).abs() <= 1.0, "ppp {ppp}: the caret is drawn at column {}", want_col[i]);
            assert!(h.caret_x_on(4).is_empty(), "ppp {ppp}: no caret at the start of the next line");
        }
    }
}

#[test]
fn copy_cut_and_typing_act_on_the_whole_line() {
    let mut h = Harness::new(2.0, 0.0);
    h.chain(3, &[5.3, 5.3, 5.3]);
    h.events.push(Event::Copy);
    h.frame(0.05);
    assert_eq!(h.copied.as_deref(), Some("let value_3 = call(arg, other);\n"), "Cmd+C copies the line with its newline");
    h.events.push(Event::Text("x".into()));
    h.frame(0.05);
    assert_eq!(h.doc.line(3), "xlet value_4 = call(arg, other);", "typing replaces the line");
    assert_eq!(h.dir_sel(), (pos(3, 1), pos(3, 1)));

    let mut h = Harness::new(2.0, 0.0);
    h.chain(3, &[5.3, 5.3, 5.3]);
    h.events.push(Event::Cut);
    h.frame(0.05);
    assert_eq!(h.copied.as_deref(), Some("let value_3 = call(arg, other);\n"), "Cmd+X cuts the line with its newline");
    assert_eq!(h.doc.line(3), "let value_4 = call(arg, other);");
    assert_eq!(h.state.cursor(), pos(3, 0), "after an edit the caret is the plain one");

    let mut h = Harness::new(2.0, 0.0);
    h.chain(3, &[5.3, 5.3, 5.3]);
    h.key(Key::Backspace, Modifiers::NONE);
    assert_eq!(h.doc.line(3), "let value_4 = call(arg, other);", "Backspace deletes the line");
}

#[test]
fn plain_moves_start_from_the_inner_caret() {
    let cases: [(Key, Modifiers, Position); 6] = [
        (Key::ArrowLeft, Modifiers::NONE, pos(3, 4)),
        (Key::ArrowRight, Modifiers::NONE, pos(3, 6)),
        (Key::ArrowUp, Modifiers::NONE, pos(2, 5)),
        (Key::ArrowDown, Modifiers::NONE, pos(4, 5)),
        (Key::Home, Modifiers::NONE, pos(3, 0)),
        (Key::End, Modifiers::NONE, pos(3, 31)),
    ];
    for (key, m, want) in cases {
        let mut h = Harness::new(2.0, 0.0);
        h.chain(3, &[5.3, 5.3, 5.3]);
        h.key(key, m);
        assert_eq!(h.dir_sel(), (want, want), "{key:?} clears the line and moves from column 5");
        assert_eq!(h.state.cursor(), want);
    }
    // Escape keeps the caret where it is drawn.
    let mut h = Harness::new(2.0, 0.0);
    h.chain(3, &[5.3, 5.3, 5.3]);
    h.key(Key::Escape, Modifiers::NONE);
    assert_eq!(h.dir_sel(), (pos(3, 5), pos(3, 5)), "Escape drops the line and keeps the caret");
}

#[test]
fn shift_moves_anchor_at_the_line_end_away_from_the_move() {
    // Forward moves keep the line start, backward moves keep the line end (the next line start).
    let cases: [(Key, (Position, Position)); 6] = [
        (Key::ArrowRight, (pos(3, 0), pos(3, 6))),
        (Key::ArrowDown, (pos(3, 0), pos(4, 5))),
        (Key::End, (pos(3, 0), pos(3, 31))),
        (Key::ArrowLeft, (pos(4, 0), pos(3, 4))),
        (Key::ArrowUp, (pos(4, 0), pos(2, 5))),
        (Key::Home, (pos(4, 0), pos(3, 0))),
    ];
    for (key, want) in cases {
        let mut h = Harness::new(2.0, 0.0);
        h.chain(3, &[5.3, 5.3, 5.3]);
        h.key(key, Modifiers::SHIFT);
        assert_eq!(h.dir_sel(), want, "Shift+{key:?}");
        assert_eq!(h.state.cursor(), want.1, "the caret is the head after Shift+{key:?}");
        // A second Shift move extends from there like any selection.
        let before = h.dir_sel();
        h.key(key, Modifiers::SHIFT);
        assert_eq!(h.dir_sel().0, before.0, "the anchor stays after a second Shift+{key:?}");
    }
}

#[test]
fn navigation_uses_the_inner_caret() {
    let mut h = Harness::new(2.0, 0.0);
    h.chain(3, &[8.3, 8.3, 8.3]);
    h.key(Key::B, Modifiers::COMMAND);
    assert_eq!(h.action, Some(EditorAction::GoToDeclaration(pos(3, 8))), "Cmd+B asks at the drawn caret");
    assert_eq!(h.sel(), (pos(3, 0), pos(4, 0)), "Cmd+B keeps the line selected");
    assert_eq!(h.state.cursor(), pos(3, 8));
}

#[test]
fn a_drag_after_the_third_press_extends_by_lines() {
    let mut h = Harness::new(2.0, 0.0);
    let p = h.point(3, 5.3);
    h.click(p, 0.1);
    h.click(p, 0.1);
    h.button(p, true, Modifiers::NONE, 0.05);
    assert_eq!(h.state.cursor(), pos(3, 5), "the press shows the caret at the press");
    let q = h.point(6, 3.0);
    h.events.push(Event::PointerMoved(q));
    h.frame(0.05);
    assert_eq!(h.sel(), (pos(3, 0), pos(7, 0)), "the drag down extends by whole lines");
    assert_eq!(h.state.cursor(), pos(7, 0), "a dragged selection has its caret at its head");
    h.button(q, false, Modifiers::NONE, 1.0);
}

#[test]
fn alt_click_keeps_the_line_selection_and_its_caret() {
    let mut h = Harness::new(2.0, 0.0);
    h.chain(3, &[5.3, 5.3, 5.3]);
    let q = h.point(8, 2.0);
    h.click_mod(q, Modifiers::ALT, 1.0);
    let c = h.state.carets();
    assert_eq!(c.len(), 2, "Alt+click adds a caret");
    let line = c.all()[0];
    assert_eq!((h.doc.char_to_position(line.start()), h.doc.char_to_position(line.end())), (pos(3, 0), pos(4, 0)), "the line stays one selection");
    assert_eq!(h.caret_x_on(3).len(), 1, "the line keeps its caret");
    assert!((h.caret_x_on(3)[0] - boundary_x(&h, 3, 5)).abs() <= 1.0, "at the press");
    assert!(h.caret_x_on(4).is_empty());
    // Typing goes to both: the line is replaced, the caret inserts.
    h.events.push(Event::Text("z".into()));
    h.frame(0.05);
    assert_eq!(h.doc.line(3), "zlet value_4 = call(arg, other);");
    assert_eq!(h.doc.line(7), "lezt value_8 = call(arg, other);", "the caret at old line 8 inserts");
    assert_eq!(h.state.carets().len(), 2);
    // Plain arrows move both carets; the line caret moves from the press.
    let mut h = Harness::new(2.0, 0.0);
    h.chain(3, &[5.3, 5.3, 5.3]);
    let q = h.point(8, 2.0);
    h.click_mod(q, Modifiers::ALT, 1.0);
    h.key(Key::ArrowRight, Modifiers::NONE);
    let heads: Vec<Position> = h.state.carets().all().iter().map(|s| h.doc.char_to_position(s.head)).collect();
    assert_eq!(heads, vec![pos(3, 6), pos(8, 3)]);
    assert!(h.state.carets().all().iter().all(|s| s.is_empty()));
}

/// One frame per entry: seconds until the next frame and the frame's primary button events
/// (position, pressed), in order. A late frame of a real mouse carries several of them.
type Frames = Vec<(f64, Vec<(Pos2, bool)>)>;

impl Harness {
    /// Runs one frame with the given primary button events, then lets `dt` seconds pass.
    fn pointer_frame(&mut self, dt: f64, buttons: &[(Pos2, bool)]) {
        for &(p, pressed) in buttons {
            self.events.push(Event::PointerMoved(p));
            self.events.push(Event::PointerButton { pos: p, button: PointerButton::Primary, pressed, modifiers: Modifiers::NONE });
        }
        self.frame(dt);
    }
}

/// The presses of one chain, split into frames in the ways a late frame merges them (the cases
/// of the app's `shell::fast_double_clicks_toggle_once`, for any number of presses).
fn merged_frame_cases(presses: &[Pos2]) -> Vec<(String, Frames)> {
    let events: Vec<(Pos2, bool)> = presses.iter().flat_map(|&p| [(p, true), (p, false)]).collect();
    // Splits the events into frames of the given sizes; the last frame takes the rest.
    let split = |sizes: &mut dyn Iterator<Item = usize>, dt: f64| -> Frames {
        let mut frames = Vec::new();
        let mut rest = &events[..];
        while !rest.is_empty() {
            let n = sizes.next().unwrap_or(rest.len()).min(rest.len());
            frames.push((dt, rest[..n].to_vec()));
            rest = &rest[n..];
        }
        frames
    };
    let mut cases = vec![
        ("all events in one frame".to_string(), split(&mut std::iter::empty(), 0.016)),
        // [down], [up, down], ..., [up]: each release shares a frame with the next press.
        ("each release with the next press".to_string(), split(&mut std::iter::once(1).chain(std::iter::repeat(2)), 0.08)),
        // [down, up, down], [up, down, up], ...: a press in the frame of the click before.
        ("three events per frame".to_string(), split(&mut std::iter::repeat(3), 0.08)),
        // [down], [up, down, up], [down, up, down], ...: a click in the frame of the release before.
        ("a click in the frame of the release before".to_string(), split(&mut std::iter::once(1).chain(std::iter::repeat(3)), 0.08)),
    ];
    for gap in [0.008, 0.016, 0.030] {
        cases.push((format!("one event per frame, {gap} s apart"), split(&mut std::iter::repeat(1), gap)));
        cases.push((format!("one click per frame, {gap} s apart"), split(&mut std::iter::repeat(2), gap)));
    }
    cases
}

#[test]
fn every_press_of_a_merged_frame_counts() {
    let mut failed = Vec::new();
    for ppp in [1.0_f32, 2.0] {
        // The last press lands one column on, so the line case shows where the caret stays.
        let h = Harness::new(ppp, 0.0);
        let (p, q) = (h.point(3, 5.3), h.point(3, 5.9));
        let word = ((pos(3, 4), pos(3, 11)), pos(3, 11));
        let line = |col| ((pos(3, 0), pos(4, 0)), pos(3, col));
        let chains = [(vec![p, q], word), (vec![p, p, q], line(6)), (vec![p, p, p, q], line(6)), (vec![p, p, q, p], line(5))];
        for (presses, (want_sel, want_caret)) in chains {
            for (name, frames) in merged_frame_cases(&presses) {
                let mut h = Harness::new(ppp, 0.0);
                for (dt, buttons) in &frames {
                    h.pointer_frame(*dt, buttons);
                }
                h.frame(0.05);
                let got = (h.sel(), h.state.cursor());
                if got != (want_sel, want_caret) {
                    failed.push(format!("ppp {ppp}, {} presses, {name}: selection and caret {got:?}, want {:?}", presses.len(), (want_sel, want_caret)));
                }
                // The chain ends with its last press: a click after the interval is a single click.
                h.frame(INTERVAL + 0.1);
                h.click(p, 1.0);
                if h.sel() != (pos(3, 5), pos(3, 5)) {
                    failed.push(format!("ppp {ppp}, {} presses, {name}: a later click is a single click, got {:?}", presses.len(), h.sel()));
                }
            }
        }
    }
    assert!(failed.is_empty(), "{} failures:\n{}", failed.len(), failed.join("\n"));
}
