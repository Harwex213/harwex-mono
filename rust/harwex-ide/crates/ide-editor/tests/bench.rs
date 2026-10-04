//! Opens a generated 200k-line TypeScript file and edits it. Prints timings; run with
//! `cargo test -p ide-editor --release --test bench -- --nocapture`.
//! Bounds are only asserted in release builds, where they mean something.

use std::time::{Duration, Instant};

use egui::{Event, Pos2, RawInput, Rect, Vec2};
use ide_editor::{Carets, Document, EditKind, EditorState, EditorView, Language, Position, Selection};

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

    // Find bar: type a query into the field, one char per frame. The search runs on a worker,
    // so these frames cost the same as plain frames.
    state.open_find(&doc, false);
    frame(&ctx, &mut doc, &mut state, vec![]);
    let mut query_typing = Vec::new();
    for c in "make1234".chars() {
        query_typing.push(frame(&ctx, &mut doc, &mut state, vec![Event::Text(c.to_string())]));
    }
    assert_eq!(state.find().query(), "make1234", "the query field had the keyboard");
    let t = Instant::now();
    while !state.find().is_fresh(&doc) {
        std::thread::sleep(Duration::from_millis(1));
        frame(&ctx, &mut doc, &mut state, vec![]);
    }
    let search_done = t.elapsed();
    // "make1234" matches make1234 and make12340..make12349.
    assert_eq!(state.find().counter().1, 11);
    // A one-letter query hits the match limit; frames stay cheap while the worker runs.
    let t = Instant::now();
    let wide_frame = frame(&ctx, &mut doc, &mut state, vec![Event::Key {
        key: egui::Key::A,
        physical_key: None,
        pressed: true,
        repeat: false,
        modifiers: egui::Modifiers::COMMAND,
    }, Event::Text("e".into())]);
    while !state.find().is_fresh(&doc) {
        std::thread::sleep(Duration::from_millis(1));
        frame(&ctx, &mut doc, &mut state, vec![]);
    }
    let wide_search = t.elapsed();
    assert!(state.find().is_capped(), "\"e\" has more than {} matches", ide_editor::MAX_MATCHES);
    let mut wide_frames = Vec::new();
    for _ in 0..20 {
        wide_frames.push(frame(&ctx, &mut doc, &mut state, vec![]));
    }
    // Typing in the text with 100k matches: each edit updates the matches of its line.
    state.request_focus();
    frame(&ctx, &mut doc, &mut state, vec![]);
    let mut typing_with_matches = Vec::new();
    for i in 0..100 {
        let t = if i % 5 == 4 { " " } else { "e" };
        typing_with_matches.push(frame(&ctx, &mut doc, &mut state, vec![Event::Text(t.into())]));
    }
    assert!(state.find().is_fresh(&doc), "edits update the matches without a full search");
    let _ = wide_frame;

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

    eprintln!("  find: query typing frame avg   {:8.3} ms (max {:.2} ms)", ms(avg(&query_typing)), ms(max(&query_typing)));
    eprintln!("  find: search to result (worker){:8.2} ms (11 matches)", ms(search_done));
    eprintln!("  find: capped search (worker)   {:8.2} ms ({} matches)", ms(wide_search), ide_editor::MAX_MATCHES);
    eprintln!("  find: frame with 100k matches  {:8.3} ms (max {:.2} ms)", ms(avg(&wide_frames)), ms(max(&wide_frames)));
    eprintln!("  find: typing frame, 100k match {:8.3} ms (max {:.2} ms)", ms(avg(&typing_with_matches)), ms(max(&typing_with_matches)));

    if !cfg!(debug_assertions) {
        // 120 fps leaves 8.3 ms per frame for the whole app; the editor must use a fraction.
        assert!(edit_avg < Duration::from_millis(4), "keystroke too slow: {edit_avg:?}");
        assert!(avg(&steady) < Duration::from_millis(4), "steady frame too slow");
        assert!(avg(&typing) < Duration::from_millis(8), "typing frame too slow");
        assert!(avg(&jumps) < Duration::from_millis(12), "jump frame too slow");
        assert!(avg(&query_typing) < Duration::from_millis(8), "find query typing frame too slow");
        assert!(avg(&wide_frames) < Duration::from_millis(4), "steady frame with matches too slow");
        assert!(avg(&typing_with_matches) < Duration::from_millis(8), "typing frame with matches too slow");
    }
}

/// 10k carets on the same 200k-line file: typing, a steady frame, undo and Select All
/// Occurrences. Run with `cargo test -p ide-editor --release --test bench -- --nocapture`.
#[test]
fn bench_10k_carets() {
    let text = generate();
    let mut doc = Document::from_text(&text, Language::TypeScript);
    doc.wait_syntax();
    let ctx = egui::Context::default();
    let mut state = EditorState::new();
    state.request_focus();
    frame(&ctx, &mut doc, &mut state, vec![]);

    // One caret every 20 lines, inside `id: number;`.
    const CARETS: usize = 10_000;
    let sels: Vec<Selection> = (0..CARETS).map(|i| Selection::caret(doc.position_to_char(Position::new(i * 20 + 2, 2)))).collect();
    state.set_carets(Carets::from_vec(sels, CARETS / 2));
    state.reveal(Position::new(CARETS / 2 * 20 + 2, 2));
    frame(&ctx, &mut doc, &mut state, vec![]);
    state.set_carets(Carets::from_vec(
        (0..CARETS).map(|i| Selection::caret(doc.position_to_char(Position::new(i * 20 + 2, 2)))).collect(),
        CARETS / 2,
    ));
    let mut steady = Vec::new();
    for _ in 0..30 {
        steady.push(frame(&ctx, &mut doc, &mut state, vec![]));
    }
    let mut typing = Vec::new();
    for i in 0..50 {
        let t = if i % 5 == 4 { " " } else { "x" };
        typing.push(frame(&ctx, &mut doc, &mut state, vec![Event::Text(t.into())]));
    }
    assert_eq!(state.carets().len(), CARETS);
    assert_eq!(doc.line(2), "  xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx id: number;");
    let mut backspace = Vec::new();
    for _ in 0..10 {
        backspace.push(frame(&ctx, &mut doc, &mut state, vec![key(egui::Key::Backspace, egui::Modifiers::NONE)]));
    }
    let undo_all = frame(&ctx, &mut doc, &mut state, (0..30).map(|_| key(egui::Key::Z, egui::Modifiers::COMMAND)).collect());
    assert_eq!(doc.text().len(), text.len(), "undo restores the file");
    assert_eq!(state.carets().len(), CARETS, "undo restores every caret");
    let (_, reparse) = time(|| doc.wait_syntax());

    // Select All Occurrences of `name` (40k whole-word hits), then type over them.
    state.set_carets(Carets::single(Selection::caret(doc.position_to_char(Position::new(3, 3)))));
    frame(&ctx, &mut doc, &mut state, vec![]);
    let (_, select_all) = time(|| state.select_all_occurrences(&mut doc));
    assert_eq!(state.carets().len(), LINES / 10 * 2);
    let replace_40k = frame(&ctx, &mut doc, &mut state, vec![Event::Text("n".into())]);
    assert_eq!(doc.line(3), "  n: string;");

    let avg = |v: &[Duration]| v.iter().sum::<Duration>() / v.len() as u32;
    let max = |v: &[Duration]| v.iter().max().copied().unwrap_or_default();
    eprintln!("ide-editor multi-caret benchmark, {} lines, {} carets", LINES, CARETS);
    eprintln!("  steady frame avg               {:8.3} ms (max {:.2} ms)", ms(avg(&steady)), ms(max(&steady)));
    eprintln!("  typing frame avg               {:8.3} ms (max {:.2} ms)", ms(avg(&typing)), ms(max(&typing)));
    eprintln!("  backspace frame avg            {:8.3} ms (max {:.2} ms)", ms(avg(&backspace)), ms(max(&backspace)));
    eprintln!("  undo 21 steps in one frame     {:8.2} ms", ms(undo_all));
    eprintln!("  background reparse after edits {:8.2} ms (off the UI thread)", ms(reparse));
    eprintln!("  select all occurrences (40k)   {:8.2} ms", ms(select_all));
    eprintln!("  typing frame at 40k carets     {:8.2} ms", ms(replace_40k));

    if !cfg!(debug_assertions) {
        assert!(avg(&steady) < Duration::from_millis(4), "steady frame with 10k carets too slow");
        assert!(avg(&typing) < Duration::from_millis(8), "typing frame with 10k carets too slow");
        assert!(avg(&backspace) < Duration::from_millis(8), "backspace frame with 10k carets too slow");
    }
}

fn key(key: egui::Key, modifiers: egui::Modifiers) -> Event {
    Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers }
}

/// 10k problem underlines over the 200k-line file: the steady frame and the frame after a
/// scroll stay in the budgets (squiggles cost the visible lines, scrollbar marks the track).
#[test]
fn bench_10k_problems() {
    use ide_editor::{ProblemMark, ProblemSeverity};
    let text = generate();
    let mut doc = Document::from_text(&text, Language::TypeScript);
    doc.wait_syntax();
    let mut state = EditorState::new();
    let problems: Vec<ProblemMark> = (0..10_000)
        .map(|i| {
            let start = doc.line_start(i * 20 + 3) + 2;
            let severity = ProblemSeverity::ALL[i % 4];
            ProblemMark { start, end: start + 5, severity }
        })
        .collect();
    let ctx = egui::Context::default();
    let run = |doc: &mut Document, state: &mut EditorState, events: Vec<Event>| -> Duration {
        let input = RawInput { screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(1400.0, 900.0))), events, ..Default::default() };
        let t = Instant::now();
        let _ = ctx.run(input, |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                EditorView::new(doc, state).problems(&problems).show(ui);
            });
        });
        t.elapsed()
    };
    for _ in 0..3 {
        run(&mut doc, &mut state, vec![]);
    }
    let steady: Vec<Duration> = (0..20).map(|_| run(&mut doc, &mut state, vec![])).collect();
    let steady = steady.iter().sum::<Duration>() / steady.len() as u32;
    state.reveal(Position::new(LINES / 2, 0));
    let jump = run(&mut doc, &mut state, vec![]);
    println!("10k problems: steady frame {:.2} ms, jump frame {:.2} ms", ms(steady), ms(jump));
    if !cfg!(debug_assertions) {
        assert!(steady < Duration::from_millis(4), "steady frame {steady:?}");
        assert!(jump < Duration::from_millis(12), "jump frame {jump:?}");
    }
}

/// A 100k-line Markdown file with soft wrap: long paragraphs, list items, headings.
fn generate_markdown(lines: usize) -> String {
    let para = "Soft wrap breaks this paragraph into visual rows at the width of the editor, at word boundaries when it can, \
and the editor keeps scrolling and typing inside its frame budget because only the visible rows are laid out and every \
other line keeps a cached row count.";
    let mut s = String::with_capacity(lines * 140);
    for i in 0..lines {
        match i % 10 {
            0 => s.push_str(&format!("## Section {i}\n")),
            1 | 5 | 9 => s.push('\n'),
            2 | 6 => s.push_str(&format!("{para} ({i})\n")),
            3 => s.push_str(&format!("- item {i}: {}\n", &para[..120])),
            4 => s.push_str(&format!("  continued {i} {}\n", &para[..200])),
            _ => s.push_str(&format!("Short line {i}.\n")),
        }
    }
    s
}

/// Soft wrap on a 100k-line Markdown file: the first frames (a sweep counts the rows), steady,
/// jump-scroll, typing and resize frames. Run with
/// `cargo test -p ide-editor --release --test bench -- --nocapture`.
#[test]
fn bench_wrapped_markdown() {
    const MD_LINES: usize = 100_000;
    let text = generate_markdown(MD_LINES);
    let mut doc = Document::from_text(&text, Language::Markdown);
    doc.wait_syntax();
    let ctx = egui::Context::default();
    let mut state = EditorState::new();
    state.set_soft_wrap(true);
    state.request_focus();
    let mut width = 1400.0;
    let run = |doc: &mut Document, state: &mut EditorState, width: f32, events: Vec<Event>| -> Duration {
        let input = RawInput { screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(width, 900.0))), events, ..Default::default() };
        let t = Instant::now();
        let _ = ctx.run(input, |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                EditorView::new(doc, state).show(ui);
            });
        });
        t.elapsed()
    };
    let first = run(&mut doc, &mut state, width, vec![]);
    // The sweep counts the rows of the whole file over a few frames.
    let mut sweep = Vec::new();
    let top_before = state.visual_row(&doc, Position::new(MD_LINES / 2, 0));
    while !state.wrap_settled() {
        sweep.push(run(&mut doc, &mut state, width, vec![]));
        assert!(sweep.len() < 1000, "the sweep ends");
    }
    let cols = state.wrap_cols().expect("Markdown wraps");
    // Every line is counted: line 2 of each block of 10 wraps.
    let mid = MD_LINES / 2 + 2;
    let rows_mid = state.visual_row(&doc, Position::new(mid + 1, 0)) - state.visual_row(&doc, Position::new(mid, 0));
    assert!(rows_mid > 1, "a paragraph wraps at {cols} columns");
    assert!(state.visual_row(&doc, Position::new(MD_LINES / 2, 0)) > top_before, "the sweep counted the rows above the middle");

    let mut steady = Vec::new();
    for _ in 0..50 {
        steady.push(run(&mut doc, &mut state, width, vec![]));
    }
    let mut jumps = Vec::new();
    for i in 0..50 {
        state.reveal(Position::new((i * 3_919) % MD_LINES, 0));
        jumps.push(run(&mut doc, &mut state, width, vec![]));
    }
    state.reveal(Position::new(mid, 10));
    run(&mut doc, &mut state, width, vec![]);
    let mut typing = Vec::new();
    for i in 0..100 {
        let t = if i % 5 == 4 { " " } else { "x" };
        typing.push(run(&mut doc, &mut state, width, vec![Event::Text(t.into())]));
    }
    assert!(doc.is_dirty());
    // Scroll by wheel: the frame that moves the viewport.
    let mut scrolls = Vec::new();
    for _ in 0..50 {
        let wheel = Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta: Vec2::new(0.0, -300.0), modifiers: egui::Modifiers::NONE };
        scrolls.push(run(&mut doc, &mut state, width, vec![Event::PointerMoved(Pos2::new(700.0, 400.0)), wheel]));
    }
    // A window resize drag: a new width every frame re-wraps the visible rows and runs a sweep slice.
    let mut resize = Vec::new();
    for _ in 0..30 {
        width -= 10.0;
        resize.push(run(&mut doc, &mut state, width, vec![]));
    }
    let mut settle = 0;
    while !state.wrap_settled() {
        run(&mut doc, &mut state, width, vec![]);
        settle += 1;
        assert!(settle < 1000, "the sweep ends");
    }
    assert!(state.wrap_cols().expect("wrapped") < cols, "the narrower window wraps at fewer columns");

    let avg = |v: &[Duration]| v.iter().sum::<Duration>() / v.len() as u32;
    let max = |v: &[Duration]| v.iter().max().copied().unwrap_or_default();
    eprintln!("ide-editor soft wrap benchmark, {} lines, {:.1} MB, {} columns", MD_LINES, text.len() as f64 / 1e6, cols);
    eprintln!("  first frame                    {:8.2} ms", ms(first));
    eprintln!("  sweep frames                   {:8} (avg {:.2} ms, max {:.2} ms)", sweep.len(), ms(avg(&sweep)), ms(max(&sweep)));
    eprintln!("  steady frame avg               {:8.3} ms (max {:.2} ms)", ms(avg(&steady)), ms(max(&steady)));
    eprintln!("  jump-scroll frame avg          {:8.3} ms (max {:.2} ms)", ms(avg(&jumps)), ms(max(&jumps)));
    eprintln!("  wheel scroll frame avg         {:8.3} ms (max {:.2} ms)", ms(avg(&scrolls)), ms(max(&scrolls)));
    eprintln!("  typing frame avg               {:8.3} ms (max {:.2} ms)", ms(avg(&typing)), ms(max(&typing)));
    eprintln!("  resize frame avg               {:8.3} ms (max {:.2} ms), then {} sweep frames", ms(avg(&resize)), ms(max(&resize)), settle);

    if !cfg!(debug_assertions) {
        assert!(avg(&steady) < Duration::from_millis(4), "steady frame too slow");
        assert!(avg(&jumps) < Duration::from_millis(12), "jump frame too slow");
        assert!(avg(&scrolls) < Duration::from_millis(8), "scroll frame too slow");
        assert!(avg(&typing) < Duration::from_millis(8), "typing frame too slow");
        assert!(avg(&sweep) < Duration::from_millis(12), "sweep frame too slow");
        assert!(avg(&resize) < Duration::from_millis(12), "resize frame too slow");
    }
}

/// One 2 MB line of plain text with soft wrap (a log line, a dump): about 13k visual rows.
#[test]
fn bench_wrapped_giant_line() {
    let line = "word ".repeat(400_000);
    let text = format!("start\n{line}\nend\n");
    let mut doc = Document::from_text(&text, Language::Plain);
    let ctx = egui::Context::default();
    let mut state = EditorState::new();
    state.set_soft_wrap(true);
    state.request_focus();
    let run = |doc: &mut Document, state: &mut EditorState, events: Vec<Event>| -> Duration {
        let input = RawInput { screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(1400.0, 900.0))), events, ..Default::default() };
        let t = Instant::now();
        let _ = ctx.run(input, |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                EditorView::new(doc, state).show(ui);
            });
        });
        t.elapsed()
    };
    while !state.wrap_settled() || state.wrap_cols().is_none() {
        run(&mut doc, &mut state, vec![]);
    }
    // The middle of the line.
    state.reveal(Position::new(1, line.len() / 2));
    run(&mut doc, &mut state, vec![]);
    let steady: Vec<Duration> = (0..20).map(|_| run(&mut doc, &mut state, vec![])).collect();
    let typing: Vec<Duration> = (0..20).map(|_| run(&mut doc, &mut state, vec![Event::Text("x".into())])).collect();
    let down: Vec<Duration> = (0..20).map(|_| run(&mut doc, &mut state, vec![key(egui::Key::ArrowDown, egui::Modifiers::NONE)])).collect();
    assert!(state.visual_row(&doc, Position::new(2, 0)) > 10_000);
    let avg = |v: &[Duration]| v.iter().sum::<Duration>() / v.len() as u32;
    let max = |v: &[Duration]| v.iter().max().copied().unwrap_or_default();
    eprintln!("soft wrap, one 2 MB line: steady {:.2} ms (max {:.2}), typing {:.2} ms (max {:.2}), Down {:.2} ms (max {:.2})",
        ms(avg(&steady)), ms(max(&steady)), ms(avg(&typing)), ms(max(&typing)), ms(avg(&down)), ms(max(&down)));
    if !cfg!(debug_assertions) {
        assert!(avg(&steady) < Duration::from_millis(4), "steady frame too slow");
        assert!(avg(&typing) < Duration::from_millis(8), "typing frame too slow");
        assert!(avg(&down) < Duration::from_millis(8), "Down frame too slow");
    }
}
