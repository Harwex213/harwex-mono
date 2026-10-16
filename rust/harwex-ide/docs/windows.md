# Windows

harwex-ide builds and runs on Windows 10 1803+ / 11 (`x86_64-pc-windows-msvc`, MSVC Build Tools and the Windows SDK). The unit tests (`cargo test --workspace --lib --bins`) and `cargo clippy --workspace --all-targets -- -D warnings` are green there. The integration suites (`app/tests`, `crates/*/tests`) compile but are not run on Windows: their snapshots are made on macOS, and their fixtures use sh scripts and directory symlinks (Developer Mode).

Read this file when you touch processes, paths, the single-instance socket, the terminal or keyboard handling.

## Contracts

- Paths are canonical through `dunce::canonicalize` (app, ide-git, ide-ts) or `ide_lsp::canonical` (ide-lsp, std only). Never call `std::fs::canonicalize` directly: on Windows it returns `\\?\C:\...`, which servers, git and the UI do not expect. `path_to_uri` strips a leftover verbatim prefix; `uri_to_path` returns `\` separators and an upper-case drive, like `canonicalize`.
- tsserver writes `c:/x/y.ts`. `ide-ts` turns its paths into `C:\x\y.ts` (`server_path`) without touching the disk.
- Strings that the UI splits or groups on `/` (`nav::display_path`, `fileops::relative`, the file index) use `/` on Windows too. The file index stores `/` and `find` joins it back with `\`.
- Every console child of the IDE starts with `CREATE_NO_WINDOW` (`ide_lsp::hide_console`; `ide-git` has its own constant). A new `Command` in the app or a crate needs it, or a GUI start flashes a console window per spawn.
- A process tree is killed with `taskkill /T /F` (`ide_lsp::kill_tree`, `ide-git` `cancel::kill_tree`). Windows has no process groups and no graceful signal for a console program without a console, so a cancelled git dies at once and may leave `index.lock` (git reports it on the next write; the app still never deletes it).
- Executables are looked up with `.exe` (`os::exe`): git, node (`.exe`, then `.cmd`), rust-analyzer, rustup, rustc, clangd, dotnet, tsgolint, the TS 7 native binary. Beside `node.exe` the npm to run is `npm.cmd`; `node_modules/.bin/*` are sh shims and are never started.
- A child's PATH is built with `std::env::join_paths` (`os::prepend_path`), never with `:`.
- `HOME` is unset on Windows: use `os::home_dir()` (`HOME`, else `USERPROFILE`).
- Single instance (`instance.rs`): an AF_UNIX socket through `uds_windows`, named after `USERNAME` in the per-user temp dir. The path travels as UTF-16LE. A socket file is any reparse point there; the file identity is its creation time (no inode).
- The terminal runs `pwsh.exe -NoLogo`, else `powershell.exe -NoLogo`, through ConPTY. The cwd of the foreground process is unknown there (no process group), so relative links resolve against the spawn directory.
- Keyboard: IDEA's Windows keymap off macOS (`ide-editor/src/keys.rs`, `crates/ide-editor/CLAUDE.md`). Shortcut texts are written in macOS glyphs and shown through `ide_editor::shortcut_label`.
- `fileops::SystemPlatform`: Reveal is `explorer /select,"<path>"` (a raw argument; explorer exits 1 on success), URLs open through `ShellExecuteW`, trash is the Recycle Bin (`SHFileOperationW` with `FOF_ALLOWUNDO`), Copy Image writes the image through arboard (no text alongside). Names typed into New/Rename refuse `<>:"|?*`, device names and a trailing dot or space; `\` separates folders like `/`.
- Startup folder: the release build has no console (`windows_subsystem = "windows"`), so the TTY check never fires. A start in the exe's folder, the drive root or under `%SystemRoot%` counts as a launcher start (reopen the last folder); any other cwd opens that folder.
- The memory indicator walks a Toolhelp snapshot (one per sample) and shows the private commit (`PrivateUsage`). A child older than its parent is not a child: Windows keeps a dead parent's pid in its children.
- `cargo install-ide` / `uninstall-ide` work on Windows: `%LOCALAPPDATA%\Programs\harwex-ide`, a Start menu shortcut and the user PATH in the registry (`xtask/CLAUDE.md`).
- `cargo xtask test`: Windows file locks are mandatory, so the owner info of `full-test.lock` lives in `full-test.owner` beside it.

## Traps

- `git.autocrlf=true` checks the sources out with CRLF. Never edit them with `sed`/`perl` across lines from Git Bash: the inserted `\n` mixes endings and `perl -0pi` rewrote a whole file once. Use the Edit tool.
- JSON built with `format!` and a Windows path breaks: `\U` is an escape. Tests write such paths with `/`.
- Tests that compare `path.display()` strings fail when one side was joined from `"a/b"` and the other came from the disk. Join per component (`.join("a").join("b")`) or compare `Path`s.
- Clippy on a newer toolchain flags `large_enum_variant` on Windows only, because `PathBuf` is larger there.

## Not done yet

See the `Windows:` lines in `docs/backlog.md`.
