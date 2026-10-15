//! `file://` URIs, plus the files that stand for a server's non-file URIs
//! (`virtual_docs`).

use std::path::{Path, PathBuf};

/// `file://` URI of an absolute path. Everything outside the unreserved set and `/` is
/// percent-encoded, like VS Code does (`@` becomes `%40`). A file written for a virtual
/// document gets its server URI back.
pub fn path_to_uri(path: &Path) -> String {
    if let Some(doc) = crate::virtual_docs::virtual_document(path) {
        return doc.uri;
    }
    let s = path.to_string_lossy();
    // A path too long for `canonical` to strip keeps its verbatim prefix; servers know only
    // the plain form.
    let s = match (s.strip_prefix(r"\\?\UNC\"), s.strip_prefix(r"\\?\")) {
        (Some(unc), _) => format!(r"\\{unc}").into(),
        (None, Some(plain)) => plain.to_string().into(),
        (None, None) => s,
    };
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
    let s = percent_decode(rest)?;
    // Windows: `/C:/x` is `C:/x`.
    let s = match s.as_bytes() {
        [b'/', d, b':', ..] if d.is_ascii_alphabetic() => s[1..].to_string(),
        _ => s,
    };
    // Paths compare by their text in tab keys and maps, so a Windows path uses `\` like the
    // ones the file system hands out, and the drive letter is upper case like `canonicalize`'s
    // (VS Code-style servers send `c%3A`).
    #[cfg(windows)]
    let s = {
        let mut s = s.replace('/', "\\");
        if s.as_bytes().get(1) == Some(&b':') {
            s[..1].make_ascii_uppercase();
        }
        s
    };
    Some(PathBuf::from(s))
}

/// `%XX` escapes to bytes; `None` when the result is not UTF-8. A lone `%` stays as is.
pub(crate) fn percent_decode(rest: &str) -> Option<String> {
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
    String::from_utf8(out).ok()
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
