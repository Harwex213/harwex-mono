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
- Mouse: the editor counts its own click chain on press (`ClickChain`): presses within egui's `max_double_click_delay` and 6 pt of the last one. Press 1 places the caret, press 2 selects the word, press 3 and later the whole line. A drag then extends by chars, words or lines. Shift, Alt, Cmd and middle presses end the chain. The app sets `max_double_click_delay` to the system interval outside tests.
- Find bar: each `EditorState` owns a `FindState`. The app calls `open_find`, `find_next` and `find_previous`; the view draws the bar at the top of its rect. Replace and Replace All edit through `Document::edit`/`transact`, so Replace All is one undo step.
- `Document::changes_since(version)` lists the raw changes since a version (a journal of the last 4096), so ranges can follow edits. `None` means rescan.
- Carets: `EditorState` holds a `Carets` set (sorted, never overlapping, one primary). `selection()`, `cursor()`, scrolling, navigation and the find bar use the primary. A command at every caret runs through `carets::edit_each`: bottom-up, one undo step (`Document::begin_group`/`end_group`). Line commands (Tab over a selection, Shift+Tab, Cmd+/) touch each line once (`carets::apply_line_edits`). `undo_carets`/`redo_carets` bring every caret back; `undo()` returns the primary.
- Every context-menu item returns keyboard focus to the editor. The press on the menu takes the focus away, so a new item must keep the `request_focus` after the menu closure.

## Speed rules

- Lay out only the visible lines. Never build one galley for the whole file. Line galleys are cached by content hash, so the cache survives edits above.
- Highlight only the visible lines plus a margin. A burst of edits costs one reparse. Files over 256 KB parse on a worker. Files over 32 MB get no tree.
- Row y and line go through one pair of functions: `row_top` (snapped to physical pixels) for drawing, and `line_at_y` for every hit test (click, drag, hover, gutter, `EditorGeometry::line_at`). Each pixel then belongs to exactly one line. `tests/click.rs` sweeps this at 1×, 1.5× and 2×.
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

The release benchmark asserts: keystroke < 4 ms, steady frame < 4 ms, typing frame < 8 ms, jump-scroll frame < 12 ms, and for the find bar: query typing frame < 8 ms, steady frame with 100k matches < 4 ms, typing frame with 100k matches < 8 ms, and with 10k carets (`bench_10k_carets`): steady frame < 4 ms, typing and Backspace frames < 8 ms. A change in the widget or the highlighter must keep it green. Put the new timings into `docs/timings.md`. Widget behaviour inside the IDE is covered by the app's `editor` and `find_replace` suites (`cargo test -p harwex-ide --test editor`). Do not run `examples/editor.rs`: it opens a foreground window.

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
- At 1.5× a 21 pt row is 31.5 px. Snapped rows alternate between 31 and 32 px, so `floor((y - origin) / line_h)` misses the drawn row by one pixel. Use `line_at_y`.
- `ScrollArea`'s output offset already holds this frame's wheel input, but the frame drew its content at the old offset. Hit tests and the gutter use `drawn_scroll`, the offset the text was drawn with.
