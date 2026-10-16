//! `Repo::local_patch`: every patch applies onto a clean checkout of HEAD and gives back the
//! working tree (or the index, for a staged-only part).

use std::path::Path;

use crate::common::{git_in, p, TestRepo};
use ide_git::{LocalChange, LocalPatch, LocalPatchFile};

fn file(path: &str, change: LocalChange) -> LocalPatchFile {
    LocalPatchFile { path: p(path), old_path: None, change }
}

/// Clones HEAD of `t` next to it, checks and applies `patch` there, and returns the clone.
fn apply_on_head(t: &TestRepo, patch: &LocalPatch) -> tempfile::TempDir {
    let clone = tempfile::tempdir().unwrap();
    // Git for Windows' system `core.autocrlf=true` would check the clone out with `\r\n`.
    git_in(clone.path(), &["clone", "-q", "-c", "core.autocrlf=false", t.path().to_str().unwrap(), "."]);
    // Outside the clone, so the patch file is no untracked file of it.
    let file = tempfile::NamedTempFile::new().unwrap().into_temp_path();
    std::fs::write(&file, &patch.bytes).unwrap();
    let path = file.to_str().unwrap();
    git_in(clone.path(), &["apply", "--check", path]);
    git_in(clone.path(), &["apply", path]);
    clone
}

fn bytes(dir: &Path, rel: &str) -> Vec<u8> {
    std::fs::read(dir.join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

fn text(patch: &LocalPatch) -> String {
    String::from_utf8_lossy(&patch.bytes).into_owned()
}

fn base() -> TestRepo {
    let t = TestRepo::new();
    t.write("a.txt", "a1\na2\na3\n");
    t.write("b.txt", "b1\nb2\n");
    t.write("c.txt", "c1\nc2\nc3\nc4\n");
    t.write("old.txt", "rename me\nwith enough\ncontent to match\nthe rename\n");
    t.write("gone.txt", "bye\n");
    t.write("run.sh", "echo hi\n");
    std::fs::write(t.path().join("img.bin"), [0u8, 1, 2, 3, 255, 0, 7]).unwrap();
    t.commit_all("init");
    t
}

#[test]
fn staged_only_is_index_vs_head() {
    let t = base();
    t.write("a.txt", "a1\nA2\na3\n");
    t.git(&["add", "a.txt"]);
    let patch = t.repo.local_patch(&[file("a.txt", LocalChange::Staged)]).unwrap();
    assert_eq!(patch.files, 1);
    assert!(text(&patch).starts_with("diff --git a/a.txt b/a.txt\n"), "{}", text(&patch));
    let clone = apply_on_head(&t, &patch);
    assert_eq!(bytes(clone.path(), "a.txt"), bytes(t.path(), "a.txt"));
}

#[test]
fn unstaged_only_is_worktree_vs_index() {
    let t = base();
    t.write("b.txt", "b1\nB2\nb3\n");
    let patch = t.repo.local_patch(&[file("b.txt", LocalChange::Unstaged)]).unwrap();
    assert_eq!(patch.files, 1);
    let clone = apply_on_head(&t, &patch);
    assert_eq!(bytes(clone.path(), "b.txt"), bytes(t.path(), "b.txt"));
}

#[test]
fn a_partly_staged_file_is_one_diff_against_head() {
    let t = base();
    t.write("c.txt", "c1\nC2\nc3\nc4\n");
    t.git(&["add", "c.txt"]);
    t.write("c.txt", "c1\nC2\nc3\nC4\n");
    let both = t.repo.local_patch(&[file("c.txt", LocalChange::Both)]).unwrap();
    assert_eq!(text(&both).matches("diff --git").count(), 1, "{}", text(&both));
    let clone = apply_on_head(&t, &both);
    assert_eq!(bytes(clone.path(), "c.txt"), bytes(t.path(), "c.txt"));

    // The Staged part alone gives the index version.
    let staged = t.repo.local_patch(&[file("c.txt", LocalChange::Staged)]).unwrap();
    let clone = apply_on_head(&t, &staged);
    assert_eq!(std::fs::read_to_string(clone.path().join("c.txt")).unwrap(), "c1\nC2\nc3\nc4\n");
}

#[test]
fn untracked_files_come_as_new_files() {
    let t = base();
    t.write("new/dir/fresh.txt", "fresh\n");
    t.write("new/tool.sh", "echo tool\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(t.path().join("new/tool.sh"), std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    t.write("-dash.txt", "dash\n");
    let patch = t
        .repo
        .local_patch(&[file("new/dir/fresh.txt", LocalChange::Untracked), file("new/tool.sh", LocalChange::Untracked), file("-dash.txt", LocalChange::Untracked)])
        .unwrap();
    let s = text(&patch);
    assert_eq!(patch.files, 3, "{s}");
    assert!(s.contains("--- /dev/null\n+++ b/new/dir/fresh.txt"), "{s}");
    #[cfg(unix)]
    assert!(s.contains("diff --git a/new/tool.sh b/new/tool.sh\nnew file mode 100755"), "{s}");
    let clone = apply_on_head(&t, &patch);
    for f in ["new/dir/fresh.txt", "new/tool.sh", "-dash.txt"] {
        assert_eq!(bytes(clone.path(), f), bytes(t.path(), f), "{f}");
    }
}

#[test]
fn binary_files_are_git_binary_patches() {
    let t = base();
    std::fs::write(t.path().join("img.bin"), [9u8, 0, 8, 0, 7, 255]).unwrap();
    std::fs::write(t.path().join("new.bin"), [0u8, 0, 1, 2, 250]).unwrap();
    let patch = t.repo.local_patch(&[file("img.bin", LocalChange::Unstaged), file("new.bin", LocalChange::Untracked)]).unwrap();
    let s = text(&patch);
    assert_eq!(s.matches("GIT binary patch").count(), 2, "{s}");
    let clone = apply_on_head(&t, &patch);
    assert_eq!(bytes(clone.path(), "img.bin"), bytes(t.path(), "img.bin"));
    assert_eq!(bytes(clone.path(), "new.bin"), bytes(t.path(), "new.bin"));
}

#[test]
fn renames_deletes_and_mode_changes_are_kept() {
    let t = base();
    t.git(&["mv", "old.txt", "moved.txt"]);
    t.write("moved.txt", "rename me\nwith enough\ncontent to match\nthe rename\nplus one\n");
    t.git(&["rm", "-q", "gone.txt"]);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(t.path().join("run.sh"), std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let files = [
        LocalPatchFile { path: p("moved.txt"), old_path: Some(p("old.txt")), change: LocalChange::Both },
        file("gone.txt", LocalChange::Staged),
        file("run.sh", LocalChange::Unstaged),
    ];
    let patch = t.repo.local_patch(&files).unwrap();
    let s = text(&patch);
    assert!(s.contains("rename from old.txt\nrename to moved.txt"), "{s}");
    assert!(s.contains("deleted file mode 100644"), "{s}");
    #[cfg(unix)]
    assert!(s.contains("old mode 100644\nnew mode 100755"), "{s}");
    // Windows has no exec bit to change, so `run.sh` has no change there.
    assert_eq!(patch.files, if cfg!(unix) { 3 } else { 2 }, "{s}");
    let clone = apply_on_head(&t, &patch);
    assert!(!clone.path().join("old.txt").exists());
    assert!(!clone.path().join("gone.txt").exists());
    assert_eq!(bytes(clone.path(), "moved.txt"), bytes(t.path(), "moved.txt"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(clone.path().join("run.sh")).unwrap().permissions().mode();
        assert_eq!(mode & 0o111, 0o111, "the mode change applied");
    }
}

#[test]
fn a_mixed_selection_is_sorted_and_names_each_file_once() {
    let t = base();
    t.write("a.txt", "a1\nA2\na3\n");
    t.git(&["add", "a.txt"]);
    t.write("b.txt", "b1\nB2\n");
    t.write("zz.txt", "z\n");
    let files = [file("zz.txt", LocalChange::Untracked), file("b.txt", LocalChange::Unstaged), file("a.txt", LocalChange::Staged)];
    let patch = t.repo.local_patch(&files).unwrap();
    let heads: Vec<&str> = std::str::from_utf8(&patch.bytes).unwrap().lines().filter(|l| l.starts_with("diff --git")).collect();
    assert_eq!(heads, ["diff --git a/a.txt b/a.txt", "diff --git a/b.txt b/b.txt", "diff --git a/zz.txt b/zz.txt"]);
    let clone = apply_on_head(&t, &patch);
    for f in ["a.txt", "b.txt", "zz.txt"] {
        assert_eq!(bytes(clone.path(), f), bytes(t.path(), f), "{f}");
    }
    assert_eq!(t.repo.local_patch(&[]).unwrap(), LocalPatch::default());
}

#[test]
fn an_unborn_branch_patches_against_the_empty_tree() {
    let t = TestRepo::new();
    t.write("first.txt", "one\n");
    t.git(&["add", "first.txt"]);
    t.write("first.txt", "one\ntwo\n");
    let patch = t.repo.local_patch(&[file("first.txt", LocalChange::Both)]).unwrap();
    let s = text(&patch);
    assert!(s.contains("new file mode 100644") && s.contains("+two"), "{s}");
}
