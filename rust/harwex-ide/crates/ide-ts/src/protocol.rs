//! tsserver's wire format.
//!
//! Requests go to stdin as one JSON object per line. Responses and events come back on
//! stdout as `Content-Length: N\r\n\r\n<N bytes of JSON>` frames, where N counts UTF-8 bytes.

use std::io::{self, BufRead};

use serde_json::Value;

/// Reads the next frame. `Ok(None)` means stdout closed, which is how a dead tsserver looks.
pub(crate) fn read_message(reader: &mut impl BufRead) -> io::Result<Option<Value>> {
    loop {
        let mut length: Option<usize> = None;
        let mut line = String::new();
        // Header block: lines until an empty one. Stray blank lines before a header are skipped,
        // because tsserver ends each body with a newline that some versions leave outside N.
        loop {
            line.clear();
            if reader.read_line(&mut line)? == 0 {
                return Ok(None);
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                if length.is_some() {
                    break;
                }
                continue;
            }
            if let Some((name, value)) = trimmed.split_once(':') {
                if name.trim().eq_ignore_ascii_case("content-length") {
                    length = value.trim().parse().ok();
                }
            }
        }
        let length = length.unwrap_or(0);
        let mut body = vec![0; length];
        reader.read_exact(&mut body)?;
        // A frame that is not JSON is skipped instead of killing the reader; the waiting
        // request then times out, which is recoverable, while a dead reader is not.
        if let Ok(value) = serde_json::from_slice(&body) {
            return Ok(Some(value));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::read_message;
    use std::io::Cursor;

    #[test]
    fn reads_consecutive_frames_with_utf8_lengths() {
        let a = r#"{"seq":0,"type":"event","event":"typingsInstallerPid"}"#;
        let b = "{\"type\":\"response\",\"request_seq\":3,\"body\":\"é😀\"}\n";
        let data = format!(
            "Content-Length: {}\r\n\r\n{}\nContent-Length: {}\r\n\r\n{}",
            a.len(),
            a,
            b.len(),
            b
        );
        let mut cursor = Cursor::new(data.into_bytes());
        let first = read_message(&mut cursor).unwrap().unwrap();
        assert_eq!(first["event"], "typingsInstallerPid");
        let second = read_message(&mut cursor).unwrap().unwrap();
        assert_eq!(second["request_seq"], 3);
        assert_eq!(second["body"], "é😀");
        assert!(read_message(&mut cursor).unwrap().is_none());
    }
}
