//! Highlight of the identifier under the caret (task 091): a selection of exactly one
//! identifier, or a bare caret in one, marks the other whole-word, case-sensitive occurrences
//! in the file and on the scrollbar. Big files are searched on a worker, and the count stops at
//! `MAX_OCCURRENCES`.

use std::ops::Range;
use std::time::{Duration, Instant};

use egui::{CentralPanel, Context, Event, Key, Modifiers, Pos2, RawInput, Rect, Vec2};
use ide_editor::{Carets, Document, EditorState, EditorView, Language, Position, Selection, MAX_OCCURRENCES};

struct Harness {
    ctx: Context,
    doc: Document,
    state: EditorState,
    events: Vec<Event>,
    time: f64,
}

impl Harness {
    fn new(text: &str, language: Language) -> Harness {
        let doc = Document::from_text(text, language);
        let mut h = Harness { ctx: Context::default(), doc, state: EditorState::new(), events: Vec::new(), time: 0.0 };
        h.state.request_focus();
        h.settle();
        h
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
        let _ = self.ctx.run(input, |ctx| {
            CentralPanel::default().frame(egui::Frame::NONE).show(ctx, |ui| {
                EditorView::new(doc, state).show(ui);
            });
        });
    }

    fn settle(&mut self) {
        for _ in 0..3 {
            self.frame();
        }
    }

    fn select(&mut self, anchor: Position, head: Position) {
        self.state.set_selection(anchor, head);
        self.settle();
    }

    fn caret(&mut self, pos: Position) {
        self.select(pos, pos);
    }

    fn words(&self) -> Vec<String> {
        self.state.occurrences().iter().map(|r| self.doc.slice(r.clone())).collect()
    }

    fn starts(&self) -> Vec<Position> {
        self.state.occurrences().iter().map(|r| self.doc.char_to_position(r.start)).collect()
    }
}

const TS: &str = "const total = 1;\nfunction add(total: number) {\n  return total + totals + Total;\n}\n// total in a comment\n";

#[test]
fn a_caret_in_an_identifier_marks_its_whole_word_case_sensitive_occurrences() {
    let mut h = Harness::new(TS, Language::TypeScript);
    h.caret(Position::new(0, 8));
    // `totals` and `Total` are other words; the comment still holds the word.
    assert_eq!(h.starts(), vec![Position::new(0, 6), Position::new(1, 13), Position::new(2, 9), Position::new(4, 3)]);
    assert!(h.words().iter().all(|w| w == "total"));
    assert!(!h.state.occurrence_marks().is_empty(), "scrollbar marks");

    // The caret right after the word still counts (IDEA).
    h.caret(Position::new(0, 11));
    assert_eq!(h.state.occurrences().len(), 4);
}

#[test]
fn a_selection_of_exactly_one_identifier_marks_it() {
    let mut h = Harness::new(TS, Language::TypeScript);
    h.select(Position::new(2, 9), Position::new(2, 14));
    assert_eq!(h.state.occurrences().len(), 4);

    // Part of a word, two words, punctuation: nothing.
    for (a, b) in [((2, 9), (2, 12)), ((2, 9), (2, 22)), ((0, 11), (0, 14)), ((2, 14), (2, 17))] {
        h.select(Position::new(a.0, a.1), Position::new(b.0, b.1));
        assert!(h.state.occurrences().is_empty(), "{a:?}..{b:?}: {:?}", h.words());
        assert!(h.state.occurrence_marks().is_empty());
    }
}

#[test]
fn keywords_numbers_lone_words_and_several_carets_mark_nothing() {
    let mut h = Harness::new(TS, Language::TypeScript);
    h.caret(Position::new(0, 2));
    assert!(h.state.occurrences().is_empty(), "`const` is a keyword: {:?}", h.words());
    h.caret(Position::new(0, 14));
    assert!(h.state.occurrences().is_empty(), "a number");
    h.caret(Position::new(1, 10));
    assert!(h.state.occurrences().is_empty(), "`add` occurs once");
    h.caret(Position::new(2, 1));
    assert!(h.state.occurrences().is_empty(), "whitespace");

    let mut c = Carets::single(Selection::caret(h.doc.position_to_char(Position::new(0, 8))));
    c.toggle(h.doc.position_to_char(Position::new(2, 10)));
    h.state.set_carets(c);
    h.settle();
    assert!(h.state.occurrences().is_empty(), "several carets");
}

#[test]
fn edits_refresh_the_occurrences() {
    let mut h = Harness::new(TS, Language::TypeScript);
    h.caret(Position::new(0, 11));
    assert_eq!(h.state.occurrences().len(), 4);
    // `total` becomes `totals`: now it matches the one `totals` further down.
    h.events.push(Event::Text("s".into()));
    h.settle();
    assert_eq!(h.words(), vec!["totals", "totals"]);
    h.events.push(Event::Key { key: Key::Backspace, physical_key: None, pressed: true, repeat: false, modifiers: Modifiers::NONE });
    h.settle();
    assert_eq!(h.state.occurrences().len(), 4);
}

#[test]
fn a_big_file_is_searched_on_a_worker_and_capped() {
    // About 600 KB: above the synchronous limit.
    let text: String = (0..30_000).map(|i| format!("let item{i} = value + other;\n")).collect();
    let mut h = Harness::new(&text, Language::TypeScript);
    let started = Instant::now();
    h.caret(Position::new(0, 16));
    while h.state.occurrences().is_empty() && started.elapsed() < Duration::from_secs(20) {
        std::thread::sleep(Duration::from_millis(5));
        h.frame();
    }
    assert_eq!(h.state.occurrences().len(), MAX_OCCURRENCES, "stops at the cap");
    assert!(h.state.occurrences_capped());
    let r: &Range<usize> = h.state.occurrences().last().expect("some");
    assert_eq!(h.doc.char_to_position(r.start).line, MAX_OCCURRENCES - 1);
}

#[test]
fn the_scrollbar_marks_each_occurrence_line() {
    let text: String = (0..300).map(|i| if i % 100 == 50 { format!("use(target{i}, target);\n") } else { format!("let v{i} = {i};\n") }).collect();
    let mut h = Harness::new(&text, Language::TypeScript);
    h.caret(Position::new(50, 18));
    assert_eq!(h.starts(), vec![Position::new(50, 14), Position::new(150, 15), Position::new(250, 15)]);
    let marks = h.state.occurrence_marks().to_vec();
    let bands: Vec<f32> = marks.iter().enumerate().filter(|(i, y)| *i == 0 || **y - marks[i - 1] > 2.0).map(|(_, y)| *y).collect();
    assert_eq!(bands.len(), 3, "one band per occurrence line: {marks:?}");
    let track = h.state.geometry().expect("drawn").text_rect.height();
    for (band, line) in bands.iter().zip([50.0, 150.0, 250.0]) {
        // The content is the lines plus a view of slack below the last one.
        assert!(*band < track * line / 300.0 && *band > track * line / 600.0, "band {band} for line {line}");
    }
}
