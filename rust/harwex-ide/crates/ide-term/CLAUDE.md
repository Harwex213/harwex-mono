# ide-term

Integrated terminals: a PTY (`portable-pty`) feeds an `alacritty_terminal` emulator, and an egui widget (`TerminalView`) draws the grid. The user runs long sessions (Claude Code, builds) in these terminals, so a flood of output must never stall the IDE.

## Boundaries

- Never write a VT parser. Emulation is `alacritty_terminal`'s job.
- No app knowledge. A click on `path:line:col` is only reported in `TerminalResponse::open_path`. The app opens the file.
- The UI thread only copies cells and draws. It never reads or writes the PTY.

## Threads (do not collapse them)

- Reader: blocking 64 KiB PTY reads into a bounded channel of 16 chunks. The bound throttles a flooding child instead of growing memory.
- Parser: drains every queued chunk under one emulator lock (at most 256 KiB per lock) and requests a repaint only when the dirty flag goes from false to true. That gives one repaint per frame.
- Writer: owns the PTY input. Keys, pastes and the emulator's replies (DA, DSR, OSC color queries) go through a channel, so a large paste never blocks the UI or the parser.
- The widget holds the emulator lock only while it copies the visible cells. Layout and painting happen after the lock is released.

## Contract

- `Terminal::spawn(cwd, ctx)` runs `$SHELL -l` (fallback `/bin/zsh`) with `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=harwex-ide`. `SpawnOptions` runs any command (the tests use `zsh -f`).
- `kill()` sends SIGHUP and is idempotent. Dropping a `Terminal` kills its shell.
- `open_path` line and column are 1-based, as printed. `ide-editor` and the language crates are 0-based, so the app subtracts 1.
- The widget id is unique per `Terminal`, so focus survives tab reordering.
- `is_alt_screen()` tells the app when Escape must reach the program (vim, less, htop).
- `title()` is cheap enough to call every frame.
- `TerminalTheme::islands_dark()` is the default. The app passes `theme::T.terminal`. `src/theme.rs` also owns the `NO_COLOR` sentinel and the emulator RGB conversion.

## Test

```sh
cargo test -p ide-term
cargo test -p ide-term --release -- --ignored --nocapture throughput   # throughput numbers
```

Unit tests spawn real PTYs with short scripts. App behaviour (Alt+F12, focus, Escape routing, link clicks) is covered by `cargo test -p harwex-ide --test terminal`. Do not run `examples/term.rs`: it opens a foreground window. `HARWEX_TERM_CMD` and `HARWEX_TERM_STATS` exist only for that example.

## Traps

- macOS `head` line-buffers on a tty and writes 2 bytes per line. `yes | head -c N` measures `head`, not the terminal. Pipe through `cat` for a real throughput number.
- A focused terminal must swallow Tab, the arrows and Esc, or egui moves focus instead.
- Wide chars need their own galley, or they shift the row.
- No bold monospace face is loaded (the app bundles JetBrains Mono Regular only). Bold is a second draw one physical pixel to the right.
- The cell width is `view::cell_advance`, the measured step of a laid-out run. ASCII runs are drawn as one galley, and egui snaps glyphs to the pixel grid. A nominal `glyph_width` drifts from the drawn text on long rows. `cells_match_glyphs_on_a_long_row` tests it.
- Relative link paths resolve against the foreground process's cwd first (`proc_pidinfo`), then against the spawn directory.
