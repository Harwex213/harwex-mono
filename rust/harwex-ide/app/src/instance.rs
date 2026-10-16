//! Single instance: `harwex-ide <dir>` hands the folder to the IDE that already runs.
//!
//! The first instance listens on a unix socket in `$TMPDIR` (the name holds the uid; on Windows
//! an AF_UNIX socket through `uds_windows`, named after the user, in the per-user temp dir). A new
//! launch connects, sends the canonical folder, waits for `ok` and exits. A socket file without
//! a listener is stale: the new launch removes it and becomes the instance. The listener thread
//! posts each request to the UI thread through `Jobs::post`, which also asks for a repaint.
//!
//! Background mode and tests never use the default socket: `main.rs` skips the socket in
//! background mode unless `HARWEX_IDE_SOCKET` names one, and `AppOptions::instance` is `None`
//! by default, so a headless app never listens.

use std::io::{self, Read, Write};
#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;
#[cfg(windows)]
use uds_windows::{UnixListener, UnixStream};

use crate::jobs::Jobs;

/// Overrides the socket: a bare name (`<tmp>/harwex-ide-<uid>-<name>.sock`) or a path with `/`.
pub const SOCKET_ENV: &str = "HARWEX_IDE_SOCKET";
/// The socket name of a normal (foreground) run.
pub const DEFAULT_NAME: &str = "default";
/// How long a new launch waits for the running instance to answer.
pub const ACK_TIMEOUT: Duration = Duration::from_secs(2);
/// A request is a few hundred bytes; more is not ours.
const MAX_REQUEST: u64 = 64 * 1024;

/// What a new launch asks the running instance to do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    /// Bring the window forward (a start without a folder).
    Activate,
    /// Open the folder, or activate it if it is open, and bring the window forward.
    Open(PathBuf),
}

impl Request {
    /// `activate\n`, or `open\n` followed by the raw path bytes up to the end of the stream.
    /// The client closes its write side, so a path may hold any byte, a newline included.
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Request::Activate => b"activate\n".to_vec(),
            Request::Open(path) => {
                let mut out = b"open\n".to_vec();
                out.extend_from_slice(&path_bytes(path));
                out
            }
        }
    }

    pub fn decode(bytes: &[u8]) -> Option<Request> {
        if bytes == b"activate\n" {
            return Some(Request::Activate);
        }
        let path = path_from_bytes(bytes.strip_prefix(b"open\n")?)?;
        path.is_absolute().then_some(Request::Open(path))
    }
}

#[cfg(unix)]
fn path_bytes(path: &Path) -> Vec<u8> {
    std::os::unix::ffi::OsStrExt::as_bytes(path.as_os_str()).to_vec()
}

#[cfg(unix)]
fn path_from_bytes(bytes: &[u8]) -> Option<PathBuf> {
    Some(PathBuf::from(<std::ffi::OsString as std::os::unix::ffi::OsStringExt>::from_vec(bytes.to_vec())))
}

/// UTF-16LE, so a path that is not valid Unicode (an unpaired surrogate) still round-trips.
#[cfg(windows)]
fn path_bytes(path: &Path) -> Vec<u8> {
    std::os::windows::ffi::OsStrExt::encode_wide(path.as_os_str()).flat_map(u16::to_le_bytes).collect()
}

#[cfg(windows)]
fn path_from_bytes(bytes: &[u8]) -> Option<PathBuf> {
    let (pairs, []) = bytes.as_chunks::<2>() else { return None };
    let wide: Vec<u16> = pairs.iter().map(|&p| u16::from_le_bytes(p)).collect();
    Some(PathBuf::from(<std::ffi::OsString as std::os::windows::ffi::OsStringExt>::from_wide(&wide)))
}

/// The socket for `name`: a path when it holds a separator, else a file in the temp dir.
pub fn socket_path(name: &str) -> PathBuf {
    if name.contains('/') || (cfg!(windows) && name.contains('\\')) {
        return PathBuf::from(name);
    }
    socket_in(&std::env::temp_dir(), &user_tag(), name)
}

#[cfg(unix)]
fn user_tag() -> String {
    // SAFETY: getuid has no preconditions and cannot fail.
    unsafe { libc::getuid() }.to_string()
}

/// The temp dir is already per user on Windows; the name only keeps two accounts that share a
/// custom `TEMP` apart. Anything outside `[A-Za-z0-9_-]` becomes `_`.
#[cfg(windows)]
fn user_tag() -> String {
    let name = std::env::var("USERNAME").unwrap_or_default();
    name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

/// A socket path holds at most 103 bytes on macOS (104 with the NUL; Windows AF_UNIX allows
/// 107). A long `$TMPDIR` (the clean-check sandbox, a custom one) gets a short name with a hash
/// of `name` instead, so both sides still compute the same path.
fn socket_in(dir: &Path, uid: &str, name: &str) -> PathBuf {
    const MAX: usize = 103;
    let full = dir.join(format!("harwex-ide-{uid}-{name}.sock"));
    if full.as_os_str().len() <= MAX {
        return full;
    }
    // FNV-1a: stable across Rust versions, unlike `DefaultHasher`.
    let hash = name.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3));
    dir.join(format!("hx-{uid}-{:08x}.sock", (hash ^ (hash >> 32)) as u32))
}

/// The socket this launch uses, or `None` to run without one.
///
/// `--new-instance` skips the socket. `HARWEX_IDE_SOCKET` picks one in any mode. Without it a
/// background run (agents, `--test-*` hooks) uses no socket at all, so it never reaches the
/// user's IDE and never takes the default socket from it.
pub fn socket_for(new_instance: bool, background: bool, env_name: Option<&str>) -> Option<PathBuf> {
    if new_instance {
        return None;
    }
    match env_name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => Some(socket_path(name)),
        None if background => None,
        None => Some(socket_path(DEFAULT_NAME)),
    }
}

/// The result of `send`.
#[derive(Debug)]
pub enum Sent {
    /// The running instance took the request.
    Acked,
    /// Nobody listens: no file, or a stale one.
    NoListener,
}

/// Sends `req` to the instance at `path` and waits up to `timeout` for its `ok`.
pub fn send(path: &Path, req: &Request, timeout: Duration) -> io::Result<Sent> {
    // Windows reports a missing socket file as a winsock error that maps to no `ErrorKind`.
    if cfg!(windows) && std::fs::symlink_metadata(path).is_err() {
        return Ok(Sent::NoListener);
    }
    let mut stream = match UnixStream::connect(path) {
        Ok(s) => s,
        Err(e) if matches!(e.kind(), io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused) => return Ok(Sent::NoListener),
        Err(e) => return Err(e),
    };
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(&req.encode())?;
    stream.shutdown(std::net::Shutdown::Write)?;
    let mut answer = String::new();
    stream.take(64).read_to_string(&mut answer)?;
    if answer.trim() == "ok" {
        Ok(Sent::Acked)
    } else {
        Err(io::Error::other(format!("the running instance answered {answer:?}")))
    }
}

/// What a launch does after it looked at the socket.
pub enum Claim {
    /// The running instance took the folder. The new process exits 0.
    HandedOff,
    /// This process is the instance: it listens on the socket.
    Primary(Server),
    /// The socket could not be used (a hung instance, a foreign file, a bind error). The IDE
    /// starts on its own without a socket; the message says why.
    Alone(String),
}

/// Hands `req` to a running instance, or takes the socket at `path`.
pub fn claim(path: &Path, req: &Request, timeout: Duration) -> Claim {
    match send(path, req, timeout) {
        Ok(Sent::Acked) => return Claim::HandedOff,
        Ok(Sent::NoListener) => {}
        Err(e) => return Claim::Alone(format!("{}: {e}", path.display())),
    }
    if let Err(e) = remove_stale(path) {
        return Claim::Alone(format!("{}: {e}", path.display()));
    }
    match Server::bind(path) {
        Ok(server) => Claim::Primary(server),
        // Another launch bound the socket between our check and our bind.
        Err(e) if e.kind() == io::ErrorKind::AddrInUse => match send(path, req, timeout) {
            Ok(Sent::Acked) => Claim::HandedOff,
            _ => Claim::Alone(format!("{}: {e}", path.display())),
        },
        Err(e) => Claim::Alone(format!("{}: {e}", path.display())),
    }
}

/// Removes a socket file that no process listens on. Any other file stays: it is not ours.
fn remove_stale(path: &Path) -> io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if is_socket(&meta) => std::fs::remove_file(path),
        Ok(_) => Err(io::Error::other("exists and is not a socket")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(unix)]
fn is_socket(meta: &std::fs::Metadata) -> bool {
    std::os::unix::fs::FileTypeExt::is_socket(&meta.file_type())
}

/// An AF_UNIX socket file is a reparse point with the `IO_REPARSE_TAG_AF_UNIX` tag. std does
/// not expose the tag, so any reparse point counts; a plain file still stays.
#[cfg(windows)]
fn is_socket(meta: &std::fs::Metadata) -> bool {
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    std::os::windows::fs::MetadataExt::file_attributes(meta) & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

/// What tells our socket file from a newer one at the same path: the inode, on Windows the
/// creation time.
fn file_id(meta: &std::fs::Metadata) -> u64 {
    #[cfg(unix)]
    return std::os::unix::fs::MetadataExt::ino(meta);
    #[cfg(windows)]
    return std::os::windows::fs::MetadataExt::creation_time(meta);
}

/// The bound socket of the running instance. `serve` starts the listener thread.
pub struct Server {
    listener: UnixListener,
    path: PathBuf,
    ino: u64,
}

impl Server {
    pub fn bind(path: &Path) -> io::Result<Server> {
        let listener = UnixListener::bind(path)?;
        let ino = file_id(&std::fs::symlink_metadata(path)?);
        Ok(Server { listener, path: path.to_path_buf(), ino })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// A guard that removes the socket file when dropped, unless another instance replaced it.
    /// `main.rs` holds it until the window closes.
    pub fn cleanup(&self) -> SocketFile {
        SocketFile { path: self.path.clone(), ino: self.ino }
    }

    /// Listens on a thread. Each request runs `handle` on the UI thread. `focus` brings the
    /// window forward; background and test runs pass `false`.
    pub fn serve(self, jobs: Jobs, focus: bool) {
        let listener = self.listener;
        let spawned = std::thread::Builder::new().name("instance-socket".into()).spawn(move || {
            for conn in listener.incoming() {
                let Ok(conn) = conn else { continue };
                answer(conn, &jobs, focus);
            }
        });
        if let Err(e) = spawned {
            eprintln!("[harwex-ide] single instance: no listener thread: {e}");
        }
    }
}

fn answer(mut conn: UnixStream, jobs: &Jobs, focus: bool) {
    // A client that never closes its side must not stall the listener for long.
    let _ = conn.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = conn.set_write_timeout(Some(Duration::from_secs(1)));
    let mut bytes = Vec::new();
    if (&mut conn).take(MAX_REQUEST).read_to_end(&mut bytes).is_err() {
        return;
    }
    let Some(req) = Request::decode(&bytes) else {
        let _ = conn.write_all(b"error\n");
        return;
    };
    jobs.post(move |state| handle(state, req, focus));
    let _ = conn.write_all(b"ok\n");
}

/// Applies a request on the UI thread.
pub fn handle(state: &mut crate::AppState, req: Request, focus: bool) {
    match &req {
        Request::Open(root) => {
            state.timings.log(format!("single instance: open {}", root.display()));
            state.open_workspace(root.clone());
        }
        Request::Activate => state.timings.log("single instance: activate"),
    }
    if focus {
        bring_forward(&state.ctx);
    }
}

/// Unminimizes the window and activates the app. winit's `Focus` does nothing while the window
/// is still minimized, so a second `Focus` follows once the restore animation is over.
fn bring_forward(ctx: &egui::Context) {
    ctx.send_viewport_cmd(egui::ViewportCommand::Minimized(false));
    ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
    let ctx = ctx.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
        ctx.request_repaint();
    });
}

/// The socket file this process bound. Dropping it removes the file if it is still the same
/// inode, so a quitting instance never deletes the socket of a newer one.
#[derive(Debug)]
pub struct SocketFile {
    path: PathBuf,
    ino: u64,
}

impl Drop for SocketFile {
    fn drop(&mut self) {
        if std::fs::symlink_metadata(&self.path).is_ok_and(|m| file_id(&m) == self.ino) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trip() {
        let path = if cfg!(windows) { "C:\\work\\a b\\new\nline" } else { "/work/a b/new\nline" };
        for req in [Request::Activate, Request::Open(PathBuf::from(path))] {
            assert_eq!(Request::decode(&req.encode()), Some(req));
        }
        assert_eq!(Request::decode(b"open\nrelative"), None);
        assert_eq!(Request::decode(b"hello"), None);
    }

    #[test]
    fn background_and_new_instance_skip_the_default_socket() {
        let default = socket_path(DEFAULT_NAME);
        assert_eq!(socket_for(false, false, None), Some(default.clone()));
        assert_eq!(socket_for(true, false, None), None);
        assert_eq!(socket_for(false, true, None), None);
        assert_eq!(socket_for(false, true, Some("  ")), None);
        let named = socket_for(false, true, Some("agent-1")).expect("named socket");
        assert_ne!(named, default);
        assert_eq!(named, socket_path("agent-1"));
        assert_eq!(socket_for(false, false, Some("/x/y.sock")), Some(PathBuf::from("/x/y.sock")));
    }

    #[test]
    fn long_temp_dir_gets_a_short_name() {
        let short = socket_in(Path::new("/t"), "501", "default");
        assert_eq!(short, PathBuf::from("/t/harwex-ide-501-default.sock"));
        let dir = PathBuf::from(format!("/{}", "d".repeat(78)));
        let a = socket_in(&dir, "501", "default");
        let b = socket_in(&dir, "501", "other");
        assert!(a.as_os_str().len() <= 103, "{}", a.display());
        assert_ne!(a, b);
        assert_eq!(a, socket_in(&dir, "501", "default"));
        assert!(a.file_name().unwrap().to_string_lossy().starts_with("hx-501-"));
    }

    #[test]
    fn socket_name_holds_the_uid() {
        let uid = user_tag();
        let name = socket_path(DEFAULT_NAME).file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(name, format!("harwex-ide-{uid}-default.sock"));
    }
}
