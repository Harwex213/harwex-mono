//! Backend of the IDEA-like Git window: log filters, tags, combined changes, patches,
//! branch compare, the command log and broken graph edges.

use crate::common::{p, TestRepo};
use ide_git::{LogFilter, Oid};

fn oid(s: &str) -> Oid {
    Oid::from_str(s.trim()).unwrap()
}

fn subjects(t: &TestRepo, f: &LogFilter) -> Vec<String> {
    t.repo.log(f, 0, 100).unwrap().into_iter().map(|c| c.summary).collect()
}

#[test]
fn log_filter_text_regex_case_authors_paths_no_merges() {
    let t = TestRepo::new();
    t.write("src/a.rs", "a\n");
    t.commit_all("Fix parser bug");
    t.write("docs/b.md", "b\n");
    t.git(&["commit", "-q", "--author", "Alice <alice@corp.io>", "-a", "--allow-empty", "-m", "fix docs"]);
    t.git(&["add", "-A"]);
    t.git(&["commit", "-q", "--author", "Alice <alice@corp.io>", "-m", "Add docs page"]);
    t.git(&["checkout", "-q", "-b", "side"]);
    t.write("other.txt", "o\n");
    t.git(&["add", "-A"]);
    t.git(&["commit", "-q", "--author", "Bob <bob@home.net>", "-m", "side work 42"]);
    t.git(&["checkout", "-q", "main"]);
    t.write("src/c.rs", "c\n");
    t.commit_all("refactor");
    t.git(&["merge", "-q", "--no-ff", "-m", "Merge side", "side"]);

    // Default: case-insensitive substring.
    let f = LogFilter { text: Some("FIX".into()), ..Default::default() };
    assert_eq!(subjects(&t, &f), ["fix docs", "Fix parser bug"]);
    let f = LogFilter { text: Some("Fix".into()), text_case_sensitive: true, ..Default::default() };
    assert_eq!(subjects(&t, &f), ["Fix parser bug"]);
    // Regex, case-insensitive and sensitive.
    let f = LogFilter { text: Some(r"^(fix|add)\b".into()), text_regex: true, ..Default::default() };
    assert_eq!(subjects(&t, &f), ["Add docs page", "fix docs", "Fix parser bug"]);
    let f = LogFilter { text: Some(r"\d+$".into()), text_regex: true, text_case_sensitive: true, ..Default::default() };
    assert_eq!(subjects(&t, &f), ["side work 42"]);
    let f = LogFilter { text: Some("(".into()), text_regex: true, ..Default::default() };
    assert!(t.repo.log(&f, 0, 10).is_err(), "an invalid regex is an error");
    // A hash prefix matches in every mode.
    let head = t.git(&["rev-parse", "HEAD~1"]).trim().to_string();
    let f = LogFilter { text: Some(head[..10].to_uppercase()), text_regex: true, text_case_sensitive: true, ..Default::default() };
    assert_eq!(subjects(&t, &f), ["refactor"]);

    // Several authors: any matches, by name or email.
    let f = LogFilter { authors: vec!["alice".into(), "home.net".into()], ..Default::default() };
    assert_eq!(subjects(&t, &f), ["side work 42", "Add docs page", "fix docs"]);

    // Several paths: any matches; a directory matches its files.
    let f = LogFilter { paths: vec![p("src"), p("other.txt")], ..Default::default() };
    assert_eq!(subjects(&t, &f), ["refactor", "side work 42", "Fix parser bug"]);

    let f = LogFilter { no_merges: true, ..Default::default() };
    assert!(!subjects(&t, &f).contains(&"Merge side".to_string()));
    assert_eq!(subjects(&t, &f).len(), 5);

    // Several branches; "HEAD" is the checked-out revision.
    t.git(&["branch", "-q", "old", "HEAD~1"]);
    t.git(&["checkout", "-q", "--detach", "HEAD~1"]);
    let f = LogFilter { branches: vec!["HEAD".into()], ..Default::default() };
    assert_eq!(subjects(&t, &f)[0], "refactor");
    let f = LogFilter { branches: vec!["HEAD".into(), "side".into()], no_merges: true, ..Default::default() };
    assert_eq!(subjects(&t, &f).len(), 5);
    let f = LogFilter { branches: vec!["side".into()], ..Default::default() };
    assert_eq!(subjects(&t, &f)[0], "side work 42");
}

#[test]
fn tags_create_list_delete_and_user() {
    let t = TestRepo::new();
    t.write("a.txt", "a\n");
    let a = oid(&t.commit_all("A"));
    t.write("a.txt", "b\n");
    let b = oid(&t.commit_all("B"));
    t.repo.create_tag("v1.0", &a, None).unwrap();
    t.repo.create_tag("v2.0", &b, Some("release two")).unwrap();
    let tags = t.repo.tags().unwrap();
    assert_eq!(tags.len(), 2);
    assert_eq!((tags[0].name.as_str(), tags[0].oid, tags[0].annotated), ("v1.0", a, false));
    assert_eq!((tags[1].name.as_str(), tags[1].oid, tags[1].annotated), ("v2.0", b, true));

    t.repo.checkout_revision(&tags[0].oid).unwrap();
    assert_eq!(t.read("a.txt"), "a\n");
    t.repo.delete_tag("v2.0").unwrap();
    assert_eq!(t.repo.tags().unwrap().len(), 1);
    assert!(t.repo.delete_tag("missing").is_err());

    assert_eq!(t.repo.user().unwrap(), Some(("Test User".into(), "test@example.com".into())));
}

#[test]
fn command_events_report_start_and_finish_in_order() {
    let t = TestRepo::new();
    t.write("a.txt", "a\n");
    let a = oid(&t.commit_all("A"));
    let (tx, rx) = std::sync::mpsc::channel();
    let repo = t.repo.clone().with_command_sink(tx);
    // Clones share the sink, so a worker's copy reports too.
    let worker = repo.clone();
    worker.create_tag("v1", &a, None).unwrap();
    assert!(repo.delete_tag("nope").is_err());
    // libgit2 reads are not commands.
    repo.tags().unwrap();
    drop((repo, worker));
    let events: Vec<_> = rx.iter().collect();
    assert_eq!(events.len(), 4, "{events:#?}");
    let (start, end) = (&events[0], &events[1]);
    assert_eq!(start.id, end.id);
    assert_eq!(start.args, ["tag", "v1", &a.to_string()]);
    assert_eq!(start.command_line(), format!("git tag v1 {a}"));
    assert!(!start.is_finished() && end.is_finished());
    assert!(end.success() && !end.read_only);
    assert_eq!(start.cwd, t.repo.workdir());
    assert!(end.finished.unwrap() >= start.started);
    let (start, end) = (&events[2], &events[3]);
    assert_ne!(start.id, events[0].id);
    assert_eq!(start.id, end.id);
    assert_eq!(end.exit_code, Some(1));
    assert!(end.stderr.contains("nope"), "{}", end.stderr);
    // A repo without a sink reports nothing and still works.
    t.repo.delete_tag("v1").unwrap();
}

/// c1 adds a, b; c2 edits a, adds new; c3 renames b -> c, edits a; c4 deletes new, adds d.
fn four_commits(t: &TestRepo) -> [Oid; 4] {
    t.write("a.txt", "1\n");
    t.write("b.txt", "bee\nbee\nbee\nbee\n");
    let c1 = oid(&t.commit_all("c1"));
    t.write("a.txt", "2\n");
    t.write("new.txt", "n\n");
    let c2 = oid(&t.commit_all("c2"));
    t.git(&["mv", "b.txt", "c.txt"]);
    t.write("a.txt", "3\n");
    let c3 = oid(&t.commit_all("c3"));
    std::fs::remove_file(t.path().join("new.txt")).unwrap();
    t.write("d.txt", "d\n");
    let c4 = oid(&t.commit_all("c4"));
    [c1, c2, c3, c4]
}

fn summary(files: &[ide_git::ChangedFile]) -> Vec<String> {
    files
        .iter()
        .map(|f| match &f.old_path {
            Some(o) => format!("{:?} {} <- {}", f.kind, f.path.display(), o.display()),
            None => format!("{:?} {}", f.kind, f.path.display()),
        })
        .collect()
}

/// Runs `git apply --check` with `patch` on stdin in `dir`.
fn apply_check(dir: &std::path::Path, patch: &str) -> Result<(), String> {
    use std::io::Write;
    let mut child = std::process::Command::new("git")
        .current_dir(dir)
        .args(["apply", "--check", "-"])
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(patch.as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

#[test]
fn changes_of_contiguous_and_scattered_selections() {
    let t = TestRepo::new();
    let [c1, c2, c3, c4] = four_commits(&t);

    let one = t.repo.changes_of(&[c3]).unwrap();
    assert_eq!(summary(&one), ["Modified a.txt", "Renamed c.txt <- b.txt"]);

    // Order of the selection does not matter; the net diff drops new.txt.
    let range = t.repo.changes_of(&[c4, c2, c3]).unwrap();
    assert_eq!(summary(&range), ["Modified a.txt", "Renamed c.txt <- b.txt", "Added d.txt"]);

    let scattered = t.repo.changes_of(&[c4, c2]).unwrap();
    assert_eq!(summary(&scattered), ["Modified a.txt", "Added d.txt"]);
    let scattered = t.repo.changes_of(&[c1, c3]).unwrap();
    assert_eq!(summary(&scattered), ["Added a.txt", "Added c.txt"]);

    // Show Diff on the combined selection.
    let d = t.repo.diff_commits_file(&[c2, c4], &p("a.txt")).unwrap();
    assert_eq!((d.old_text.as_str(), d.new_text.as_str()), ("1\n", "2\n"));
    let d = t.repo.diff_commits_file(&[c2, c3, c4], &p("a.txt")).unwrap();
    assert_eq!((d.old_text.as_str(), d.new_text.as_str()), ("1\n", "3\n"));
    let d = t.repo.diff_commits_file(&[c4, c3, c2], &p("c.txt")).unwrap();
    assert_eq!(d.old_path, Some(p("b.txt")));
    assert_eq!(d.old_text, d.new_text);
    let d = t.repo.diff_commits_file(&[c3], &p("a.txt")).unwrap();
    assert_eq!((d.old_text.as_str(), d.new_text.as_str()), ("2\n", "3\n"));
    assert!(t.repo.changes_of(&[]).is_err());
}

#[test]
fn patch_applies_with_git_apply_check() {
    let t = TestRepo::new();
    let [c1, c2, c3, c4] = four_commits(&t);
    // A root commit patches from the empty tree.
    let root = t.repo.patch(&[c1], &[]).unwrap();
    assert!(root.contains("new file mode"), "{root}");

    let range = t.repo.patch(&[c2, c3, c4], &[]).unwrap();
    assert!(range.contains("rename from b.txt") && range.contains("rename to c.txt"), "{range}");
    let scattered = t.repo.patch(&[c2, c4], &[]).unwrap();
    let only_a = t.repo.patch(&[c3], &[p("a.txt")]).unwrap();
    assert!(only_a.contains("a/a.txt") && !only_a.contains("c.txt"), "{only_a}");
    // Selecting the rename target brings its source along.
    let rename = t.repo.patch(&[c3], &[p("c.txt")]).unwrap();
    assert!(rename.contains("rename from b.txt"), "{rename}");

    t.git(&["checkout", "-q", "--detach", &c1.to_string()]);
    apply_check(t.path(), &range).unwrap();
    apply_check(t.path(), &scattered).unwrap();
    apply_check(t.path(), &rename).unwrap();
    t.git(&["checkout", "-q", "--detach", &c2.to_string()]);
    apply_check(t.path(), &only_a).unwrap();
    assert!(apply_check(t.path(), &range).is_err(), "c2 already has the a.txt change");
}

#[test]
fn cherry_pick_paths_applies_only_those_files() {
    let t = TestRepo::new();
    let [c1, _c2, c3, _c4] = four_commits(&t);
    t.git(&["checkout", "-q", "-b", "pick", &c1.to_string()]);

    let out = t.repo.cherry_pick_paths(&c3, &[p("c.txt")]).unwrap();
    assert!(out.success, "{out:?}");
    assert!(t.exists("c.txt") && !t.exists("b.txt"));
    assert_eq!(t.read("a.txt"), "1\n", "a.txt was not selected");
    // Staged, nothing committed.
    let staged = t.git(&["diff", "--cached", "--name-status", "-M"]);
    assert!(staged.starts_with("R100\tb.txt\tc.txt"), "{staged}");
    assert_eq!(t.git(&["rev-parse", "HEAD"]).trim(), c1.to_string());

    // a.txt changed 2 -> 3 in c3, but here it is 1: a three-way conflict.
    let out = t.repo.cherry_pick_paths(&c3, &[p("a.txt")]).unwrap();
    assert!(!out.success);
    assert_eq!(t.repo.conflicts().unwrap(), [p("a.txt")]);
    assert!(t.read("a.txt").contains("<<<<<<<"));

    assert!(t.repo.cherry_pick_paths(&c3, &[p("d.txt")]).is_err(), "d.txt is not in c3");
    assert!(t.repo.cherry_pick_paths(&c3, &[]).is_err());
}

#[test]
fn compare_with_branch_and_diff_with_working_tree() {
    let t = TestRepo::new();
    let [_c1, c2, c3, c4] = four_commits(&t);
    t.git(&["checkout", "-q", "-b", "feature", &c2.to_string()]);
    t.write("f.txt", "f\n");
    let f1 = oid(&t.commit_all("f1"));
    t.git(&["checkout", "-q", "main"]);

    let cmp = t.repo.compare_with_branch("feature").unwrap();
    let ids = |v: &[ide_git::CommitInfo]| v.iter().map(|c| c.oid).collect::<Vec<_>>();
    assert_eq!(ids(&cmp.only_current), [c4, c3]);
    assert_eq!(ids(&cmp.only_other), [f1]);
    assert!(cmp.only_other[0].refs.iter().any(|r| r.name == "feature"));
    assert!(t.repo.compare_with_branch("main").unwrap() == Default::default());

    // Working tree = c4 plus an edit and a staged new file.
    t.write("a.txt", "local\n");
    t.write("staged.txt", "s\n");
    t.git(&["add", "staged.txt"]);
    let files = t.repo.diff_with_working_tree("feature").unwrap();
    assert_eq!(
        summary(&files),
        ["Modified a.txt", "Renamed c.txt <- b.txt", "Added d.txt", "Deleted f.txt", "Deleted new.txt", "Added staged.txt"]
    );
    let d = t.repo.diff_with_working_tree_file("feature", &p("a.txt")).unwrap();
    assert_eq!((d.old_text.as_str(), d.new_text.as_str()), ("2\n", "local\n"));
    let d = t.repo.diff_with_working_tree_file(&c3.to_string(), &p("c.txt")).unwrap();
    assert!(d.old_exists && d.new_exists && d.old_path.is_none());
    let d = t.repo.diff_with_working_tree_file("feature", &t.path().join("c.txt")).unwrap();
    assert_eq!(d.old_path, Some(p("b.txt")));
}
