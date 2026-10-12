//! Source, tests and docs never name a home directory or an agent temp dir.

use std::path::Path;

#[test]
fn no_absolute_user_paths_in_sources() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut bad = Vec::new();
    let mut stack = vec![root.clone()];
    let needles = [["/Us", "ers/"].concat(), ["/ho", "me/"].concat(), ["/private/tmp/cl", "aude"].concat()];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if p.is_dir() {
                if !matches!(name.as_str(), "target" | "assets" | "snapshots" | ".git") {
                    stack.push(p);
                }
            } else if matches!(p.extension().and_then(|x| x.to_str()), Some("rs" | "toml" | "md")) {
                let text = std::fs::read_to_string(&p).unwrap_or_default();
                if needles.iter().any(|n| text.contains(n.as_str())) {
                    bad.push(p.display().to_string());
                }
            }
        }
    }
    assert!(bad.is_empty(), "machine paths in {bad:?}");
}
