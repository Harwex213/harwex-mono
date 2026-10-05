# ide-term

Integrated terminals: a PTY (`portable-pty`) feeds an `alacritty_terminal` emulator, and an egui widget (`TerminalView`) draws the grid. The user runs long sessions (Claude Code, builds) in these terminals, so a flood of output must never stall the IDE.

## Boundaries

- Never write a VT parser. Emulation is `alacritty_terminal`'s job.
- No app knowledge. A click on `path:line:col` is only reported in `TerminalResponse::open_path`, a Cmd+click on a URL in `open_url`. The app opens the file or the browser.
- The UI thread only copies cells and draws. It never reads or writes the PTY.

## Threads (do not collapse them)

- Reader: blocking 64 KiB PTY reads into a bounded channel of 16 chunks. The bound throttles a flooding child instead of growing memory.
- Parser: drains every queued chunk under one emulator lock (at most 256 KiB per lock) and requests a repaint only when the dirty flag goes from false to true. That gives one repaint per frame.
- Writer: owns the PTY input. Keys, pastes and the emulator's replies (DA, DSR, OSC color queries) go through a channel, so a large paste never blocks the UI or the parser.
- The widget holds the emulator lock only while it copies the visible cells. Layout and painting happen after the lock is released.

## Contract

- `Terminal::spawn(cwd, ctx)` runs `$SHELL -l` (fallback `/bin/zsh`) with `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=harwex-ide`. `SpawnOptions` runs any command (the tests use `zsh -f`).
- `kill()` sends SIGHUP and is idempotent. Dropping a `Terminal` kills its shell and reaps it on a thread, so a closed tab leaves no zombie (portable-pty's kill falls back to SIGKILL after 200 ms and never waits).
- `open_path` line and column are 1-based, as printed. `ide-editor` and the language crates are 0-based, so the app subtracts 1.
- A path is a link on plain hover. A URL is a link only while Cmd is held (`modifiers.command`). An OSC 8 hyperlink (`cell.hyperlink()`) wins over URL text, and a URL wins over a path at the same cell. The exception is a `file://` URL whose path exists: it stays a path link and opens in the editor.
- `open_url` carries only `links::is_openable_url` schemes (http, https, file, mailto). The app checks again before it opens the URL.
- The widget id is unique per `Terminal`, so focus survives tab reordering.
- `is_alt_screen()` tells the app when Escape must reach the program (vim, less, htop).
- `title()` is cheap enough to call every frame.
- Shift+Enter sends `ESC CR` (the Alt+Enter bytes), so Claude Code inserts a newline instead of submitting. Ctrl+Enter stays `CR`. Under the kitty protocol flag `DISAMBIGUATE_ESC_CODES` it sends `CSI 13;2u`.
- `TerminalTheme::islands_dark()` is the default. The app passes `theme::T.terminal`. `src/theme.rs` also owns the `NO_COLOR` sentinel and the emulator RGB conversion.

## Test

```sh
cargo test -p ide-term
cargo test -p ide-term --release -- --ignored --nocapture throughput   # throughput numbers
```

Unit tests spawn real PTYs with short scripts. App behaviour (Alt+F12, focus, Escape routing, link clicks) is covered by `cargo test -p harwex-ide --test app terminal::`. Do not run `examples/term.rs`: it opens a foreground window. `HARWEX_TERM_CMD` and `HARWEX_TERM_STATS` exist only for that example.

## Traps

- macOS `head` line-buffers on a tty and writes 2 bytes per line. `yes | head -c N` measures `head`, not the terminal. Pipe through `cat` for a real throughput number.
- A focused terminal must swallow Tab, the arrows and Esc, or egui moves focus instead.
- Wide chars need their own galley, or they shift the row.
- No bold monospace face is loaded (the app bundles JetBrains Mono Regular only). Bold is a second draw one physical pixel to the right.
- The cell width is `view::cell_advance`, the measured step of a laid-out run. ASCII runs are drawn as one galley, and egui snaps glyphs to the pixel grid. A nominal `glyph_width` drifts from the drawn text on long rows. `cells_match_glyphs_on_a_long_row` tests it.
- `Config::kitty_keyboard` is off, so alacritty never sets the kitty `TermMode` flags and the `CSI 13;2u` branch stays inactive. Turning it on means encoding every key the kitty way (Esc, Ctrl+letters), not only Shift+Enter.
- egui-winit drops control characters from `Event::Text`, so Enter of any kind reaches the widget only as `Event::Key`. `consume_key(Modifiers::NONE, Enter)` elsewhere in the app also matches Shift+Enter (`matches_logically` ignores Shift).
- zsh's vi keymap (picked when `$EDITOR`/`$VISUAL` contains `vi`) reads `ESC CR` as Escape plus accept-line. Tests that type Shift+Enter run `bindkey -e` first.
- URL text ends at whitespace, quotes, `<>`, box drawing and `…`. Trailing `.,;:!?'"` and an unbalanced `)]}` are cut off. URLs are searched on the logical line (soft-wrapped rows joined), so a URL across a wrap is one link. A program that wraps with its own newlines breaks the URL.
- Relative link paths resolve against the foreground process's cwd first (`proc_pidinfo`), then against the spawn directory.
- `blocks.rs` draws Block Elements (U+2580–U+259F), sextants (U+1FB00–U+1FB3B), the Claude Code spinner stars `✢ ✳ ✶ ✻ ✽` and `⎿`. The font is not used for them. JetBrains Mono's block glyphs overshoot the cell by up to 2 px and smear the logo. No bundled font has the sextants, `✢ ✻ ✽` or `⎿`. There is deliberately no screenshot test of a real program's output (the Claude Code banner): such snapshots race the program and were flaky; `blocks.rs` unit tests cover the geometry.
- Drawn rectangles and background runs snap to the physical pixel grid. Neighbour cells then share one edge pixel, so blocks join without seams. An unsnapped rectangle gets an anti-aliased edge that shows as a line between rows.
- Claude Code draws the logo's eyes as the black background (`rgb(0,0,0)`) that a quadrant glyph leaves uncovered. A glyph that bleeds out of its cell hides the eyes.
- Stars are tessellated once per char and cell size (`SymbolCache`) and then copied into the frame's block mesh. A 200x60 screen of stars still costs about 3 ms per frame in release, because each star has about 100 vertices.
- Box drawing (U+2500–U+257F) stays with the font: its lines already join between rows.
