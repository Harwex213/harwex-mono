use std::path::Path;

use ide_editor::{Document, EditKind, HlKind, Language, Position, Selection};

fn kinds_on_line(doc: &mut Document, line: usize) -> Vec<(String, HlKind)> {
    let text = doc.line(line);
    let spans = doc.highlight(line..line + 1).remove(0);
    spans
        .iter()
        .map(|s| (text[s.start as usize..s.end as usize].to_string(), s.kind))
        .collect()
}

#[test]
fn every_language_highlights() {
    let samples = [
        (Language::TypeScript, "const x: number = 1; // c\n"),
        (Language::Tsx, "const a = <div className=\"x\">{1}</div>;\n"),
        (Language::JavaScript, "function f() { return 'a'; }\n"),
        (Language::Jsx, "const a = <b>hi</b>;\n"),
        (Language::Json, "{\"a\": 1, \"b\": true}\n"),
        (Language::Rust, "fn main() { let s = \"x\"; }\n"),
        (Language::Css, "a { color: red; }\n"),
        (Language::Markdown, "# Title\n\ntext\n"),
    ];
    for (lang, text) in samples {
        let mut doc = Document::from_text(text, lang);
        doc.wait_syntax();
        let spans = doc.highlight(0..1).remove(0);
        assert!(!spans.is_empty(), "{lang:?} produced no spans");
    }
}

#[test]
fn typescript_kinds() {
    let mut doc = Document::from_text(
        "import { a } from \"b\";\ninterface Foo { bar(): string }\nfunction baz(x: number) { return 42; }\n",
        Language::TypeScript,
    );
    doc.wait_syntax();
    let l0 = kinds_on_line(&mut doc, 0);
    assert!(l0.contains(&("import".into(), HlKind::Keyword)), "{l0:?}");
    assert!(l0.contains(&("\"b\"".into(), HlKind::String)), "{l0:?}");
    let l1 = kinds_on_line(&mut doc, 1);
    assert!(l1.contains(&("interface".into(), HlKind::Keyword)), "{l1:?}");
    assert!(l1.contains(&("Foo".into(), HlKind::Type)), "{l1:?}");
    assert!(l1.contains(&("string".into(), HlKind::Type)), "{l1:?}");
    let l2 = kinds_on_line(&mut doc, 2);
    assert!(l2.contains(&("baz".into(), HlKind::Function)), "{l2:?}");
    assert!(l2.contains(&("42".into(), HlKind::Number)), "{l2:?}");
}

#[test]
fn incremental_edit_updates_highlight() {
    let mut doc = Document::from_text("let a = 1;\n", Language::TypeScript);
    doc.wait_syntax();
    let s = Selection::caret(0);
    doc.edit(0..0, "// ", s, s, EditKind::Other);
    let l0 = kinds_on_line(&mut doc, 0);
    assert_eq!(l0, vec![("// let a = 1;".to_string(), HlKind::Comment)]);
}

#[test]
fn background_parse_replays_edits() {
    // Big enough to take the background path.
    let mut text = String::new();
    for i in 0..20_000 {
        text.push_str(&format!("const v{i} = {i};\n"));
    }
    let mut doc = Document::from_text(&text, Language::TypeScript);
    let s = Selection::caret(0);
    doc.edit(0..0, "// head\n", s, s, EditKind::Other);
    doc.wait_syntax();
    let l0 = kinds_on_line(&mut doc, 0);
    assert_eq!(l0, vec![("// head".to_string(), HlKind::Comment)]);
    let l1 = kinds_on_line(&mut doc, 1);
    assert!(l1.contains(&("const".into(), HlKind::Keyword)), "{l1:?}");
}

#[test]
fn dirty_tracks_undo_to_saved_point() {
    let dir = std::env::temp_dir().join(format!("ide-editor-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("a.ts");
    std::fs::write(&path, "a\r\nb\r\n").unwrap();
    let mut doc = Document::open(&path).unwrap();
    assert_eq!(doc.text(), "a\nb\n");
    assert_eq!(doc.language(), Language::TypeScript);
    assert!(!doc.is_dirty());
    let v = doc.version();
    doc.replace(Position::new(0, 1), Position::new(0, 1), "x");
    assert!(doc.version() > v);
    assert!(doc.is_dirty());
    doc.undo();
    assert!(!doc.is_dirty());
    doc.redo();
    doc.save().unwrap();
    assert!(!doc.is_dirty());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "ax\r\nb\r\n");
    doc.undo();
    assert!(doc.is_dirty());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn set_text_is_minimal_and_undoable() {
    let mut doc = Document::from_text("one\ntwo\nthree\n", Language::Plain);
    doc.set_text("one\n2\nthree\n");
    assert_eq!(doc.text(), "one\n2\nthree\n");
    doc.undo();
    assert_eq!(doc.text(), "one\ntwo\nthree\n");
}

#[test]
fn language_from_path() {
    assert_eq!(Language::from_path(Path::new("a/b.tsx")), Language::Tsx);
    assert_eq!(Language::from_path(Path::new("x.d.ts")), Language::TypeScript);
    assert_eq!(Language::from_path(Path::new("x.mjs")), Language::JavaScript);
    assert_eq!(Language::from_path(Path::new("Cargo.toml")), Language::Plain);
}

#[test]
fn positions_roundtrip() {
    let doc = Document::from_text("ab\ncd", Language::Plain);
    assert_eq!(doc.line_count(), 2);
    assert_eq!(doc.char_to_position(4), Position::new(1, 1));
    assert_eq!(doc.position_to_char(Position::new(1, 99)), 5);
    assert_eq!(doc.position_to_char(Position::new(9, 0)), 5);
    assert_eq!(doc.word_at(Position::new(0, 2)), Some(Position::new(0, 0)..Position::new(0, 2)));
}

#[test]
fn document_is_send() {
    // The app opens big files on a worker thread and moves the Document to the UI thread.
    fn assert_send<T: Send>() {}
    assert_send::<Document>();
    assert_send::<ide_editor::EditorState>();
}

#[test]
fn save_snapshot_and_mark_saved_track_dirty_state() {
    let mut doc = ide_editor::Document::from_text("a\n", ide_editor::Language::Plain);
    doc.replace(ide_editor::Position::new(0, 1), ide_editor::Position::new(0, 1), "b");
    assert!(doc.is_dirty());
    let (text, token) = doc.save_snapshot();
    assert_eq!(text, "ab\n");
    // An edit between the snapshot and the finished write keeps the document dirty.
    doc.replace(ide_editor::Position::new(0, 2), ide_editor::Position::new(0, 2), "c");
    doc.mark_saved(token);
    assert!(doc.is_dirty());
    let (_, token) = doc.save_snapshot();
    doc.mark_saved(token);
    assert!(!doc.is_dirty());
    assert!(!doc.reload_from_bytes(b"abc\n"));
    assert!(doc.reload_from_bytes(b"\xEF\xBB\xBFxyz\r\n"));
    assert_eq!(doc.text(), "xyz\n");
    assert!(!doc.is_dirty());
}
