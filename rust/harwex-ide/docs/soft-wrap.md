# Soft wrap (ide-editor)

Read this when you change the soft-wrap strategy (`crates/ide-editor/src/wrap.rs`, `layout.rs`, the `WrapPaint` and `wrap_gutter` parts of `view.rs`).

## Two strategies

- `layout.rs` defines `RowLayout` (hit tests: `line_under`, `hit`, `cell`, `gutter_line`, `hover`) and `CaretMoves` (`x_col`, `vertical`, `home`, `end`, `place`).
- `NoWrap` + `LineMoves` hold the old code, moved without changes. Code files always use them.
- `SoftWrap` + `RowMoves` (`wrap.rs`) are used only when the editor's soft wrap is on and the language is Markdown or Plain (`wrap::allowed`).
- Painting is split, not shared: the old loop in `EditorView::show` stays as it was; `WrapPaint::paint` draws soft-wrapped rows; `wrap_gutter` and `wrap_scroll_marks` are the wrapped gutter and scrollbar marks.

## Rows

- `wrap::breaks(text, cols)` is a greedy wrap. A row breaks after the last whitespace that fits. A word longer than the row breaks before the first char that does not fit. Whitespace never forces a break: it hangs past the edge. The leading whitespace of a line is not a break point. Every row holds at least one char.
- Continuation rows are indented by the line's leading whitespace (`continuation_indent`) when it is at most half the width; they then have `cols - indent` columns.
- `RowStart { char, col, byte }`: the row's first char, its display column in the line and its byte offset. A row is the display-column window `starts[k].col..starts[k + 1].col` of its line. `row_job` lays out the row's slice with the tab stops of the whole line.
- `LineRows` answers per line: `row_of(col)` (a boundary index belongs to the next row), `chars(k)`, `row_end(k)` (one char before the next row's start, or the line end), `col_at` and `display_col` (both count from the row start).
- The width: `wrap_cols(text_rect.width, char_w)` = (width − 6 pt pad − 16 pt margin) / char_w, at least 8.

## Row table (`WrapMap`)

- `rows: Vec<u32>` per line, `blocks`: the first row of every 256 lines. `row_of_line` and `line_of_row` cost at most one block of adds.
- `sync(doc, cols)` runs once per frame, after the input:
  - Edits: `changes_since(version)` gives one envelope in chars of the current text. Lines `l0..=l1` are re-counted, the vector is spliced (the line-count delta comes from the old vector length). An envelope over 4096 lines falls back to estimates plus a sweep from `l0`.
  - A lost journal, a width change or the first sync start a sweep from line 0: `SWEEP_CHARS` (1M) chars per frame, read through `rope.lines_at`. Counts that the sweep has not reached yet are estimates (the old width's count, or 1). The view asks for frames while `sweeping()`.
  - Painting re-wraps every visible line and corrects its count (`set`), so the visible part is always exact.
- `line_rows(version, line, text, cols)` caches the `LineRows` of lines of 4 KB or more (8 entries), so a giant line is scanned once per edit, not once per use.

## Caret side at a row boundary

The index after the last char of a wrapped row is also the next row's first index. `LineRows::is_boundary(k, col)` says so; `row_end(k)` is that index. A caret there leans back when End, a press past the row's end (`SoftWrap::leans` after `hit`) or Up/Down (`RowMoves::land`) put it there. The view keeps the leaning heads in `EditorState.lean` with the doc version. During a frame `RowMoves::lean_in` is the working copy: presses write it, a key that changed the carets replaces it with `lean_out`, typing and paste clear it. Before painting, heads that are no longer caret heads are dropped. `RowMoves::at` puts a leaning caret on the upper row, so Home, End, Up/Down and scrolling start from where it is drawn; `WrapPaint` draws it and the current-row band there. Typed text goes in at the index, so it follows the row's last char.

## Scroll anchor

Each frame records the top line on screen (`Anchor`: line, row inside it, its content row, pixel offset). The next frame restores it when the strategy changed (toggle) or when soft wrap is on and that line's row moved (a sweep or re-wrap above the viewport). A reveal, find or caret scroll wins over the anchor.

## Limits

- Clone Caret (double Alt + Up/Down) and column selection (Alt+Shift drag) still work by logical lines and display columns.
- One glyph per display column is assumed for wrapping; CJK and emoji rows can run past the edge.
- `EditorGeometry::char_center`, `mark_center` and `annotation_center` assume no wrap; use `EditorState::char_center` and `visual_row`.
