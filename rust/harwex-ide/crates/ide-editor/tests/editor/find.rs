//! Find and Replace without UI: matches, filters, In Selection, Exclude, Replace, Replace All
//! and the incremental update after edits. The matcher's own cases are unit tests in
//! `src/search.rs`.

use ide_editor::{Document, EditKind, EditorState, FindOptions, Language, Position, SearchFilter, Selection};

fn texts(doc: &Document, state: &EditorState) -> Vec<String> {
    state.find().matches().iter().map(|m| doc.slice(m.range.clone())).collect()
}

fn open(text: &str, lang: Language, query: &str) -> (Document, EditorState) {
    let mut doc = Document::from_text(text, lang);
    doc.wait_syntax();
    let mut state = EditorState::new();
    state.open_find(&doc, false);
    state.find_mut().set_query(query);
    state.find_refresh(&mut doc, true);
    (doc, state)
}

#[test]
fn typing_selects_the_first_match_after_the_caret() {
    let (doc, state) = open("foo bar\nfoo baz\nfoo\n", Language::Plain, "foo");
    assert_eq!(texts(&doc, &state), ["foo", "foo", "foo"]);
    assert_eq!(state.find().counter(), (Some(1), 3));
    assert_eq!(state.selection().range(), 0..3);
}

#[test]
fn next_and_previous_wrap() {
    let (mut doc, mut state) = open("foo bar\nfoo baz\nfoo\n", Language::Plain, "foo");
    state.find_next();
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter(), (Some(2), 3));
    state.find_next();
    state.find_refresh(&mut doc, true);
    state.find_next();
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter(), (Some(1), 3), "wraps to the first");
    state.find_previous();
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter(), (Some(3), 3), "wraps back to the last");
    assert_eq!(doc.slice(state.selection().range()), "foo");
}

#[test]
fn filters_by_syntax_kind() {
    let src = "// name in a comment\nconst name = \"name\";\nlet x = name;\n";
    let (mut doc, mut state) = open(src, Language::TypeScript, "name");
    assert_eq!(state.find().counter().1, 4);
    let lines = |doc: &Document, state: &EditorState| -> Vec<usize> {
        state.find().matches().iter().map(|m| doc.char_to_position(m.range.start).line).collect()
    };
    let cases = [
        (SearchFilter::InComments, vec![0]),
        (SearchFilter::InStringLiterals, vec![1]),
        (SearchFilter::ExceptComments, vec![1, 1, 2]),
        (SearchFilter::ExceptStringLiterals, vec![0, 1, 2]),
        (SearchFilter::ExceptCommentsAndStringLiterals, vec![1, 2]),
        (SearchFilter::Anywhere, vec![0, 1, 1, 2]),
    ];
    for (filter, want) in cases {
        state.find_mut().set_filter(filter);
        state.find_refresh(&mut doc, true);
        assert_eq!(lines(&doc, &state), want, "{filter:?}");
    }
}

#[test]
fn in_selection_limits_the_search() {
    let mut doc = Document::from_text("a x\nb x\nc x\nd x\n", Language::Plain);
    let mut state = EditorState::new();
    // A selection over several lines turns In Selection on when the bar opens.
    let sel_start = doc.line_start(1);
    let sel_end = doc.line_end(2);
    state.open_find_with_selection(&doc, Selection::new(sel_start, sel_end), false);
    assert!(state.find().in_selection());
    state.find_mut().set_query("x");
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter().1, 2);
    // The editor selection stays: the scope is still visible to the user.
    assert_eq!(state.selection().range(), sel_start..sel_end);

    // Replace All only touches the scope.
    state.find_mut().set_replacement("y");
    state.find_replace_all(&mut doc);
    assert_eq!(doc.text(), "a x\nb y\nc y\nd x\n");

    state.find_mut().set_in_selection(false);
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter().1, 2, "outside the scope again: the two x left");
}

#[test]
fn replace_moves_on_and_replace_all_is_one_undo_step() {
    let original = "Foo foo FOO food\n";
    let (mut doc, mut state) = open(original, Language::Plain, "foo");
    state.find_mut().set_options(FindOptions { words: true, ..Default::default() });
    state.find_mut().set_replacement("bar");
    state.find_mut().set_preserve_case(true);
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter(), (Some(1), 3));

    state.find_replace(&mut doc);
    assert_eq!(doc.text(), "Bar foo FOO food\n");
    // The next match is selected right away.
    assert_eq!(doc.slice(state.selection().range()), "foo");
    assert_eq!(state.find().counter(), (Some(1), 2));

    state.find_replace_all(&mut doc);
    assert_eq!(doc.text(), "Bar bar BAR food\n");
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter().1, 0);

    // One undo takes back the whole Replace All, the next one the single Replace.
    doc.undo();
    assert_eq!(doc.text(), "Bar foo FOO food\n");
    doc.undo();
    assert_eq!(doc.text(), original);
}

#[test]
fn regex_replacement_uses_groups() {
    let (mut doc, mut state) = open("a=1\nb=22\n", Language::Plain, r"(\w)=(\d+)");
    state.find_mut().set_options(FindOptions { regex: true, ..Default::default() });
    state.find_mut().set_replacement(r"$2\t$1");
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter().1, 2);
    state.find_replace_all(&mut doc);
    assert_eq!(doc.text(), "1\ta\n22\tb\n");
}

#[test]
fn multiline_query() {
    let (mut doc, mut state) = open("a\nb\nc\na\nb\n", Language::Plain, "a\nb");
    assert_eq!(state.find().query(), "a", "without multiline mode the query stops at the line break");
    state.find_mut().set_options(FindOptions { multiline: true, ..Default::default() });
    state.find_mut().set_query("a\nb");
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter().1, 2);
}

#[test]
fn exclude_skips_the_match_in_counter_and_replace() {
    let (mut doc, mut state) = open("x x x\n", Language::Plain, "x");
    assert_eq!(state.find().counter(), (Some(1), 3));
    state.find_exclude(&mut doc);
    assert_eq!(state.find().counter(), (Some(1), 2), "the second x is current now");
    assert!(state.find().matches()[0].excluded);
    state.find_mut().set_replacement("y");
    state.find_replace_all(&mut doc);
    assert_eq!(doc.text(), "x y y\n");
}

#[test]
fn incremental_update_matches_a_full_search() {
    let mut text = String::new();
    for i in 0..400 {
        text.push_str(&format!("line {i} foo bar foo\n"));
    }
    let (mut doc, mut state) = open(&text, Language::Plain, "foo");
    assert_eq!(state.find().counter().1, 800);
    let mut seed = 7u64;
    let mut rnd = |n: usize| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) as usize % n.max(1)
    };
    for step in 0..200 {
        let at = rnd(doc.len_chars());
        let len = rnd(6).min(doc.len_chars() - at);
        let insert = ["f", "oo", "foo", "\n", "fo\no", ""][rnd(6)];
        let s = Selection::caret(at);
        doc.edit(at..at + len, insert, s, s, EditKind::Other);
        state.find_refresh(&mut doc, true);
        let want: Vec<usize> = doc.text().match_indices("foo").map(|(b, _)| doc.text()[..b].chars().count()).collect();
        let got: Vec<usize> = state.find().matches().iter().map(|m| m.range.start).collect();
        assert_eq!(got, want, "step {step}");
    }
}

#[test]
fn edits_keep_exclusions_outside_the_change() {
    let (mut doc, mut state) = open("x\nx\nx\n", Language::Plain, "x");
    state.find_exclude(&mut doc);
    assert!(state.find().matches()[0].excluded);
    let end = doc.line_end(2);
    let s = Selection::caret(end);
    doc.edit(end..end, " more", s, s, EditKind::Insert);
    state.find_refresh(&mut doc, true);
    assert!(state.find().matches()[0].excluded, "an edit on another line keeps the exclusion");
    assert_eq!(state.find().counter().1, 2);
}

#[test]
fn big_files_search_on_a_worker() {
    let line = "export const value = compute(alpha, beta);\n";
    let text = line.repeat(20_000);
    let mut doc = Document::from_text(&text, Language::Plain);
    let mut state = EditorState::new();
    state.open_find(&doc, false);
    state.find_mut().set_query("beta");
    state.find_refresh(&mut doc, false);
    assert!(state.find().is_searching(), "a file over 256 KB is searched off the UI thread");
    state.find_refresh(&mut doc, true);
    assert_eq!(state.find().counter(), (Some(1), 20_000));
    assert_eq!(doc.char_to_position(state.selection().start()), Position::new(0, 36));
}
