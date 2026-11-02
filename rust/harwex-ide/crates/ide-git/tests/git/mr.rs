//! Compare MR Diff: the tree of merge-base(HEAD, target) against HEAD's tree (three-dot, like a
//! GitLab merge request) and per-file diffs.

use ide_git::{ChangeKind, MrChanges, MrFileDiff, Oid};

use crate::common::*;

fn oid(s: &str) -> Oid {
    Oid::from_str(s.trim()).unwrap()
}

fn list(mr: &MrChanges) -> Vec<String> {
    mr.files
        .iter()
        .map(|f| match &f.old_path {
            Some(o) => format!("{:?} {} <- {}", f.kind, f.path.display(), o.display()),
            None => format!("{:?} {}", f.kind, f.path.display()),
        })
        .collect()
}

#[test]
fn mr_changes_show_only_the_current_branch_since_the_fork() {
    let t = TestRepo::new();
    t.write("a.txt", "1\n2\n3\n");
    t.write("old.txt", "keep\nthis\nfile\nlong enough\nfor rename\n");
    t.write("gone.txt", "bye\n");
    let fork = oid(&t.commit_all("base"));
    t.git(&["checkout", "-q", "-b", "feature"]);
    t.write("a.txt", "1\ntwo\n3\n");
    t.write("new.txt", "fresh\n");
    t.git(&["mv", "old.txt", "moved.txt"]);
    std::fs::remove_file(t.path().join("gone.txt")).unwrap();
    let tip = oid(&t.commit_all("feature work"));
    // The target moves on after the fork: its own changes are not part of the MR.
    t.git(&["checkout", "-q", "main"]);
    t.write("main_only.txt", "m\n");
    t.write("a.txt", "1\n2\n3\nmain\n");
    let main = oid(&t.commit_all("main work"));
    t.git(&["checkout", "-q", "feature"]);

    let mr = t.repo.mr_changes("main").unwrap();
    assert_eq!((mr.base, mr.tip), (fork, tip));
    assert_eq!(list(&mr), ["Modified a.txt", "Deleted gone.txt", "Renamed moved.txt <- old.txt", "Added new.txt"]);

    let a = mr.files.iter().find(|f| f.path == p("a.txt")).unwrap();
    let MrFileDiff::Diff(d) = t.repo.mr_file_diff(&mr.base, &mr.tip, a, 1 << 20).unwrap() else { panic!("too large") };
    // The old side is the merge-base's text, not main's.
    assert_eq!((d.old_text.as_str(), d.new_text.as_str()), ("1\n2\n3\n", "1\ntwo\n3\n"));
    assert_eq!(d.hunks.len(), 1);
    let moved = mr.files.iter().find(|f| f.kind == ChangeKind::Renamed).unwrap();
    let MrFileDiff::Diff(d) = t.repo.mr_file_diff(&mr.base, &mr.tip, moved, 1 << 20).unwrap() else { panic!("too large") };
    assert!(d.old_exists && d.new_exists && d.hunks.is_empty());
    let gone = mr.files.iter().find(|f| f.kind == ChangeKind::Deleted).unwrap();
    let MrFileDiff::Diff(d) = t.repo.mr_file_diff(&mr.base, &mr.tip, gone, 1 << 20).unwrap() else { panic!("too large") };
    assert!(d.old_exists && !d.new_exists);
    assert!(matches!(t.repo.mr_file_diff(&mr.base, &mr.tip, a, 4).unwrap(), MrFileDiff::TooLarge { old_size: 6, new_size: 8 }));

    // The current branch against itself has nothing to show.
    assert!(t.repo.mr_changes("feature").unwrap().files.is_empty());

    // Once main is merged in, the merge-base is main's tip: main's changes still do not show.
    t.git(&["merge", "-q", "--no-edit", "main"]);
    let mr = t.repo.mr_changes("main").unwrap();
    assert_eq!(mr.base, main);
    assert_eq!(list(&mr), ["Modified a.txt", "Deleted gone.txt", "Renamed moved.txt <- old.txt", "Added new.txt"]);
    let a = mr.files.iter().find(|f| f.path == p("a.txt")).unwrap();
    let MrFileDiff::Diff(d) = t.repo.mr_file_diff(&mr.base, &mr.tip, a, 1 << 20).unwrap() else { panic!("too large") };
    assert_eq!((d.old_text.as_str(), d.new_text.as_str()), ("1\n2\n3\nmain\n", "1\ntwo\n3\nmain\n"));
}

#[test]
fn mr_changes_of_unrelated_histories_is_an_error() {
    let t = TestRepo::new();
    t.write("a.txt", "a\n");
    t.commit_all("main root");
    t.git(&["checkout", "-q", "--orphan", "lone"]);
    t.write("a.txt", "lone\n");
    t.commit_all("lone root");
    let err = t.repo.mr_changes("main").unwrap_err().to_string();
    assert!(err.contains("unrelated histories"), "{err}");
}
