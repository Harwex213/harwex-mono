//! Highlight of the identifier under the caret (task 091): a selection of exactly one
//! identifier, or a caret in one, gives the other occurrences in the file a soft background
//! and a grey scrollbar mark. Any other selection highlights nothing.

use crate::common::*;

const SUITE: &str = "occurrences";

/// Three uses of `counter` far apart, so the scrollbar shows three separate marks.
fn source() -> String {
    let mut s = String::from("// Occurrences of one identifier.\nlet counter = 0;\n");
    for i in 0..60 {
        let line = match i {
            25 => "counter = counter + 1;\n".to_string(),
            50 => "console.log(counters, Counter);\n".to_string(),
            _ => format!("const other{i} = {i};\n"),
        };
        s.push_str(&line);
    }
    s
}

fn shown(ide: &Ide) -> Vec<(usize, usize)> {
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    e.view.occurrences().iter().map(|r| e.doc.char_to_position(r.start)).map(|p| (p.line, p.column)).collect()
}

fn marks(ide: &Ide) -> usize {
    ide.state().ws.tabs.active_editor().expect("editor").view.occurrence_marks().len()
}

#[test]
fn a_selected_identifier_marks_its_other_occurrences_and_the_scrollbar() {
    let fx = Fixture::new(SUITE, "identifier");
    let repo = basic_repo(fx.path("repo"));
    repo.write("src/counter.ts", &source());
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/counter.ts");

    // A double click selects `counter` on line 1.
    ide.double_click_at(ide.char_pos(1, 6));
    assert_eq!(ide.selected_text(), "counter");
    // Whole word, case-sensitive: `counters` and `Counter` do not count.
    assert_eq!(shown(&ide), vec![(1, 4), (27, 0), (27, 10)]);
    assert!(marks(&ide) > 0, "scrollbar marks");
    ide.park_mouse();
    ide.snapshot("identifier_selected");

    // A selection that is not one identifier: nothing.
    ide.drag(ide.caret_pos(1, 4), ide.caret_pos(1, 14));
    assert_eq!(ide.selected_text(), "counter = ");
    assert!(shown(&ide).is_empty());
    assert_eq!(marks(&ide), 0);
    ide.park_mouse();
    ide.snapshot("non_identifier_selected");

    // A bare caret inside the identifier marks it too.
    ide.click_at(ide.caret_pos(27, 13));
    assert_eq!(shown(&ide), vec![(1, 4), (27, 0), (27, 10)]);
    ide.park_mouse();
    ide.snapshot("caret_in_identifier");
}
