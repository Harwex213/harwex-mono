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

## Speed rules

- Lay out only the visible lines. Never build one galley for the whole file. Line galleys are cached by content hash, so the cache survives edits above.
- Highlight only the visible lines plus a margin. A burst of edits costs one reparse. Files over 256 KB parse on a worker. Files over 32 MB get no tree.
- Caret x, selection rects and the Cmd+hover underline take their x from the line galley's glyphs (`galley_col_x`). Click-to-column and hover hit-test the glyphs drawn last frame (`display_col_at`). Everything else uses `column_advance(fonts, font)`, the measured step of the same font id and size. Never use a guessed width like `glyph_width('M')`. `tests/caret.rs` checks this at 1×, 1.5× and 2× pixels per point.
- The caret does not blink on purpose, so idle frames cost nothing.

## Test

```sh
cargo test -p ide-editor
cargo test -p ide-editor --release --test bench -- --nocapture   # 200k-line TS file, asserts budgets
```

The release benchmark asserts: keystroke < 4 ms, steady frame < 4 ms, typing frame < 8 ms, jump-scroll frame < 12 ms. A change in the widget or the highlighter must keep it green. Put the new timings into `docs/timings.md`. Widget behaviour inside the IDE is covered by the app's `editor` suite (`cargo test -p harwex-ide --test editor`). Do not run `examples/editor.rs`: it opens a foreground window.

## Traps

- ropey runs with its default features, so it breaks lines on CR, VT, FF, NEL, U+2028 and U+2029 as well as LF. TypeScript and git count lines differently. A form feed in a file shifts server positions by one line after it.
- egui snaps every glyph to the pixel grid. At 13 px the nominal advance is 7.8 px, but the drawn step is 8 px. Column math with the nominal width drifts 0.2 px per column (60 px at column 300).
- Code that does not read the galley assumes one measured advance per char: the window starts of lines over 2000 columns, the horizontal scroll range, lines not drawn last frame. Emoji and CJK glyphs misalign there.
- Paste from the context menu goes through `ViewportCommand::RequestPaste` and arrives one frame later.
- Highlights near an edit in a big file can be one parse behind (about 18 ms on 200k lines).
