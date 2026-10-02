//! `Content-Length: N\r\n\r\n<N bytes of JSON>` frames, where N counts UTF-8 bytes.
//!
//! LSP uses these frames in both directions. tsserver uses them for its responses too, so
//! `ide-ts` reads its tsserver output with the same function.

use std::io::{self, BufRead};

use serde_json::Value;

/// Reads the next frame. `Ok(None)` means the stream closed, which is how a dead server looks.
pub fn read_message(reader: &mut impl BufRead) -> io::Result<Option<Value>> {
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

/// One `Content-Length` frame with `msg` as its body.
pub fn frame(msg: &Value) -> Vec<u8> {
    let body = msg.to_string();
    let mut out = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::{frame, read_message};
    use std::io::Cursor;

    #[test]
    fn reads_consecutive_frames_with_utf8_lengths() {
        let a = r#"{"seq":0,"type":"event","event":"typingsInstallerPid"}"#;
        let b = "{\"type\":\"response\",\"request_seq\":3,\"body\":\"é😀\"}\n";
        let data = format!("Content-Length: {}\r\n\r\n{}\nContent-Length: {}\r\n\r\n{}", a.len(), a, b.len(), b);
        let mut cursor = Cursor::new(data.into_bytes());
        let first = read_message(&mut cursor).unwrap().unwrap();
        assert_eq!(first["event"], "typingsInstallerPid");
        let second = read_message(&mut cursor).unwrap().unwrap();
        assert_eq!(second["request_seq"], 3);
        assert_eq!(second["body"], "é😀");
        assert!(read_message(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn frame_round_trips() {
        let msg = serde_json::json!({"jsonrpc": "2.0", "id": 1, "params": {"text": "é😀"}});
        let mut cursor = Cursor::new(frame(&msg));
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), msg);
    }

    #[test]
    fn extra_headers_and_bad_json_are_skipped() {
        let good = r#"{"id":2}"#;
        let data = format!(
            "Content-Length: 3\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\nnopcontent-length: {}\r\n\r\n{}",
            good.len(),
            good
        );
        let mut cursor = Cursor::new(data.into_bytes());
        assert_eq!(read_message(&mut cursor).unwrap().unwrap()["id"], 2);
    }

    #[test]
    fn truncated_body_is_an_error() {
        let mut cursor = Cursor::new(b"Content-Length: 10\r\n\r\n{}".to_vec());
        assert!(read_message(&mut cursor).is_err());
    }
}
