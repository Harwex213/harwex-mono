mod common;

use common::{p, TestRepo};
use ide_git::{ChangeKind, DiffSide, LineChangeKind, LineKind};

fn kind_of(t: &TestRepo, path: &str) -> Option<ChangeKind> {
    t.repo.status().unwrap().into_iter().find(|c| c.path == p(path)).map(|c| c.kind())
}

#[test]
fn status_reports_all_kinds() {
    let t = TestRepo::new();
    t.write("mod.txt", "a\n");
    t.write("del.txt", "d\n");
    t.write("old.txt", "rename me\nwith enough\ncontent to match\n");
    t.commit_all("init");

    t.write("mod.txt", "b\n");
    std::fs::remove_file(t.path().join("del.txt")).unwrap();
    t.write("new/untracked.txt", "u\n");
    t.write("added.txt", "x\n");
    t.git(&["add", "added.txt"]);
    t.git(&["mv", "old.txt", "renamed.txt"]);

    let st = t.repo.status().unwrap();
    let find = |s: &str| st.iter().find(|c| c.path == p(s)).unwrap_or_else(|| panic!("{s} missing: {st:?}"));
    assert_eq!(find("mod.txt").kind(), ChangeKind::Modified);
    assert_eq!(find("mod.txt").unstaged, Some(ChangeKind::Modified));
    assert_eq!(find("mod.txt").staged, None);
    assert_eq!(find("del.txt").kind(), ChangeKind::Deleted);
    assert_eq!(find("new/untracked.txt").kind(), ChangeKind::Untracked);
    assert_eq!(find("added.txt").kind(), ChangeKind::Added);
    let r = find("renamed.txt");
    assert_eq!(r.kind(), ChangeKind::Renamed);
    assert_eq!(r.old_path, Some(p("old.txt")));
    assert!(!st.iter().any(|c| c.path == p("old.txt")), "rename source listed separately");

    let only = t.repo.status_of(&[p("mod.txt")]).unwrap();
    assert_eq!(only.len(), 1);
}

#[test]
fn stage_and_unstage() {
    let t = TestRepo::new();
    t.write("a.txt", "1\n");
    t.write("gone.txt", "g\n");
    t.commit_all("init");
    t.write("a.txt", "2\n");
    t.write("b.txt", "new\n");
    std::fs::remove_file(t.path().join("gone.txt")).unwrap();

    t.repo
        .stage(&[p("a.txt"), t.path().join("b.txt"), p("gone.txt")])
        .unwrap();
    let st = t.repo.status().unwrap();
    for c in &st {
        assert!(c.staged.is_some() && c.unstaged.is_none(), "{c:?}");
    }
    assert_eq!(kind_of(&t, "gone.txt"), Some(ChangeKind::Deleted));

    t.repo.unstage(&[p("a.txt"), p("b.txt"), p("gone.txt")]).unwrap();
    let st = t.repo.status().unwrap();
    for c in &st {
        assert!(c.staged.is_none(), "{c:?}");
    }
    assert_eq!(kind_of(&t, "b.txt"), Some(ChangeKind::Untracked));
}

#[test]
fn unstage_in_unborn_repo() {
    let t = TestRepo::new();
    t.write("a.txt", "1\n");
    t.repo.stage(&[p("a.txt")]).unwrap();
    assert_eq!(kind_of(&t, "a.txt"), Some(ChangeKind::Added));
    t.repo.unstage(&[p("a.txt")]).unwrap();
    assert_eq!(kind_of(&t, "a.txt"), Some(ChangeKind::Untracked));
}

#[test]
fn commit_exactly_the_selected_paths() {
    let t = TestRepo::new();
    t.write("a.txt", "a1\n");
    t.write("b.txt", "b1\n");
    t.write("c.txt", "c1\n");
    t.commit_all("init");

    t.write("a.txt", "a2\n");
    t.write("b.txt", "b2\n");
    t.write("c.txt", "c2\n");
    t.git(&["add", "c.txt"]);
    t.write("new.txt", "n\n");

    let out = t.repo.commit("only a and new", &[p("a.txt"), p("new.txt")], false).unwrap();
    assert!(out.success(), "{:?}", out.output);
    assert_eq!(out.oid.unwrap().to_string(), t.git(&["rev-parse", "HEAD"]).trim());
    assert_eq!(t.head_text("a.txt"), "a2\n");
    assert_eq!(t.head_text("new.txt"), "n\n");
    assert_eq!(t.head_text("b.txt"), "b1\n");
    assert_eq!(t.head_text("c.txt"), "c1\n");
    // Other changes are untouched: b still unstaged, c still staged.
    assert_eq!(kind_of(&t, "b.txt"), Some(ChangeKind::Modified));
    let c = t.repo.status().unwrap().into_iter().find(|c| c.path == p("c.txt")).unwrap();
    assert_eq!(c.staged, Some(ChangeKind::Modified));
    assert_eq!(t.repo.last_commit_message().unwrap(), "only a and new");
}

#[test]
fn commit_rename_includes_deletion() {
    let t = TestRepo::new();
    t.write("old.txt", "some content\nthat is long enough\nto be similar\n");
    t.commit_all("init");
    t.git(&["mv", "old.txt", "new.txt"]);
    let out = t.repo.commit("rename", &[p("new.txt")], false).unwrap();
    assert!(out.success(), "{:?}", out.output);
    assert!(t.repo.status().unwrap().is_empty());
}

#[test]
fn amend_message_and_content() {
    let t = TestRepo::new();
    t.write("a.txt", "1\n");
    t.commit_all("first");
    t.write("a.txt", "2\n");
    t.commit_all("second");
    let count = || t.git(&["rev-list", "--count", "HEAD"]).trim().to_string();
    assert_eq!(count(), "2");

    let out = t.repo.commit("second, reworded", &[], true).unwrap();
    assert!(out.success(), "{:?}", out.output);
    assert_eq!(count(), "2");
    assert_eq!(t.repo.last_commit_message().unwrap(), "second, reworded");

    t.write("a.txt", "3\n");
    let out = t.repo.commit("second, amended", &[p("a.txt")], true).unwrap();
    assert!(out.success());
    assert_eq!(count(), "2");
    assert_eq!(t.head_text("a.txt"), "3\n");
    assert!(t.repo.status().unwrap().is_empty());
}

#[test]
fn failing_hook_rejects_commit() {
    let t = TestRepo::new();
    t.write("a.txt", "1\n");
    t.commit_all("init");
    let hook = t.path().join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    t.write("a.txt", "2\n");
    let out = t.repo.commit("blocked", &[p("a.txt")], false).unwrap();
    assert!(!out.success());
    assert!(out.oid.is_none());
    assert!(out.output.stderr.contains("lint failed"), "{:?}", out.output);
    assert_eq!(t.head_text("a.txt"), "1\n");
}

#[test]
fn rollback_restores_head_and_deletes_added() {
    let t = TestRepo::new();
    t.write("mod.txt", "orig\n");
    t.write("del.txt", "keep me\n");
    t.write("old.txt", "rename me please\nsome more lines\nand more\n");
    t.commit_all("init");

    t.write("mod.txt", "changed\n");
    t.git(&["add", "mod.txt"]);
    t.write("mod.txt", "changed again\n");
    std::fs::remove_file(t.path().join("del.txt")).unwrap();
    t.write("added.txt", "new\n");
    t.git(&["add", "added.txt"]);
    t.write("untracked.txt", "u\n");
    t.git(&["mv", "old.txt", "moved.txt"]);

    t.repo
        .rollback(&[p("mod.txt"), p("del.txt"), p("added.txt"), p("untracked.txt"), p("moved.txt")])
        .unwrap();
    assert_eq!(t.read("mod.txt"), "orig\n");
    assert_eq!(t.read("del.txt"), "keep me\n");
    assert!(!t.exists("added.txt"));
    assert!(!t.exists("untracked.txt"));
    assert!(!t.exists("moved.txt"));
    assert!(t.exists("old.txt"));
    assert!(t.repo.status().unwrap().is_empty(), "{:?}", t.repo.status().unwrap());
}

#[test]
fn diff_sides_and_commit_diff() {
    let t = TestRepo::new();
    t.write("f.txt", "one\ntwo\nthree\n");
    t.commit_all("init");
    t.write("f.txt", "one\nTWO\nthree\n");
    t.git(&["add", "f.txt"]);
    t.write("f.txt", "one\nTWO\nthree\nfour\n");

    let staged = t.repo.diff_file(&p("f.txt"), DiffSide::HeadVsIndex).unwrap();
    assert_eq!(staged.old_text, "one\ntwo\nthree\n");
    assert_eq!(staged.new_text, "one\nTWO\nthree\n");
    assert_eq!(staged.hunks.len(), 1);
    assert_eq!(staged.hunks[0].pairs[0].kind, LineKind::Changed);
    assert_eq!(staged.hunks[0].pairs[0].new_inline, vec![0..3]);

    let unstaged = t.repo.diff_file(&p("f.txt"), DiffSide::IndexVsWorktree).unwrap();
    assert_eq!(unstaged.hunks.len(), 1);
    assert_eq!(unstaged.hunks[0].new_lines, 3..4);
    assert_eq!(unstaged.hunks[0].old_lines, 3..3);

    let all = t.repo.diff_file(&t.path().join("f.txt"), DiffSide::HeadVsWorktree).unwrap();
    assert_eq!(all.hunks.len(), 2);

    let oid = t.commit_all("second").parse().unwrap();
    let cd = t.repo.diff_commit_file(&oid, &p("f.txt")).unwrap();
    assert_eq!(cd.old_text, "one\ntwo\nthree\n");
    assert_eq!(cd.new_text, "one\nTWO\nthree\nfour\n");

    t.write("bin.dat", "a\0b");
    let bin = t.repo.diff_file(&p("bin.dat"), DiffSide::HeadVsWorktree).unwrap();
    assert!(bin.binary && !bin.old_exists && bin.new_exists);
}

#[test]
fn diff_of_staged_rename_shows_old_file() {
    let t = TestRepo::new();
    t.write("old.txt", "line one\nline two\nline three\n");
    t.commit_all("init");
    t.git(&["mv", "old.txt", "new.txt"]);
    let d = t.repo.diff_file(&p("new.txt"), DiffSide::HeadVsWorktree).unwrap();
    assert_eq!(d.old_path, Some(p("old.txt")));
    assert!(d.hunks.is_empty());
    let oid = t.commit_all("rename").parse().unwrap();
    let d = t.repo.diff_commit_file(&oid, &p("new.txt")).unwrap();
    assert_eq!(d.old_path, Some(p("old.txt")));
    assert!(d.hunks.is_empty());
}

#[test]
fn gutter_changes_and_rollback_lines() {
    let t = TestRepo::new();
    t.write("f.ts", "a\nb\nc\nd\ne\n");
    t.commit_all("init");
    let buffer = "a\nB\nc\ne\nf\n";
    let changes = t.repo.line_changes(&p("f.ts"), buffer).unwrap();
    let kinds: Vec<_> = changes.iter().map(|c| (c.kind, c.lines.clone())).collect();
    assert_eq!(
        kinds,
        vec![
            (LineChangeKind::Modified, 1..2),
            (LineChangeKind::Deleted, 3..3),
            (LineChangeKind::Added, 4..5),
        ]
    );
    assert_eq!(changes[1].old_text, "d\n");

    assert_eq!(t.repo.rollback_lines(&p("f.ts"), buffer, 1..2).unwrap(), "a\nb\nc\ne\nf\n");
    assert_eq!(t.repo.rollback_lines(&p("f.ts"), buffer, 3..3).unwrap(), "a\nB\nc\nd\ne\nf\n");
    assert_eq!(t.repo.rollback_lines(&p("f.ts"), buffer, 0..5).unwrap(), "a\nb\nc\nd\ne\n");

    // Unversioned files have no bars; staged new files are fully added.
    t.write("u.ts", "x\n");
    assert!(t.repo.line_changes(&p("u.ts"), "x\n").unwrap().is_empty());
    t.git(&["add", "u.ts"]);
    let added = t.repo.line_changes(&p("u.ts"), "x\ny\n").unwrap();
    assert_eq!(added.len(), 1);
    assert_eq!(added[0].kind, LineChangeKind::Added);
    assert_eq!(added[0].lines, 0..2);
}
