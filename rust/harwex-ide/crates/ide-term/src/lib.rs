//! Integrated terminal: a PTY (`portable-pty`) feeding an `alacritty_terminal` emulator, drawn
//! by an egui widget.
//!
//! Threads per terminal:
//! - reader: blocking reads from the PTY master, hands chunks to the parser over a bounded
//!   channel. The bound gives back-pressure, so a flood (`yes`) throttles the child instead of
//!   growing memory.
//! - parser: drains every chunk that is already queued, feeds them to the emulator under one
//!   lock, then asks egui for one repaint. Batching keeps lock traffic and repaints per frame,
//!   not per read.
//! - writer: owns the PTY input. Keys, pastes and the emulator's own replies (DA, DSR, OSC
//!   queries) go through a channel, so a large paste or a child that stops reading never
//!   blocks the UI or the parser.

mod keys;
mod links;
mod theme;
mod view;

pub use keys::{key_to_bytes, paste_bytes, KeyMode};
pub use links::{path_at, resolve as resolve_path, PathHit};
pub use theme::TerminalTheme;
pub use view::{TerminalResponse, TerminalView};

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use alacritty_terminal::event::{Event, EventListener, WindowSize};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::sync::FairMutex;
use alacritty_terminal::term::{Config, Term, TermMode};
use alacritty_terminal::vte::ansi::{self, Handler};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

/// Bytes the parser feeds to the emulator before it releases the lock so the UI can draw.
/// 256 KiB parse in about 2 ms, so a frame never waits long for the lock during a flood.
const MAX_LOCKED_BYTES: usize = 256 * 1024;
/// Read size and queue depth: at most 16 x 64 KiB waits between the reader and the parser.
const READ_CHUNK: usize = 64 * 1024;
const QUEUE_DEPTH: usize = 16;

pub(crate) type Emulator = Term<Listener>;

/// Grid size handed to the emulator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GridSize {
    pub cols: usize,
    pub rows: usize,
}

impl Dimensions for GridSize {
    fn total_lines(&self) -> usize {
        self.rows
    }
    fn screen_lines(&self) -> usize {
        self.rows
    }
    fn columns(&self) -> usize {
        self.cols
    }
}

/// State the emulator reports through events. It is written on the parser thread while the
/// emulator lock is held, so it cannot live inside the emulator itself.
pub(crate) struct EventState {
    title: Mutex<Option<String>>,
    clipboard: Mutex<Option<String>>,
    palette: Mutex<TerminalTheme>,
    window: Mutex<WindowSize>,
    writer: Sender<Vec<u8>>,
}

#[derive(Clone)]
pub(crate) struct Listener(Arc<EventState>);

impl EventListener for Listener {
    fn send_event(&self, event: Event) {
        let state = &self.0;
        match event {
            Event::Title(title) => *state.title.lock().unwrap() = Some(title),
            Event::ResetTitle => *state.title.lock().unwrap() = None,
            Event::ClipboardStore(_, text) => *state.clipboard.lock().unwrap() = Some(text),
            Event::PtyWrite(text) => {
                let _ = state.writer.send(text.into_bytes());
            }
            Event::ColorRequest(index, format) => {
                let rgb = state.palette.lock().unwrap().slot_rgb(index);
                let _ = state.writer.send(format(rgb).into_bytes());
            }
            Event::TextAreaSizeRequest(format) => {
                let size = *state.window.lock().unwrap();
                let _ = state.writer.send(format(size).into_bytes());
            }
            _ => {}
        }
    }
}

/// Flags shared by the I/O threads and the UI.
pub(crate) struct IoState {
    /// Set by the parser after new output, cleared by the view when it draws. Only the
    /// false -> true edge requests a repaint, which coalesces a flood into one repaint per frame.
    dirty: AtomicBool,
    alive: AtomicBool,
    bytes: AtomicU64,
}

/// What to run and how big the PTY starts. `Terminal::spawn` uses the login shell.
#[derive(Clone, Debug)]
pub struct SpawnOptions {
    pub cwd: PathBuf,
    /// Program and arguments. `None` runs `$SHELL -l` (fallback `/bin/zsh`).
    pub command: Option<Vec<String>>,
    /// Extra environment, applied after `TERM`/`COLORTERM`.
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
    /// Scrollback lines kept above the screen.
    pub scrollback: usize,
}

impl SpawnOptions {
    pub fn new(cwd: &Path) -> Self {
        SpawnOptions {
            cwd: cwd.to_path_buf(),
            command: None,
            env: Vec::new(),
            cols: 80,
            rows: 24,
            scrollback: 10_000,
        }
    }
}

pub struct Terminal {
    pub(crate) emulator: Arc<FairMutex<Emulator>>,
    pub(crate) events: Arc<EventState>,
    pub(crate) io: Arc<IoState>,
    master: Box<dyn MasterPty + Send>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    writer: Sender<Vec<u8>>,
    cwd: PathBuf,
    program_name: String,
    killed: bool,
    pub(crate) size: GridSize,
    pub(crate) theme: TerminalTheme,
    pub(crate) view: view::ViewState,
}

fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string())
}

impl Terminal {
    /// Starts the user's login shell in `cwd`. `ctx` is used to request repaints on output.
    pub fn spawn(cwd: &Path, ctx: egui::Context) -> std::io::Result<Terminal> {
        Self::spawn_with(SpawnOptions::new(cwd), ctx)
    }

    pub fn spawn_with(options: SpawnOptions, ctx: egui::Context) -> std::io::Result<Terminal> {
        let pty_size = PtySize {
            rows: options.rows.max(1),
            cols: options.cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = native_pty_system().openpty(pty_size).map_err(io_err)?;

        let argv = options
            .command
            .clone()
            .unwrap_or_else(|| vec![login_shell(), "-l".to_string()]);
        let program_name = Path::new(&argv[0])
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| argv[0].clone());
        let mut cmd = CommandBuilder::from_argv(argv.iter().map(Into::into).collect());
        cmd.cwd(&options.cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // Inherited values describe the terminal the IDE was started from, not this one.
        cmd.env("TERM_PROGRAM", "harwex-ide");
        cmd.env_remove("TERM_PROGRAM_VERSION");
        cmd.env_remove("TERM_SESSION_ID");
        cmd.env_remove("ITERM_SESSION_ID");
        // An app started from Finder has no locale, and zsh then mangles UTF-8 input.
        if std::env::var_os("LANG").is_none() && std::env::var_os("LC_ALL").is_none() {
            cmd.env("LANG", "en_US.UTF-8");
        }
        for (k, v) in &options.env {
            cmd.env(k, v);
        }
        let child = pair.slave.spawn_command(cmd).map_err(io_err)?;
        // The master only sees EOF when every slave handle is closed, so ours must go now.
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(io_err)?;
        let pty_writer = pair.master.take_writer().map_err(io_err)?;

        let (write_tx, write_rx) = mpsc::channel::<Vec<u8>>();
        let size = GridSize {
            cols: pty_size.cols as usize,
            rows: pty_size.rows as usize,
        };
        let events = Arc::new(EventState {
            title: Mutex::new(None),
            clipboard: Mutex::new(None),
            palette: Mutex::new(TerminalTheme::default()),
            window: Mutex::new(WindowSize {
                num_lines: pty_size.rows,
                num_cols: pty_size.cols,
                cell_width: 8,
                cell_height: 16,
            }),
            writer: write_tx.clone(),
        });
        let config = Config {
            scrolling_history: options.scrollback,
            ..Config::default()
        };
        let emulator = Arc::new(FairMutex::new(Term::new(
            config,
            &size,
            Listener(events.clone()),
        )));
        let io = Arc::new(IoState {
            dirty: AtomicBool::new(false),
            alive: AtomicBool::new(true),
            bytes: AtomicU64::new(0),
        });

        let (chunk_tx, chunk_rx) = mpsc::sync_channel::<Vec<u8>>(QUEUE_DEPTH);
        std::thread::Builder::new()
            .name("ide-term-reader".into())
            .spawn(move || read_loop(reader, chunk_tx))?;
        {
            let emulator = emulator.clone();
            let io = io.clone();
            std::thread::Builder::new()
                .name("ide-term-parser".into())
                .spawn(move || parse_loop(chunk_rx, emulator, io, ctx))?;
        }
        std::thread::Builder::new()
            .name("ide-term-writer".into())
            .spawn(move || write_loop(pty_writer, write_rx))?;

        Ok(Terminal {
            emulator,
            events,
            io,
            master: pair.master,
            child: Mutex::new(child),
            writer: write_tx,
            cwd: options.cwd,
            program_name,
            killed: false,
            size,
            theme: TerminalTheme::default(),
            view: view::ViewState::default(),
        })
    }

    /// The OSC 0/2 title when the program set one, else the program name (e.g. "zsh").
    pub fn title(&self) -> String {
        self.events
            .title
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| self.program_name.clone())
    }

    pub fn is_alive(&self) -> bool {
        if self.killed || !self.io.alive.load(Ordering::Acquire) {
            return false;
        }
        matches!(self.child.lock().unwrap().try_wait(), Ok(None))
    }

    /// Sends SIGHUP to the child, like closing a terminal window. Idempotent.
    pub fn kill(&mut self) {
        if !self.killed {
            self.killed = true;
            let _ = self.child.lock().unwrap().kill();
        }
    }

    /// The directory the terminal was started in.
    pub fn cwd(&self) -> &Path {
        &self.cwd
    }

    /// The pid of the shell this terminal started. The app's memory indicator leaves this
    /// process and its whole subtree out of its total.
    pub fn process_id(&self) -> Option<u32> {
        self.child.lock().unwrap().process_id()
    }

    /// The working directory of the foreground process (the shell after `cd`), when the OS
    /// can tell. Used to resolve relative paths in the output.
    pub fn current_dir(&self) -> Option<PathBuf> {
        let pid = self
            .master
            .process_group_leader()
            .or_else(|| self.child.lock().unwrap().process_id().map(|p| p as i32))?;
        process_cwd(pid)
    }

    /// Writes raw bytes to the child's input.
    pub fn write(&self, bytes: impl Into<Vec<u8>>) {
        let bytes = bytes.into();
        if !bytes.is_empty() {
            let _ = self.writer.send(bytes);
        }
    }

    /// Pastes text, bracketed when the program asked for it (DECSET 2004).
    pub fn paste(&self, text: &str) {
        let bracketed = self
            .emulator
            .lock()
            .mode()
            .contains(TermMode::BRACKETED_PASTE);
        self.write(paste_bytes(text, bracketed));
    }

    /// True while the program uses the alternate screen (vim, less, htop). Such programs want
    /// Escape and other keys the host app would otherwise take for itself.
    pub fn is_alt_screen(&self) -> bool {
        self.emulator.lock().mode().contains(TermMode::ALT_SCREEN)
    }

    /// Cmd+K: drops the scrollback and moves the cursor's line to the top of the screen.
    /// Doing it locally works for any shell, without the shell's help.
    pub fn clear(&self) {
        let mut term = self.emulator.lock();
        if !term.mode().contains(TermMode::ALT_SCREEN) {
            let cursor = term.grid().cursor.point;
            if cursor.line.0 > 0 {
                term.scroll_up(cursor.line.0 as usize);
                term.goto(0, cursor.column.0);
            }
        }
        term.grid_mut().clear_history();
        term.selection = None;
        term.scroll_display(Scroll::Bottom);
    }

    /// Resizes the emulator and the PTY (SIGWINCH). Cell sizes are in physical pixels and
    /// only matter for programs that ask (`CSI 14 t`).
    pub fn resize(&mut self, cols: u16, rows: u16, cell_width: u16, cell_height: u16) {
        let size = GridSize {
            cols: cols.max(2) as usize,
            rows: rows.max(1) as usize,
        };
        *self.events.window.lock().unwrap() = WindowSize {
            num_lines: size.rows as u16,
            num_cols: size.cols as u16,
            cell_width,
            cell_height,
        };
        if size == self.size {
            return;
        }
        self.size = size;
        self.emulator.lock().resize(size);
        let _ = self.master.resize(PtySize {
            rows: size.rows as u16,
            cols: size.cols as u16,
            pixel_width: cell_width.saturating_mul(size.cols as u16),
            pixel_height: cell_height.saturating_mul(size.rows as u16),
        });
    }

    /// Columns and rows of the grid.
    pub fn grid_size(&self) -> (usize, usize) {
        (self.size.cols, self.size.rows)
    }

    /// Visible screen text, one line per row with trailing spaces trimmed.
    pub fn screen_text(&self) -> String {
        let term = self.emulator.lock();
        let grid = term.grid();
        let offset = grid.display_offset() as i32;
        let mut out = String::new();
        for row in 0..grid.screen_lines() as i32 {
            let line = &grid[Line(row - offset)];
            let mut text: String = (0..grid.columns())
                .map(|c| match line[Column(c)].c {
                    '\t' => ' ',
                    c => c,
                })
                .collect();
            text.truncate(text.trim_end().len());
            out.push_str(&text);
            out.push('\n');
        }
        out
    }

    /// Total bytes the emulator has parsed, for throughput measurements.
    pub fn bytes_processed(&self) -> u64 {
        self.io.bytes.load(Ordering::Relaxed)
    }

    pub fn set_theme(&mut self, theme: TerminalTheme) {
        if theme != self.theme {
            *self.events.palette.lock().unwrap() = theme.clone();
            self.theme = theme;
        }
    }

    pub fn theme(&self) -> &TerminalTheme {
        &self.theme
    }

    /// Scrolls the view back to the live screen.
    pub fn scroll_to_bottom(&self) {
        self.emulator.lock().scroll_display(Scroll::Bottom);
    }

    pub(crate) fn take_osc52_clipboard(&self) -> Option<String> {
        self.events.clipboard.lock().unwrap().take()
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        self.kill();
    }
}

/// portable-pty reports `anyhow::Error`; the public API promises `std::io::Error`.
fn io_err(e: impl std::fmt::Display) -> std::io::Error {
    std::io::Error::other(e.to_string())
}

fn read_loop(mut reader: Box<dyn Read + Send>, tx: SyncSender<Vec<u8>>) {
    let mut buf = vec![0u8; READ_CHUNK];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            // EIO is how macOS and Linux report that the child side closed.
            Err(_) => break,
        }
    }
}

fn parse_loop(
    rx: Receiver<Vec<u8>>,
    emulator: Arc<FairMutex<Emulator>>,
    io: Arc<IoState>,
    ctx: egui::Context,
) {
    let mut parser: ansi::Processor = ansi::Processor::new();
    let notify = |io: &IoState| {
        if !io.dirty.swap(true, Ordering::AcqRel) {
            ctx.request_repaint();
        }
    };
    loop {
        // A synchronized update (DECSET 2026) holds output back until it ends or times out,
        // so wake up at the deadline even if no more bytes arrive.
        let first = match parser.sync_timeout().sync_timeout() {
            Some(deadline) => {
                match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                    Ok(chunk) => Some(chunk),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
            None => match rx.recv() {
                Ok(chunk) => Some(chunk),
                Err(_) => break,
            },
        };
        let mut term = emulator.lock();
        let mut parsed = 0usize;
        if let Some(chunk) = first {
            parser.advance(&mut *term, &chunk);
            parsed += chunk.len();
            while parsed < MAX_LOCKED_BYTES {
                match rx.try_recv() {
                    Ok(chunk) => {
                        parser.advance(&mut *term, &chunk);
                        parsed += chunk.len();
                    }
                    Err(_) => break,
                }
            }
        }
        if parser
            .sync_timeout()
            .sync_timeout()
            .is_some_and(|d| d <= Instant::now())
        {
            parser.stop_sync(&mut *term);
        }
        drop(term);
        io.bytes.fetch_add(parsed as u64, Ordering::Relaxed);
        notify(&io);
    }
    let mut term = emulator.lock();
    parser.stop_sync(&mut *term);
    parser.advance(&mut *term, b"\r\n\x1b[0;2m[Process completed]\x1b[0m");
    drop(term);
    io.alive.store(false, Ordering::Release);
    notify(&io);
}

fn write_loop(mut writer: Box<dyn Write + Send>, rx: Receiver<Vec<u8>>) {
    while let Ok(bytes) = rx.recv() {
        if writer
            .write_all(&bytes)
            .and_then(|_| writer.flush())
            .is_err()
        {
            break;
        }
    }
}

#[cfg(target_os = "macos")]
fn process_cwd(pid: i32) -> Option<PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    // SAFETY: proc_pidinfo fills a plain C struct of the size we pass; a short result means
    // failure and the buffer is not read.
    unsafe {
        let mut info: libc::proc_vnodepathinfo = std::mem::zeroed();
        let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as i32;
        let n = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        );
        if n != size {
            return None;
        }
        let path = &info.pvi_cdir.vip_path;
        let bytes =
            std::slice::from_raw_parts(path.as_ptr() as *const u8, std::mem::size_of_val(path));
        let len = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        (len > 0).then(|| PathBuf::from(std::ffi::OsStr::from_bytes(&bytes[..len])))
    }
}

#[cfg(target_os = "linux")]
fn process_cwd(pid: i32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/cwd")).ok()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn process_cwd(_pid: i32) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn wait_for(term: &Terminal, what: impl Fn(&str) -> bool) -> String {
        let start = Instant::now();
        loop {
            let text = term.screen_text();
            if what(&text) || start.elapsed() > Duration::from_secs(10) {
                return text;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn sh(script: &str) -> SpawnOptions {
        let mut options = SpawnOptions::new(&std::env::temp_dir());
        options.command = Some(vec!["/bin/sh".into(), "-c".into(), script.into()]);
        options
    }

    #[test]
    fn echo_hi_lands_in_the_grid() {
        let term = Terminal::spawn_with(sh("echo hi"), egui::Context::default()).unwrap();
        let text = wait_for(&term, |t| t.lines().any(|l| l == "hi"));
        assert!(text.lines().any(|l| l == "hi"), "screen was:\n{text}");
        let start = Instant::now();
        while term.is_alive() && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!term.is_alive());
    }

    #[test]
    fn env_title_and_input() {
        let mut options =
            sh(r#"printf '\033]0;my title\007'; echo "$TERM $COLORTERM"; read x; echo "got:$x""#);
        options.cols = 100;
        let term = Terminal::spawn_with(options, egui::Context::default()).unwrap();
        let text = wait_for(&term, |t| t.contains("xterm-256color truecolor"));
        assert!(
            text.contains("xterm-256color truecolor"),
            "screen was:\n{text}"
        );
        assert_eq!(term.title(), "my title");
        term.write("abc\r");
        let text = wait_for(&term, |t| t.contains("got:abc"));
        assert!(text.contains("got:abc"), "screen was:\n{text}");
    }

    #[test]
    fn resize_reaches_the_child() {
        let mut term =
            Terminal::spawn_with(sh("read x; stty size"), egui::Context::default()).unwrap();
        term.resize(120, 40, 16, 32);
        // Let the resize land before the child asks for it.
        std::thread::sleep(Duration::from_millis(100));
        term.write("\r");
        let text = wait_for(&term, |t| t.contains("40 120"));
        assert!(text.contains("40 120"), "screen was:\n{text}");
        assert_eq!(term.grid_size(), (120, 40));
    }

    #[test]
    fn clear_drops_scrollback() {
        let term = Terminal::spawn_with(sh("seq 1 100; read x"), egui::Context::default()).unwrap();
        wait_for(&term, |t| t.contains("100"));
        assert!(term.emulator.lock().grid().history_size() > 0);
        term.clear();
        assert_eq!(term.emulator.lock().grid().history_size(), 0);
    }

    /// `cargo test -p ide-term --release -- --ignored --nocapture throughput`
    ///
    /// `yes | head -c` straight into a tty is limited by macOS `head`, which line-buffers on a
    /// tty and issues one write per "y\n". The `| cat` variant shows what the terminal itself
    /// sustains.
    #[test]
    #[ignore]
    fn throughput() {
        for script in ["yes | head -c 50000000 | cat", "yes | head -c 50000000"] {
            let term = Terminal::spawn_with(sh(script), egui::Context::default()).unwrap();
            let start = Instant::now();
            while term.is_alive() && start.elapsed() < Duration::from_secs(120) {
                std::thread::sleep(Duration::from_millis(2));
            }
            let secs = start.elapsed().as_secs_f64();
            let mb = term.bytes_processed() as f64 / 1e6;
            eprintln!(
                "{script}: parsed {mb:.1} MB in {secs:.2} s = {:.0} MB/s",
                mb / secs
            );
            assert!(mb >= 50.0);
        }
    }
}
