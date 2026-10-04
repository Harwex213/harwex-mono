# ide-editor

The text buffer (`Document`, on ropey), tree-sitter highlighting and the egui editor widget (`EditorView`). The crate exists so the hot path of the IDE (open, scroll, type) is one small, benchmarked unit. Its cost depends on the viewport, not on the file size.

## Boundaries

- No language servers, no git and no project knowledge. The widget reports intent (`EditorAction`, `hover`, `gutter_clicked`, `annotation_clicked`). The app acts on it.
- Tree-sitter is for highlighting only (architecture rule 3). Navigation never uses the tree.
- The app saves and reloads on workers through `save_snapshot`, `mark_saved` and `reload_from_bytes`. Do not add blocking I/O that the app would call on the UI thread.
- The app relies on the public names that `src/lib.rs` re-exports. Extend the API freely. Do not rename it.
- Colors come in through `EditorTheme`. `EditorTheme::islands_dark()` is the default. The app passes `theme::T.editor`.

## Contract

- `Position`: 0-based line, 0-based column in chars. `Selection`: char indices. `Span.start`/`end`: byte offsets within the line. Do not mix the three.
- `version()` increments on every edit, also on undo, reload and `set_text`. The app uses it to sync language servers and to drop stale results.
- The dirty flag follows the undo stack: undoing back to the saved state is clean again.
- One `EditorState` per tab. `EditorView` fills `ui.available_rect_before_wrap()`. `read_only(true)` drops every edit but keeps selection, copy and navigation.
- `hover` is set only over real characters.
- Mouse: the editor counts its own click chain on press (`ClickChain`): presses within egui's `max_double_click_delay` and 6 pt of the last one. Press 1 places the caret, press 2 selects the word, press 3 and later the whole line. A drag then extends by chars, words or lines. Shift, Alt, Cmd and middle presses end the chain. The app sets `max_double_click_delay` to the system interval, and to the macOS default (0.5 s) in tests. The app reuses `ClickChain` for the double clicks of all its widgets (`app/src/clicks.rs`).
- Inner caret: a third or later press selects the line (its start through its line break) and keeps the caret at the press. `Selection` stays a plain range; `EditorState.inner` stores the selection, the caret index and the doc version. The caret counts only while that exact selection is still in the caret set and the version is unchanged, and any key that changes the carets drops it. The drawn caret, the line-number highlight, `cursor()`, `EditorResponse.cursor`, `caret_char()` (the app's caret for F2), Cmd+B, Alt+F7, Escape and Clone Caret use it; `selection().head` does not. Edits, copy, undo and multi-caret commands see the plain line selection. Plain moves start from a bare caret at the inner caret. A Shift move anchors at the line end against the move: the line start for Right, Down, End and PageDown, the line end (next line start) for Left, Up, Home and PageUp. A line drag that changes the selection drops the inner caret.
- Find bar: each `EditorState` owns a `FindState`. The app calls `open_find`, `find_next` and `find_previous`; the view draws the bar at the top of its rect. Replace and Replace All edit through `Document::edit`/`transact`, so Replace All is one undo step.
- `Document::changes_since(version)` lists the raw changes since a version (a journal of the last 4096), so ranges can follow edits. `None` means rescan.
- Carets: `EditorState` holds a `Carets` set (sorted, never overlapping, one primary). `selection()`, `cursor()`, scrolling, navigation and the find bar use the primary. A command at every caret runs through `carets::edit_each`: bottom-up, one undo step (`Document::begin_group`/`end_group`). Line commands (Tab over a selection, Shift+Tab, Cmd+/) touch each line once (`carets::apply_line_edits`). `undo_carets`/`redo_carets` bring every caret back; `undo()` returns the primary.
- Problems: `EditorView::problems(&[ProblemMark])`, sorted by `start`, char indices of the current text. The view draws a wave (error, warning, weak) or a dotted line (unused) under the visible lines and per-severity scrollbar marks cached by a hash of the list. The app shifts the marks through edits; the view never does.
- Row layout strategies (`layout.rs`, details in `docs/soft-wrap.md`): `NoWrap` (one row per line, horizontal scroll) is the old layout and every code file uses it. `SoftWrap` (`wrap.rs`) runs only when `EditorState::soft_wrap()` is on and `wrap::allowed(language)` (Markdown, Plain). Hit tests, Up/Down, Home/End and scroll targets go through the `RowLayout`/`CaretMoves` traits; soft wrap has its own paint loop and gutter. Change the soft-wrap code without touching the `NoWrap` paths; code-file tests and snapshots must stay unchanged.
- Soft wrap: the app sets the default per file (`wrap::default_for`: `.md`, `.txt`, no extension); the context menu item "Soft-Wrap" (only for allowed languages) toggles it on the next frame. A row is a display-column window of its line; continuation rows are indented by the line's leading whitespace if it is at most half the width. A caret index on a row boundary has a side (IDEA's affinity): it is drawn at the start of the next row, unless it leans back (`EditorState.lean`, heads plus doc version), then at the end of the upper row. End, a press past a row's end and Up/Down that land on a row end set the lean; any other caret move, typing, paste and `set_carets` drop it. `visual_row`, `char_center` and `wrap_cols` answer in the drawn layout; `wrap_settled` is false while a sweep counts rows.
- Every context-menu item returns keyboard focus to the editor. The press on the menu takes the focus away, so a new item must keep the `request_focus` after the menu closure.

## Speed rules

- Lay out only the visible lines. Never build one galley for the whole file. Line galleys are cached by content hash, so the cache survives edits above.
- Highlight only the visible lines plus a margin. A burst of edits costs one reparse. Files over 256 KB parse on a worker. Files over 32 MB get no tree.
- Row y and row go through one pair of functions: `row_top` (snapped to physical pixels) for drawing, and `line_at_y` for every hit test (click, drag, hover, gutter, `EditorGeometry::line_at`). Both take a visual row; without soft wrap the row is the line. Each pixel then belongs to exactly one row. `tests/click.rs` sweeps this at 1×, 1.5× and 2×.
- Soft wrap keeps a row count per line (`WrapMap`, block prefix sums). An edit re-wraps only its lines (journal envelope); a width change, a toggle or a lost journal starts a sweep of 1M chars per frame, with the old counts as estimates and the visible lines always exact. The top line on screen stays in place when counts above it change. Rows of lines over 4 KB are cached per (line, version, width), and a row galley is built from the row's slice (`row_job`), so a giant line costs its visible rows.
- Caret x, selection rects and the Cmd+hover underline take their x from the line galley's glyphs (`galley_col_x`). Click-to-column and hover hit-test the glyphs drawn last frame (`display_col_at`). Everything else uses `column_advance(fonts, font)`, the measured step of the same font id and size. Never use a guessed width like `glyph_width('M')`. `tests/caret.rs` checks this at 1×, 1.5× and 2× pixels per point.
- The caret does not blink on purpose, so idle frames cost nothing.
- More than 16 raw edits in one step form a batch: one journal change that spans them and one tree edit. Above 256 KB the batch drops the tree instead and highlights with the last good tree and its old text until the worker's parse lands. A parse in flight is marked to discard, so fast typing never stacks parse threads.
- Code that runs per caret must not copy lines or allocate: at 10k carets each 100 ns costs 1 ms per keystroke. A live rope clone during a batch makes every touched leaf a copy, so a batch keeps the old text only when the tree needs it.
- Find searches on the UI thread up to 256 KB and on a worker above. An edit re-searches only its lines (plus the lines a multiline query spans). A filter, a multiline regex, more than 64 changes or more than 64k dirty chars fall back to a full search. Matches stop at 100k (`MAX_MATCHES`). Scrollbar marks cost the track height, not the match count.

## Test

```sh
cargo test -p ide-editor
cargo test -p ide-editor --release --test bench -- --nocapture   # 200k-line TS file, asserts budgets
```

The release benchmark asserts: keystroke < 4 ms, steady frame < 4 ms, typing frame < 8 ms, jump-scroll frame < 12 ms, and for the find bar: query typing frame < 8 ms, steady frame with 100k matches < 4 ms, typing frame with 100k matches < 8 ms, with 10k carets (`bench_10k_carets`): steady frame < 4 ms, typing and Backspace frames < 8 ms, with 10k problem underlines (`bench_10k_problems`): steady frame < 4 ms, jump-scroll frame < 12 ms, with soft wrap on a 100k-line Markdown file (`bench_wrapped_markdown`): steady < 4 ms, jump-scroll < 12 ms, wheel scroll < 8 ms, typing < 8 ms, sweep and resize frames < 12 ms, and on one 2 MB line (`bench_wrapped_giant_line`): steady < 4 ms, typing and Down < 8 ms. A change in the widget or the highlighter must keep it green. Put the new timings into `docs/timings.md`. Widget behaviour inside the IDE is covered by the app's `editor` and `find_replace` suites (`cargo test -p harwex-ide --test editor`). Soft wrap: `tests/wrap.rs` here, the app's `soft_wrap` suite (snapshots of wrapped Markdown). Do not run `examples/editor.rs`: it opens a foreground window.

## Traps

- ropey runs with its default features, so it breaks lines on CR, VT, FF, NEL, U+2028 and U+2029 as well as LF. TypeScript and git count lines differently. A form feed in a file shifts server positions by one line after it.
- egui snaps every glyph to the pixel grid. At 13 px the nominal advance is 7.8 px, but the drawn step is 8 px. Column math with the nominal width drifts 0.2 px per column (60 px at column 300).
- Code that does not read the galley assumes one measured advance per char: the window starts of lines over 2000 columns, the horizontal scroll range, lines not drawn last frame. Emoji and CJK glyphs misalign there.
- Paste from the context menu goes through `ViewportCommand::RequestPaste` and arrives one frame later.
- Highlights near an edit in a big file can be one parse behind (about 18 ms on 200k lines).
- egui clears the focus on Escape at the start of a frame, unless the focused widget's focus lock filter has `escape: true`. A `TextEdit` sets its own filter, so the find bar sets its filter after adding the field.
- A press on a bar button drops egui's focus from the field. The bar hands the focus back to the field that had it, so Enter and Cmd+G keep working.
- After a multi-caret edit in a file over 256 KB, colors lag by the typed chars for up to ~0.5 s (the full reparse). A file-wide `Tree::edit` would cost ~5 ms and color garbage.
- Double Alt (Clone Caret) is detected from modifier edges between frames: two presses within 0.4 s, the second held. Any other key in between cancels it.
- The bar draws its own line icons (`find_bar.rs`, same 16-grid as the app's `icons.rs`): a library crate cannot use `app`.
- egui's `double_clicked()`/`triple_clicked()` do not fit an editor. egui counts on release, ignores where the click lands and uses a fixed 0.3 s. It calls a click "triple" up to 0.6 s after the click before last. So slow chains drop back to a single click, and quick clicks on different lines select a line.
- A late frame carries several button events. Both presses of a fast double click can land in one frame, and `primary_pressed()` reports them as one press. The view walks the frame's `Event::PointerButton` presses in order and feeds each one into `ClickChain` at its own position. Do not go back to `primary_pressed()`. `tests/click.rs` (`every_press_of_a_merged_frame_counts`) replays the merged frames with `Harness::pointer_frame`.
- At 1.5× a 21 pt row is 31.5 px. Snapped rows alternate between 31 and 32 px, so `floor((y - origin) / line_h)` misses the drawn row by one pixel. Use `line_at_y`.
- Soft wrap: the vertical scrollbar floats over the right edge of the text area and takes the clicks there; rows end `WRAP_MARGIN` (16 pt) before it. A test that clicks right of a row must stay left of the scrollbar.
- Soft wrap: hit tests use the layout drawn last frame (`drawn_wrap`, the row table as painted); moves and painting use this frame's. The toggle therefore takes effect on the next frame.
- `ScrollArea`'s output offset already holds this frame's wheel input, but the frame drew its content at the old offset. Hit tests and the gutter use `drawn_scroll`, the offset the text was drawn with.
