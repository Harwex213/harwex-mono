//! `file://` URIs.

use std::path::{Path, PathBuf};

/// `file://` URI of an absolute path. Everything outside the unreserved set and `/` is
/// percent-encoded, like VS Code does (`@` becomes `%40`).
pub fn path_to_uri(path: &Path) -> String {
    let s = path.to_string_lossy();
    let mut out = String::from("file://");
    if !s.starts_with('/') {
        out.push('/');
    }
    for b in s.replace('\\', "/").bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The path of a `file://` URI; `None` for other schemes.
pub fn uri_to_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    // `file://host/path` is not used by servers; skip a host part if one shows up.
    let rest = if rest.starts_with('/') { rest } else { &rest[rest.find('/')?..] };
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    let s = String::from_utf8(out).ok()?;
    // Windows: `/C:/x` is `C:/x`.
    let s = match s.as_bytes() {
        [b'/', d, b':', ..] if d.is_ascii_alphabetic() => s[1..].to_string(),
        _ => s,
    };
    Some(PathBuf::from(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_round_trip_encodes_reserved_chars() {
        let path = Path::new("/work/mono/packages/@projects/my dir/é#1.ts");
        let uri = path_to_uri(path);
        assert_eq!(uri, "file:///work/mono/packages/%40projects/my%20dir/%C3%A9%231.ts");
        assert_eq!(uri_to_path(&uri).unwrap(), path);
        // The server may leave `@` unencoded.
        assert_eq!(uri_to_path("file:///a/@b/c.ts").unwrap(), Path::new("/a/@b/c.ts"));
        assert_eq!(uri_to_path("untitled:1"), None);
        assert_eq!(uri_to_path("file:///a/100%").unwrap(), Path::new("/a/100%"));
    }
}
