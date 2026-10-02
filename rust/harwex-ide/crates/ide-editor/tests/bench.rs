//! Opens a generated 200k-line TypeScript file and edits it. Prints timings; run with
//! `cargo test -p ide-editor --release --test bench -- --nocapture`.
//! Bounds are only asserted in release builds, where they mean something.

use std::time::{Duration, Instant};

use egui::{Event, Pos2, RawInput, Rect, Vec2};
use ide_editor::{Document, EditKind, EditorState, EditorView, Language, Position, Selection};

const LINES: usize = 200_000;

fn generate() -> String {
    let mut s = String::with_capacity(LINES * 40);
    for i in 0..LINES / 10 {
        s.push_str(&format!(
            "/** Docs for item {i}. */\nexport interface Item{i} {{\n  id: number;\n  name: string;\n}}\nexport function make{i}(x: number): Item{i} {{\n  const label = `item-${{x}}`;\n  return {{ id: x + {i}, name: label }};\n}}\n\n"
        ));
    }
    s
}

fn time<T>(f: impl FnOnce() -> T) -> (T, Duration) {
    let t = Instant::now();
    let r = f();
    (r, t.elapsed())
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn frame(ctx: &egui::Context, doc: &mut Document, state: &mut EditorState, events: Vec<Event>) -> Duration {
    let input = RawInput {
        screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(1400.0, 900.0))),
        events,
        ..Default::default()
    };
    let t = Instant::now();
    let _ = ctx.run(input, |ctx| {
        egui::CentralPanel::default().show(ctx, |ui| {
            EditorView::new(doc, state).show(ui);
        });
    });
    t.elapsed()
}

#[test]
fn bench_200k_lines() {
    let text = generate();
    let (mut doc, open) = time(|| Document::from_text(&text, Language::TypeScript));
    assert_eq!(doc.line_count(), LINES + 1);
    let (_, parse) = time(|| doc.wait_syntax());

    let mid = LINES / 2;
    let (spans, hl) = time(|| doc.highlight(mid..mid + 60));
    assert!(spans.iter().any(|l| !l.is_empty()));

    // Typing in the middle of the file: one edit + reparse + visible-range highlight per key,
    // which is what a frame does after a keystroke.
    let at = doc.position_to_char(Position::new(mid + 2, 2));
    let mut sel = Selection::caret(at);
    let mut edit_times = Vec::new();
    for i in 0..1000 {
        let c = if i % 7 == 6 { " " } else { "a" };
        let (_, d) = time(|| {
            let after = Selection::caret(sel.head + 1);
            doc.edit(sel.head..sel.head, c, sel, after, EditKind::Insert);
            sel = after;
            doc.highlight(mid..mid + 60)
        });
        edit_times.push(d);
    }
    let (_, reparse) = time(|| doc.wait_syntax());
    let edit_avg = edit_times.iter().sum::<Duration>() / edit_times.len() as u32;
    let edit_max = edit_times.iter().max().copied().unwrap_or_default();

    // Pasting a large block near the top (a big structural change).
    let block: String = text.lines().take(2000).map(|l| format!("{l}\n")).collect();
    let (_, paste) = time(|| {
        let s = Selection::caret(10);
        doc.edit(10..10, &block, s, s, EditKind::Other);
        doc.highlight(0..60)
    });

    let (_, undo_all) = time(|| while doc.undo().is_some() {});
    assert_eq!(doc.text().len(), text.len());
    let (_, full_copy) = time(|| doc.text());

    // Widget frames through a headless egui context.
    let ctx = egui::Context::default();
    let mut state = EditorState::new();
    state.request_focus();
    let first_frame = frame(&ctx, &mut doc, &mut state, vec![]);
    let mut steady = Vec::new();
    for _ in 0..50 {
        steady.push(frame(&ctx, &mut doc, &mut state, vec![]));
    }
    // Jump to a new place every frame: nothing is cached, the worst case for scrolling.
    let mut jumps = Vec::new();
    for i in 0..50 {
        state.reveal(Position::new((i * 3_919) % LINES, 0));
        jumps.push(frame(&ctx, &mut doc, &mut state, vec![]));
    }
    state.reveal(Position::new(mid, 4));
    frame(&ctx, &mut doc, &mut state, vec![]);
    let mut typing = Vec::new();
    for i in 0..100 {
        let t = if i % 5 == 4 { " " } else { "x" };
        typing.push(frame(&ctx, &mut doc, &mut state, vec![Event::Text(t.into())]));
    }
    assert!(doc.is_dirty(), "typing frames must reach the document");
    let avg = |v: &[Duration]| v.iter().sum::<Duration>() / v.len() as u32;
    let max = |v: &[Duration]| v.iter().max().copied().unwrap_or_default();

    eprintln!("ide-editor benchmark, {} lines, {:.1} MB", LINES, text.len() as f64 / 1e6);
    eprintln!("  open (rope + indent scan)      {:8.2} ms", ms(open));
    eprintln!("  full tree-sitter parse         {:8.2} ms", ms(parse));
    eprintln!("  highlight 60 lines (cold)      {:8.2} ms", ms(hl));
    eprintln!("  keystroke edit+reparse+hl avg  {:8.3} ms (max {:.2} ms, 1000 edits)", ms(edit_avg), ms(edit_max));
    eprintln!("  background reparse after edits {:8.2} ms (off the UI thread)", ms(reparse));
    eprintln!("  paste 2000 lines + highlight   {:8.2} ms", ms(paste));
    eprintln!("  undo everything                {:8.2} ms", ms(undo_all));
    eprintln!("  text() full copy               {:8.2} ms", ms(full_copy));
    eprintln!("  widget first frame (fonts)     {:8.2} ms", ms(first_frame));
    eprintln!("  widget steady frame avg        {:8.3} ms (max {:.2} ms)", ms(avg(&steady)), ms(max(&steady)));
    eprintln!("  widget jump-scroll frame avg   {:8.3} ms (max {:.2} ms)", ms(avg(&jumps)), ms(max(&jumps)));
    eprintln!("  widget typing frame avg        {:8.3} ms (max {:.2} ms)", ms(avg(&typing)), ms(max(&typing)));

    if !cfg!(debug_assertions) {
        // 120 fps leaves 8.3 ms per frame for the whole app; the editor must use a fraction.
        assert!(edit_avg < Duration::from_millis(4), "keystroke too slow: {edit_avg:?}");
        assert!(avg(&steady) < Duration::from_millis(4), "steady frame too slow");
        assert!(avg(&typing) < Duration::from_millis(8), "typing frame too slow");
        assert!(avg(&jumps) < Duration::from_millis(12), "jump frame too slow");
    }
}
