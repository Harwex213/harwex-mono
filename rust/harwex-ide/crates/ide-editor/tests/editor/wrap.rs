//! Soft wrap (task 040): Markdown and plain text break into visual rows at the editor width.
//! Rows, the gutter, caret moves, clicks, selection, find, problems, resize and the toggle on
//! wrapped rows. The break rules themselves are unit tests in `src/wrap.rs`.

use std::sync::Arc;

use egui::epaint::Shape;
use egui::{CentralPanel, Context, Event, FontData, FontDefinitions, FontFamily, Key, Modifiers, PointerButton, Pos2, RawInput, Rect, Vec2};
use ide_editor::wrap::{breaks, LineRows};
use ide_editor::{Carets, Document, EditorState, EditorTheme, EditorView, Language, Position, ProblemMark, ProblemSeverity, Selection};

const PARAGRAPH: &str = "Soft wrap breaks a long line of prose into visual rows at the width of the editor, \
at word boundaries when it can, and keeps the line numbers on the first row of every logical line, \
the way IntelliJ IDEA does for Markdown and plain text files out of the box.";

fn markdown() -> String {
    let mut s = format!("# Title\n\n{PARAGRAPH}\n  - an item {PARAGRAPH}\nshort\n");
    for i in 0..80 {
        s.push_str(&format!("line {i} {PARAGRAPH}\n"));
    }
    s
}

struct Harness {
    ctx: Context,
    doc: Document,
    state: EditorState,
    width: f32,
    events: Vec<Event>,
    modifiers: Modifiers,
    time: f64,
    problems: Vec<ProblemMark>,
    /// The last gutter click and the hover position of the last frame.
    gutter: Option<usize>,
    hover: Option<Position>,
}

impl Harness {
    fn new(text: &str, language: Language, width: f32) -> Harness {
        let ctx = Context::default();
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../app/assets/fonts/JetBrainsMono-Regular.ttf");
        let bytes = std::fs::read(path).expect("the app bundles JetBrains Mono");
        let mut fonts = FontDefinitions::default();
        fonts.font_data.insert("jbm".into(), Arc::new(FontData::from_owned(bytes)));
        fonts.families.get_mut(&FontFamily::Monospace).expect("monospace family").insert(0, "jbm".into());
        ctx.set_fonts(fonts);
        let doc = Document::from_text(text, language);
        let mut state = EditorState::new();
        state.set_soft_wrap(true);
        state.request_focus();
        let mut h = Harness { ctx, doc, state, width, events: Vec::new(), modifiers: Modifiers::NONE, time: 0.0, problems: Vec::new(), gutter: None, hover: None };
        h.frame();
        h.frame();
        h
    }

    fn frame(&mut self) -> Vec<Shape> {
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(self.width, 400.0))),
            events: std::mem::take(&mut self.events),
            modifiers: self.modifiers,
            time: Some(self.time),
            ..Default::default()
        };
        // Far apart frames: clicks never chain.
        self.time += 1.0;
        let (doc, state, problems) = (&mut self.doc, &mut self.state, &self.problems);
        let mut resp = None;
        let out = self.ctx.run(input, |ctx| {
            CentralPanel::default().frame(egui::Frame::NONE).show(ctx, |ui| {
                let r = EditorView::new(doc, state).problems(problems).show(ui);
                resp = Some((r.gutter_clicked, r.hover));
            });
        });
        if let Some((gutter, hover)) = resp {
            self.gutter = gutter.or(self.gutter);
            self.hover = hover;
        }
        let mut shapes = Vec::new();
        for c in out.shapes {
            flatten(c.shape, &mut shapes);
        }
        shapes
    }

    fn key(&mut self, key: Key, modifiers: Modifiers) {
        self.events.push(Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers });
        self.events.push(Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers });
        self.frame();
    }

    fn button(&mut self, p: Pos2, pressed: bool, modifiers: Modifiers) {
        self.modifiers = modifiers;
        self.events.push(Event::PointerMoved(p));
        self.events.push(Event::PointerButton { pos: p, button: PointerButton::Primary, pressed, modifiers });
        // A release soon after the press is a click; frames far apart never chain clicks.
        let next = self.time + if pressed { 0.05 } else { 1.0 };
        self.frame();
        self.time = next;
        self.modifiers = Modifiers::NONE;
    }

    fn click(&mut self, p: Pos2, modifiers: Modifiers) {
        self.button(p, true, modifiers);
        self.button(p, false, modifiers);
    }

    fn caret(&mut self, line: usize, column: usize) {
        let p = Position::new(line, column);
        self.state.set_selection(p, p);
        self.frame();
    }

    fn cursor(&self) -> (usize, usize) {
        let c = self.state.cursor();
        (c.line, c.column)
    }

    fn center(&self, line: usize, column: usize) -> Pos2 {
        self.state.char_center(&self.doc, Position::new(line, column)).expect("drawn")
    }

    /// A point just right of the left edge of a char: a click there puts the caret before it.
    fn before(&self, line: usize, column: usize) -> Pos2 {
        let g = self.state.geometry().expect("drawn");
        self.center(line, column) - Vec2::new(g.char_w * 0.3, 0.0)
    }

    /// The visual row of the drawn caret (a 2 pt wide rect in the text area).
    fn caret_row(&mut self) -> usize {
        let shapes = self.frame();
        let g = self.state.geometry().expect("drawn");
        let r = shapes
            .iter()
            .find_map(|s| match s {
                Shape::Rect(r) if (r.rect.width() - 2.0).abs() < 0.01 && g.text_rect.contains(r.rect.center()) => Some(r.rect),
                _ => None,
            })
            .expect("a caret is drawn");
        g.line_at(r.center().y) as usize
    }

    fn rows(&self, line: usize) -> LineRows {
        LineRows::new(&self.doc.line(line), self.state.wrap_cols().expect("wrapped"))
    }
}

fn flatten(shape: Shape, out: &mut Vec<Shape>) {
    match shape {
        Shape::Vec(v) => v.into_iter().for_each(|s| flatten(s, out)),
        s => out.push(s),
    }
}

/// The texts painted in `rect`, top to bottom, with their y.
fn texts_in(shapes: &[Shape], rect: Rect) -> Vec<(f32, String)> {
    let mut out: Vec<(f32, String)> = shapes
        .iter()
        .filter_map(|s| match s {
            Shape::Text(t) if rect.contains(t.pos + Vec2::new(1.0, 1.0)) => Some((t.pos.y, t.galley.text().to_string())),
            _ => None,
        })
        .collect();
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out
}

fn filled(shapes: &[Shape], color: egui::Color32) -> Vec<Rect> {
    shapes
        .iter()
        .filter_map(|s| match s {
            Shape::Rect(r) if r.fill == color => Some(r.rect),
            _ => None,
        })
        .collect()
}

#[test]
fn rows_follow_the_breaks_and_numbers_sit_on_first_rows() {
    let mut h = Harness::new(&markdown(), Language::Markdown, 640.0);
    let cols = h.state.wrap_cols().expect("Markdown wraps");
    let g = h.state.geometry().expect("drawn");
    assert!(cols * 2 < PARAGRAPH.len(), "the paragraph needs three rows or more at {cols} columns");
    // Rows end inside the text area.
    assert!(g.text_rect.left() + 6.0 + cols as f32 * g.char_w <= g.text_rect.right());

    let text = h.doc.line(2);
    let b = breaks(&text, cols);
    assert!(b.len() >= 3);
    let shapes = h.frame();
    let painted = texts_in(&shapes, g.text_rect);
    let chars: Vec<char> = text.chars().collect();
    for (k, r) in b.iter().enumerate() {
        let end = b.get(k + 1).map_or(chars.len(), |n| n.char);
        let row: String = chars[r.char..end].iter().collect();
        assert!(painted.iter().any(|(_, t)| *t == row), "row {k} {row:?} is painted as one galley");
        assert!(row.chars().count() <= cols + 1, "row {k} fits (a trailing space may hang)");
        // Each row starts at the left edge, one row below the one before.
        let c = h.center(2, r.char);
        assert!((c.x - (g.origin.x + g.char_w / 2.0)).abs() < 1.0, "row {k} starts at the left edge");
        assert_eq!(h.state.visual_row(&h.doc, Position::new(2, r.char)), 2 + k);
    }
    assert_eq!(h.state.visual_row(&h.doc, Position::new(3, 0)), 2 + b.len(), "line 3 starts after line 2's rows");

    // Continuation rows of the indented item keep its indent.
    let item = h.rows(3);
    assert_eq!(item.indent, 2);
    let c1 = h.center(3, item.starts[1].char);
    assert!((c1.x - (g.origin.x + 2.5 * g.char_w)).abs() < 1.0, "continuation rows are indented");

    // The gutter numbers each line once, on its first row.
    let numbers: Vec<String> = texts_in(&shapes, g.gutter_rect).into_iter().map(|(_, t)| t).collect();
    assert_eq!(numbers[..5], ["1", "2", "3", "4", "5"]);
    let ys: Vec<f32> = texts_in(&shapes, g.gutter_rect).into_iter().map(|(y, _)| y).collect();
    assert!((ys[3] - ys[2] - b.len() as f32 * g.line_h).abs() < 1.0, "line 4's number sits below line 3's rows");
}

#[test]
fn up_down_home_end_move_by_visual_rows() {
    let mut h = Harness::new(&markdown(), Language::Markdown, 640.0);
    let r = h.rows(2);
    let s1 = r.starts[1].char;
    let s2 = r.starts[2].char;
    h.caret(2, s1 + 3);
    h.key(Key::ArrowDown, Modifiers::NONE);
    assert_eq!(h.cursor(), (2, s2 + 3), "Down goes to the next visual row of the same line");
    h.key(Key::ArrowUp, Modifiers::NONE);
    h.key(Key::ArrowUp, Modifiers::NONE);
    assert_eq!(h.cursor(), (2, 3), "Up reaches the first row");
    h.key(Key::ArrowUp, Modifiers::NONE);
    assert_eq!(h.cursor(), (1, 0), "then the empty line above");

    // Home: the visual row start first, then the logical line.
    h.caret(2, s1 + 5);
    h.key(Key::Home, Modifiers::NONE);
    assert_eq!(h.cursor(), (2, s1));
    h.key(Key::Home, Modifiers::NONE);
    assert_eq!(h.cursor(), (2, 0));
    // End: the end of the visual row first (after its trailing space, drawn on that row),
    // then the line end.
    h.caret(2, s1 + 5);
    h.key(Key::End, Modifiers::NONE);
    assert_eq!(h.cursor(), (2, s2));
    assert_eq!(h.caret_row(), 3, "the caret is drawn at the end of row 1, not at the start of row 2");
    h.key(Key::End, Modifiers::NONE);
    assert_eq!(h.cursor(), (2, h.doc.line_len(2)));
    // Cmd+Left and Cmd+Right are Home and End on macOS.
    h.caret(2, s1 + 5);
    h.key(Key::ArrowLeft, Modifiers::COMMAND);
    assert_eq!(h.cursor(), (2, s1));

    // Down from the last row of a line lands on the first row of the next line.
    let last = r.starts[r.count() - 1].char;
    h.caret(2, last + 1);
    h.key(Key::ArrowDown, Modifiers::NONE);
    assert_eq!(h.cursor(), (3, 1));
}

#[test]
fn clicks_land_on_continuation_rows() {
    let mut h = Harness::new(&markdown(), Language::Markdown, 640.0);
    let r = h.rows(2);
    let (s1, s2) = (r.starts[1].char, r.starts[2].char);
    let p = h.before(2, s1 + 4);
    h.click(p, Modifiers::NONE);
    assert_eq!(h.cursor(), (2, s1 + 4));
    // A click right of a row's end puts the caret at that row's end, drawn on that row.
    let g = h.state.geometry().expect("drawn");
    let p = Pos2::new(g.text_rect.right() - 20.0, h.center(2, s1).y);
    h.click(p, Modifiers::NONE);
    assert_eq!(h.cursor(), (2, s2));
    assert_eq!(h.caret_row(), 3);
    // A click left of an indented continuation row goes to its start.
    let item = h.rows(3);
    let p = Pos2::new(g.origin.x + 1.0, h.center(3, item.starts[1].char).y);
    h.click(p, Modifiers::NONE);
    assert_eq!(h.cursor(), (3, item.starts[1].char));
    // The gutter reports the logical line of a continuation row.
    let cont = Pos2::new(g.mark_x + 2.0, h.center(2, s2).y);
    h.click(cont, Modifiers::NONE);
    assert_eq!(h.gutter, Some(2));
    // Hover names the char under the pointer on a continuation row.
    h.events.push(Event::PointerMoved(h.center(2, s1 + 2)));
    h.frame();
    assert_eq!(h.hover, Some(Position::new(2, s1 + 2)));
}

#[test]
fn selection_across_rows_paints_each_row() {
    let mut h = Harness::new(&markdown(), Language::Markdown, 640.0);
    let r = h.rows(2);
    let (s1, s2) = (r.starts[1].char, r.starts[2].char);
    // Drag from row 0 to row 2.
    let from = h.before(2, 4);
    let to = h.before(2, s2 + 6);
    h.button(from, true, Modifiers::NONE);
    h.events.push(Event::PointerMoved(to));
    h.frame();
    h.button(to, false, Modifiers::NONE);
    let sel = h.state.selection();
    let ls = h.doc.line_start(2);
    assert_eq!(sel.range(), ls + 4..ls + s2 + 6);
    let shapes = h.frame();
    let rects = filled(&shapes, EditorTheme::default().selection);
    assert_eq!(rects.len(), 3, "one selection rect per row: {rects:?}");
    let g = h.state.geometry().expect("drawn");
    let row1 = rects.iter().find(|q| q.contains(h.center(2, s1 + 1))).expect("row 1 is selected");
    assert!((row1.left() - g.origin.x).abs() < 1.0, "row 1 is selected from its start");

    // Shift+Down extends by a visual row.
    h.caret(2, 2);
    h.key(Key::ArrowDown, Modifiers::SHIFT);
    assert_eq!(h.state.selection().range(), ls + 2..ls + s1 + 2);
}

#[test]
fn carets_find_and_problems_on_wrapped_rows() {
    let mut h = Harness::new(&markdown(), Language::Markdown, 640.0);
    let r = h.rows(2);
    let (s1, s2) = (r.starts[1].char, r.starts[2].char);
    // Alt+click adds a caret on a continuation row.
    h.caret(2, 0);
    let p = h.before(2, s1 + 2);
    h.click(p, Modifiers::ALT);
    assert_eq!(h.state.carets().len(), 2);
    h.events.push(Event::Text("X".into()));
    h.frame();
    let line = h.doc.line(2);
    assert!(line.starts_with('X'));
    assert_eq!(line.chars().nth(s1 + 3), Some('X'), "the second caret typed on row 1");

    // A find match on row 2 is painted on row 2.
    h.state.set_carets(Carets::single(Selection::caret(0)));
    let word: String = h.doc.line(2).chars().skip(s2 + 1).take(4).collect();
    h.state.open_find(&h.doc, false);
    h.state.find_mut().set_query(&word);
    h.state.find_refresh(&mut h.doc, true);
    h.frame();
    let shapes = h.frame();
    let theme = EditorTheme::default();
    let marks: Vec<Rect> = [filled(&shapes, theme.find_match), filled(&shapes, theme.find_current), filled(&shapes, theme.selection)].concat();
    let at = h.center(2, s2 + 2);
    assert!(marks.iter().any(|q| q.contains(at)), "the match on row 2 is highlighted where it is drawn");
    h.state.close_find();

    // A problem across a row boundary underlines both rows.
    let ls = h.doc.line_start(2);
    h.problems = vec![ProblemMark { start: ls + s1 - 3, end: ls + s1 + 3, severity: ProblemSeverity::Error }];
    let shapes = h.frame();
    let red = theme.problem(ProblemSeverity::Error);
    let waves: Vec<Rect> = shapes
        .iter()
        .filter_map(|s| match s {
            Shape::Path(p) if p.stroke.color == egui::epaint::ColorMode::Solid(red) => Some(Rect::from_points(&p.points)),
            _ => None,
        })
        .collect();
    assert_eq!(waves.len(), 2, "one wave per row: {waves:?}");
    let (y0, y1) = (h.center(2, s1 - 1).y, h.center(2, s1 + 1).y);
    assert!(waves.iter().any(|w| (w.center().y - y0).abs() < h.state.geometry().expect("drawn").line_h));
    assert!(waves.iter().any(|w| w.center().y > y1));
}

#[test]
fn resize_rewraps_and_keeps_the_top_line() {
    let mut h = Harness::new(&markdown(), Language::Markdown, 900.0);
    let wide = h.state.wrap_cols().expect("wrapped");
    let rows_wide = h.state.visual_row(&h.doc, Position::new(5, 0));
    // Scroll so line 40 is at the top.
    h.state.reveal(Position::new(40, 0));
    h.frame();
    h.frame();
    let top_line = |h: &Harness| {
        let g = h.state.geometry().expect("drawn");
        (0..h.doc.line_count()).find(|&l| h.center(l, 0).y >= g.text_rect.top()).expect("a line on screen")
    };
    let before = top_line(&h);
    h.width = 500.0;
    h.frame();
    h.frame();
    let narrow = h.state.wrap_cols().expect("wrapped");
    assert!(narrow < wide);
    assert!(h.state.visual_row(&h.doc, Position::new(5, 0)) > rows_wide, "narrow rows: more of them");
    assert_eq!(top_line(&h), before, "the top line stays in place");
}

#[test]
fn code_files_never_wrap() {
    let long = format!("const s = \"{}\";\nlet x = 1;\n", "word ".repeat(80));
    let mut h = Harness::new(&long, Language::TypeScript, 640.0);
    assert_eq!(h.state.wrap_cols(), None);
    assert_eq!(h.state.visual_row(&h.doc, Position::new(1, 0)), 1);
    // The caret moves by logical lines.
    h.caret(0, 100);
    h.key(Key::ArrowDown, Modifiers::NONE);
    assert_eq!(h.cursor(), (1, 10));
}

#[test]
fn toggle_switches_the_layout() {
    let mut h = Harness::new(&markdown(), Language::Plain, 640.0);
    assert!(h.state.wrap_cols().is_some());
    h.state.set_soft_wrap(false);
    h.frame();
    assert_eq!(h.state.wrap_cols(), None);
    assert_eq!(h.state.visual_row(&h.doc, Position::new(3, 0)), 3);
    h.state.set_soft_wrap(true);
    h.frame();
    assert!(h.state.visual_row(&h.doc, Position::new(3, 0)) > 3);
}

#[test]
fn defaults_by_file_type() {
    use ide_editor::wrap::default_for;
    use std::path::Path;
    assert!(default_for(Path::new("README.md"), Language::Markdown));
    assert!(default_for(Path::new("notes.txt"), Language::Plain));
    assert!(default_for(Path::new("LICENSE"), Language::Plain));
    assert!(!default_for(Path::new("Cargo.toml"), Language::Plain));
    assert!(!default_for(Path::new("main.rs"), Language::Rust));
    assert!(!default_for(Path::new("app.ts"), Language::TypeScript));
}

#[test]
fn caret_at_a_row_end_keeps_its_side() {
    let mut h = Harness::new(&markdown(), Language::Markdown, 640.0);
    let r = h.rows(2);
    let (s1, s2, s3) = (r.starts[1].char, r.starts[2].char, r.starts.get(3).map(|s| s.char));
    // Rows 0, 1, 2 of line 2 are visual rows 2, 3, 4.
    h.caret(2, s1 + 5);
    h.key(Key::End, Modifiers::NONE);
    assert_eq!((h.cursor(), h.caret_row()), ((2, s2), 3));

    // Up and Down from the row end keep the end of the row: the x past the last char.
    h.key(Key::ArrowUp, Modifiers::NONE);
    assert_eq!((h.cursor(), h.caret_row()), ((2, s1), 2), "the end of row 0, drawn on row 0");
    h.key(Key::ArrowDown, Modifiers::NONE);
    assert_eq!((h.cursor(), h.caret_row()), ((2, s2), 3), "back at the end of row 1");
    h.key(Key::ArrowDown, Modifiers::NONE);
    assert_eq!(h.caret_row(), 4);
    if let Some(s3) = s3 {
        assert_eq!(h.cursor().1, s3, "the end of row 2 if row 2 is that wide");
    }

    // Typing at the row end inserts after the row's last char.
    h.caret(2, s1 + 5);
    h.key(Key::End, Modifiers::NONE);
    let before = h.doc.line(2);
    h.events.push(Event::Text("Z".into()));
    h.frame();
    let after: Vec<char> = h.doc.line(2).chars().collect();
    assert_eq!(after[s2], 'Z');
    assert_eq!(after[s2 - 1], before.chars().nth(s2 - 1).expect("char"), "the row's last char stays before it");

    // The same index reached by Right from the row before is the next row's start.
    h.caret(2, s1);
    h.key(Key::ArrowLeft, Modifiers::NONE);
    h.key(Key::ArrowRight, Modifiers::NONE);
    assert_eq!((h.cursor(), h.caret_row()), ((2, s1), 3), "a plain move to the boundary draws at the next row's start");
}
