//! Compare MR Diff: HEAD's tree against a branch's tree (two-dot) and per-file diffs.

use ide_git::{ChangeKind, MrFileDiff, Oid};

use crate::common::*;

fn oid(s: &str) -> Oid {
    Oid::from_str(s.trim()).unwrap()
}

#[test]
fn mr_changes_compare_head_with_the_branch_tip() {
    let t = TestRepo::new();
    t.write("a.txt", "1\n2\n3\n");
    t.write("old.txt", "keep\nthis\nfile\nlong enough\nfor rename\n");
    t.write("gone.txt", "bye\n");
    t.commit_all("base");
    t.git(&["checkout", "-q", "-b", "feature"]);
    t.write("a.txt", "1\ntwo\n3\n");
    t.write("new.txt", "fresh\n");
    t.git(&["mv", "old.txt", "moved.txt"]);
    std::fs::remove_file(t.path().join("gone.txt")).unwrap();
    let tip = oid(&t.commit_all("feature work"));
    t.git(&["checkout", "-q", "main"]);
    // HEAD moves on after the fork: a two-dot compare shows that too, from HEAD's side.
    t.write("main_only.txt", "m\n");
    t.write("a.txt", "1\n2\n3\nmain\n");
    let head = oid(&t.commit_all("main work"));

    let mr = t.repo.mr_changes("feature").unwrap();
    assert_eq!((mr.base, mr.tip), (head, tip));
    let list: Vec<String> = mr
        .files
        .iter()
        .map(|f| match &f.old_path {
            Some(o) => format!("{:?} {} <- {}", f.kind, f.path.display(), o.display()),
            None => format!("{:?} {}", f.kind, f.path.display()),
        })
        .collect();
    assert_eq!(list, ["Modified a.txt", "Deleted gone.txt", "Deleted main_only.txt", "Renamed moved.txt <- old.txt", "Added new.txt"]);

    let a = mr.files.iter().find(|f| f.path == p("a.txt")).unwrap();
    let MrFileDiff::Diff(d) = t.repo.mr_file_diff(&mr.base, &mr.tip, a, 1 << 20).unwrap() else { panic!("too large") };
    // The old side is HEAD's text, the new side the branch's.
    assert_eq!((d.old_text.as_str(), d.new_text.as_str()), ("1\n2\n3\nmain\n", "1\ntwo\n3\n"));
    assert_eq!(d.hunks.len(), 2);
    let moved = mr.files.iter().find(|f| f.kind == ChangeKind::Renamed).unwrap();
    let MrFileDiff::Diff(d) = t.repo.mr_file_diff(&mr.base, &mr.tip, moved, 1 << 20).unwrap() else { panic!("too large") };
    assert!(d.old_exists && d.new_exists && d.hunks.is_empty());
    let gone = mr.files.iter().find(|f| f.kind == ChangeKind::Deleted).unwrap();
    let MrFileDiff::Diff(d) = t.repo.mr_file_diff(&mr.base, &mr.tip, gone, 1 << 20).unwrap() else { panic!("too large") };
    assert!(d.old_exists && !d.new_exists);
    assert!(matches!(t.repo.mr_file_diff(&mr.base, &mr.tip, a, 4).unwrap(), MrFileDiff::TooLarge { old_size: 11, new_size: 8 }));

    // The current branch against itself has nothing to show.
    assert!(t.repo.mr_changes("main").unwrap().files.is_empty());
}
