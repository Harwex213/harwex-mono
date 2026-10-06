# xtask

Workspace tasks behind the cargo aliases in `.cargo/config.toml`: `cargo install-ide` builds `harwex-ide` in release and installs it for the current user, and `cargo uninstall-ide` removes everything the install created. `cargo xtask <install|uninstall> [options]` is the long form. `cargo xtask test-tools`, `cargo xtask test` (alias `cargo test-all`), `cargo xtask nextest` and `cargo xtask clean-check` serve the tests (below).

## Boundaries

- std only. The task must build fast. Only `test-tools` uses the network, through the system `curl`, `shasum` and `tar`.
- No IDE logic. The task only builds, copies, registers and checks the language tools.

## What install changes on the user's machine

- `~/opt/harwex-ide/bin/harwex-ide` (`--prefix` changes the root). The copy goes to a temp file and is renamed over the target, so a running IDE keeps its old inode.
- `~/Applications/Harwex IDE.app` on macOS (`--no-app` skips it). The launcher script sets PATH (`/opt/homebrew/bin`, `/usr/local/bin`) and `exec`s the binary. The launcher must not `cd`: Spotlight and the Dock start it with cwd `/`, and that cwd tells the app to reopen the last folder.
- A marked block `# >>> harwex-ide >>>` … `# <<< harwex-ide <<<` in the shell rc file (`--no-path` skips it). Only that block changes. A second run updates the block and never duplicates it.

## Language tool check (`src/tools.rs`)

Before the build, install checks the tools the IDE uses and prints a table. `--no-tools` skips the check.

- `rust-analyzer` is resolved like the app does it: `HARWEX_RUST_ANALYZER`, PATH, `~/.cargo/bin`, then `rustup which rust-analyzer`. A candidate counts only if `--version` answers with `rust-analyzer`. The rustup proxy without the component is a file but fails `--version`, so it counts as missing.
- `rust-src` is present if `$(rustc --print sysroot)/lib/rustlib/src/rust/library` exists.
- `node` and `git` are only reported, with an install hint. The task never installs them.
- A missing component is installed with `rustup component add <name>`. On a TTY (stdin and stdout) the task asks `[y/N]` per component. `--yes` answers yes. Without a TTY and without `--yes`, the task prints the command and skips. A missing rustup prints https://rustup.rs and the commands. A failed install prints rustup's error and the IDE install goes on.
- `--dry-run` prints the table and the `rustup` commands it would run. It asks nothing.
- The prompt: `y`/`yes` installs. `n`, `no`, an empty line or end of input skips. Any other answer is shown back with its control bytes visible (`answer "\u{1b}[Iyy" not understood`) and asked once more. A second unclear answer skips, and the skip message shows that answer.
- Check commands run with `RUSTUP_AUTO_INSTALL=0`, so a `rust-toolchain.toml` naming a missing toolchain does not start a download.
- Uninstall never removes toolchain components.

### Trap: stale bytes in the terminal input

Bytes can wait in the terminal's input queue before the first question: keys typed during the cargo build, or focus reports (`ESC [ O`, `ESC [ I`). `read_line` then returns them together with the user's `y`, and the answer does not match. The guards in `src/tools.rs` must stay:

- `RealHost::ask` calls `tcflush(0, TCIFLUSH)` before it prints the question.
- `parse_answer` drops escape sequences (CSI, OSC, SS3) and control bytes before it matches `y`/`n`. Invalid UTF-8 is not an error.
- Every child gets `stdin(Stdio::null())`, the `rustup component add` run included. No child may read the keys meant for the next question.
- `tests/prompt_pty.rs` runs the built binary in a pseudo-terminal with fake tools, writes stale bytes first and types `y` twice. It fails without the flush and the escape stripping.

Every probe goes through the `Host` trait (commands, files, env, TTY, prompt, output). Tests use a fake `Host`; they never spawn `rustup` and never write to `~/.rustup` or `~/.cargo`.

## Test tools (`src/test_tools.rs`, `src/clean_check.rs`)

- `test-tools` writes only under `<target>/tools/`. The pinned versions and the channel manifest sha256 are the constants at the top of `src/test_tools.rs`. Keep `RUST` at the toolchain's version. npm tarballs are checked against the registry's `dist.integrity`, Rust tarballs against the pinned manifest. A stamp per tool dir makes a second run offline.
- oxlint is pinned with its native binding (`@oxlint/binding-<os>-<arch>`), `oxlint-tsgolint` and its platform binary, all in `oxlint/node_modules`. The app finds tsgolint beside the real oxlint dir and passes it as `OXLINT_TSGOLINT_PATH`.
- ESLint is a whole npm tree, so it is pinned by `src/eslint.lock` (install dir, tarball URL, sha512 per package) instead of single packages. Regenerate the lock from the `package-lock.json` of an `npm install` of the pinned versions, and keep `ESLINT`, `ESLINT_JS` and `TYPESCRIPT_ESLINT` in step (a unit test checks them). The stamp holds a hash of the lock.
- Trap: the rustup build of rust-analyzer needs `../lib/librustc_driver-*.dylib`, so `test-tools` also extracts that file from the `rustc` component.
- `clean-check` copies the workspace without `target/` to `$TMPDIR/harwex-clean`, clears the env (empty HOME, TMPDIR and CARGO_TARGET_DIR, real CARGO_HOME/RUSTUP_HOME, PATH = wrappers for cargo/rustc/rustdoc/git/node plus the OS base dirs) and runs `test-tools`, the pinned nextest (`--success-output immediate`, so `skipping` lines show) and `cargo test --doc` under `sandbox-exec`; without a pinned nextest for the platform, plain `cargo test`. Details in `docs/testing.md`.
- clangd is the release zip of github.com/clangd/clangd (`CLANGD`, a sha256 per zip: `mac` is universal, `linux` is x64) in `tools/clangd/{bin,lib}`. Zips unpack with bsdtar on macOS and `unzip` elsewhere.
- cargo-nextest is a prebuilt release binary in `tools/nextest/`, pinned by `NEXTEST` and a sha256 per release target (macOS universal, Linux gnu); other platforms skip it. `cargo xtask nextest [args]` runs `cargo-nextest nextest run [args]` from the workspace root. Never install it into `~/.cargo`.
- `src/full_test.rs`: `test`, a full `nextest` and `clean-check` take the `flock` on `<target>/full-test.lock` (owner info inside; `docs/testing.md`, "One full run at a time"). Never delete or truncate the lock file outside the holder: a waiter keeps it open, and a new file would give two holders. Suite-only detection is `is_full_run`; a new narrowing flag of nextest or cargo test goes into `NARROWING`.

## Rules for agents

- Never run `cargo install-ide` or `cargo uninstall-ide` without `--dry-run`. Both write to the user's home directory and replace the IDE the user is running. Only the user installs.
- `--dry-run` prints the actions and changes nothing. Use it to check a change in this crate. Point HOME at a temp dir anyway, and keep `CARGO_HOME`/`RUSTUP_HOME` at the real ones so the tool check sees the real toolchain.
- Keep `docs/usage.md` in step with the flags and the install locations.

## Test

```sh
cargo test -p xtask
cargo clippy -p xtask --all-targets -- -D warnings
cargo run -p xtask --release -- install --dry-run     # also: uninstall --dry-run
```

`tests/no_machine_paths.rs` is the workspace guard against absolute machine paths.

Unit tests cover the tool check through a fake `Host`, and the answer parsing on byte strings. `tests/prompt_pty.rs` (unix only) covers the real prompt. The rc-block logic has no tests yet. A change to it (find, replace, remove) should add tests that run on strings, not on real rc files.
