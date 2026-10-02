//! Wire formats.
//!
//! tsserver: requests go to stdin as one JSON object per line. Responses and events come back
//! on stdout as `Content-Length: N\r\n\r\n<N bytes of JSON>` frames, where N counts UTF-8 bytes.
//!
//! LSP (the native TypeScript 7 server): the same frames in both directions. Both directions
//! use `ide-lsp`'s framing, which also has the tests.

pub(crate) use ide_lsp::framing::read_message;
