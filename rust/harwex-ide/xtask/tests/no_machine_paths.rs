//! Fails when a source, test, example, manifest or doc of the workspace holds an absolute
//! path of one machine: a home directory or an agent's temp dir. Such a path makes a test
//! pass here and fail everywhere else. Name an env variable or `cargo xtask test-tools`
//! instead.

use std::fs;
use std::path::{Path, PathBuf};

/// Built from pieces, so this file does not match itself.
fn needles() -> [String; 3] {
    [["/Us", "ers/"].concat(), ["/ho", "me/"].concat(), ["/private/tmp/", "claude"].concat()]
}

fn checked(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    matches!(path.extension().and_then(|e| e.to_str()), Some("rs" | "toml" | "md" | "sb" | "sh" | "json")) || name == "CLAUDE.md"
}

fn walk(dir: &Path, root: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        let rel = path.strip_prefix(root).unwrap();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Build output, VCS data, and task files (transient; 004 quotes the patterns).
        if rel == Path::new("target") || rel == Path::new("docs/tasks") || (name.starts_with('.') && name != ".cargo") {
            continue;
        }
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            walk(&path, root, out);
        } else if kind.is_file() && checked(&path) {
            out.push(path);
        }
    }
}

#[test]
fn no_absolute_machine_paths_in_the_workspace() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let mut files = Vec::new();
    walk(root, root, &mut files);
    assert!(files.iter().any(|f| f.ends_with("Cargo.toml")), "walk found no manifests in {}", root.display());
    let needles = needles();
    let mut hits = Vec::new();
    for file in &files {
        let Ok(text) = fs::read_to_string(file) else { continue };
        for (n, line) in text.lines().enumerate() {
            if needles.iter().any(|needle| line.contains(needle.as_str())) {
                hits.push(format!("{}:{}: {}", file.strip_prefix(root).unwrap().display(), n + 1, line.trim()));
            }
        }
    }
    assert!(hits.is_empty(), "machine-specific paths found:\n{}", hits.join("\n"));
}
