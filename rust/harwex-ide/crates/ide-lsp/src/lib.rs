//! A generic Language Server Protocol client.
//!
//! It knows LSP and nothing about any language: `Content-Length` framing, JSON-RPC routing,
//! answers to server-to-client requests, full-text document sync, request timeouts, restart
//! after a crash (with every open file re-opened), capability and progress inspection, and
//! position conversion between the editor (chars) and LSP (UTF-16). Language adapters
//! (`ide-ts`, the app's rust-analyzer support) fill in a [`ClientConfig`].
//!
//! All calls block. Callers use worker threads; [`LspClient`] is `Send + Sync`.

mod cancel;
mod client;
mod diagnostics;
mod edits;
mod features;
pub mod framing;
mod position;
mod uri;

use std::fmt;
use std::path::PathBuf;
use std::time::Duration;

pub use cancel::CancelScope;
pub use client::{
    default_capabilities, keep_stderr_tail, lock, read_text, ClientConfig, ConfigurationHandler, LspClient, NotificationHandler, Progress,
};
pub use diagnostics::{parse_diagnostics, Diagnostic, Severity};
pub use edits::{FileEdit, TextEdit, PROBE_PREFIX};
pub use features::{canonical, hover_markdown, split_hover_markdown, Hover};
pub use position::{LineBreaks, LineIndex};
pub use uri::{path_to_uri, uri_to_path};

/// JSON-RPC: the method does not exist on the server.
pub const METHOD_NOT_FOUND: i64 = -32601;
/// LSP: the request was cancelled by the client.
pub const REQUEST_CANCELLED: i64 = -32800;
/// LSP: the document changed while the server worked on the request; retrying makes sense.
pub const CONTENT_MODIFIED: i64 = -32801;
/// LSP 3.17: the server cancelled the request itself (often while it is still loading).
pub const SERVER_CANCELLED: i64 = -32802;

/// The text every cancelled request reports. The app recognises it and shows one
/// "Cancelled" toast instead of an error.
pub const CANCELLED: &str = "cancelled by the user";

/// 0-based line, 0-based column in chars.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Location {
    pub path: PathBuf,
    pub line: usize,
    pub column: usize,
}

/// One entry of a Find Usages list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    pub location: Location,
    /// End of the referenced name, same coordinates as `location`.
    pub end_line: usize,
    pub end_column: usize,
    /// The whole line that contains the reference, without the line break.
    pub line_text: String,
    pub is_definition: bool,
    pub is_write: bool,
}

#[derive(Debug)]
pub enum Error {
    Spawn(std::io::Error),
    Io(PathBuf, std::io::Error),
    Timeout { method: String, after: Duration },
    /// The caller's cancel flag was set (`CancelScope`); the server got `$/cancelRequest`.
    Cancelled { method: String },
    /// The process exited. Carries the tail of its stderr. The next call restarts it.
    ServerDied(String),
    /// The server answered with an error object.
    Server { code: i64, message: String },
}

impl Error {
    /// The server could not answer yet or the text moved under it; the same request may
    /// succeed a moment later.
    pub fn is_retryable(&self) -> bool {
        matches!(self, Error::Server { code, .. } if matches!(*code, CONTENT_MODIFIED | SERVER_CANCELLED | REQUEST_CANCELLED))
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Spawn(e) => write!(f, "failed to start the language server: {e}"),
            Error::Io(p, e) => write!(f, "{}: {e}", p.display()),
            Error::Timeout { method, after } => write!(f, "language server `{method}` timed out after {after:?}"),
            Error::Cancelled { method } => write!(f, "language server `{method}` {CANCELLED}"),
            Error::ServerDied(stderr) if stderr.trim().is_empty() => write!(f, "language server exited"),
            Error::ServerDied(stderr) => write!(f, "language server exited: {}", stderr.trim()),
            Error::Server { code: METHOD_NOT_FOUND, message } => write!(f, "method not supported: {message}"),
            Error::Server { message, .. } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Spawn(e) | Error::Io(_, e) => Some(e),
            _ => None,
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
