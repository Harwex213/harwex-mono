mod common;

use common::{configure, git_in, p, TestRepo};
use ide_git::{ChangeKind, ConflictChoice, LogFilter, Oid, RefKind, Repo, RepoState, ResetMode};

/// main: A - B - D - M, feature: A - C, M merges feature.
fn merged_history(t: &TestRepo) -> [String; 5] {
    t.write("a.txt", "a\n");
    let a = t.commit_all("A");
    t.write("b.txt", "b\n");
    let b = t.commit_all("B");
    t.git(&["checkout", "-q", "-b", "feature", &a]);
    t.write("c.txt", "c\n");
    let c = t.commit_all("C feature work");
    t.git(&["checkout", "-q", "main"]);
    t.write("d.txt", "d\n");
    let d = t.commit_all("D");
    t.git(&["merge", "-q", "--no-ff", "--no-edit", "feature"]);
    let m = t.git(&["rev-parse", "HEAD"]).trim().to_string();
    [a, b, c, d, m]
}

#[test]
fn log_filters_paging_and_graph_with_merge() {
    let t = TestRepo::new();
    let [a, b, c, d, m] = merged_history(&t);
    let log = t.repo.log(&LogFilter::default(), 0, 100).unwrap();
    let ids: Vec<String> = log.iter().map(|c| c.oid.to_string()).collect();
    assert_eq!(ids.len(), 5);
    assert_eq!(ids[0], m);
    assert_eq!(ids[4], a);
    let pos = |x: &str| ids.iter().position(|i| i == x).unwrap();
    assert!(pos(&d) < pos(&b));
    assert_eq!(log[0].parents.len(), 2);
    let main_label = log[0].refs.iter().find(|r| r.name == "main").unwrap();
    assert!(main_label.is_current && main_label.kind == RefKind::LocalBranch);
    assert!(log[pos(&c)].refs.iter().any(|r| r.name == "feature"));

    // Paging returns the same sequence.
    let page1 = t.repo.log(&LogFilter::default(), 0, 2).unwrap();
    let page2 = t.repo.log(&LogFilter::default(), 2, 2).unwrap();
    let paged: Vec<String> = page1.iter().chain(&page2).map(|c| c.oid.to_string()).collect();
    assert_eq!(paged, ids[..4]);

    let text = LogFilter { text: Some("FEATURE".into()), ..Default::default() };
    let r = t.repo.log(&text, 0, 10).unwrap();
    assert_eq!(r.len(), 2, "C plus the merge message mentioning feature");
    let by_hash = LogFilter { text: Some(c[..8].to_string()), ..Default::default() };
    assert_eq!(t.repo.log(&by_hash, 0, 10).unwrap()[0].oid.to_string(), c);
    let path = LogFilter { paths: vec![p("c.txt")], ..Default::default() };
    let r = t.repo.log(&path, 0, 10).unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].oid.to_string(), c);
    let author = LogFilter { authors: vec!["nobody".into()], ..Default::default() };
    assert!(t.repo.log(&author, 0, 10).unwrap().is_empty());
    let branch = LogFilter { branches: vec!["feature".into()], ..Default::default() };
    assert_eq!(t.repo.log(&branch, 0, 10).unwrap().len(), 2);

    let rows = t.repo.graph(&log);
    assert_eq!(rows.len(), 5);
    // The merge opens a second lane; the first-parent line stays in lane 0.
    assert_eq!(rows[0].lane, 0);
    assert_eq!(rows[0].down.len(), 2);
    assert!(rows[0].down.iter().any(|e| e.from == 0 && e.to == 1));
    let c_row = &rows[pos(&c)];
    assert_eq!(c_row.lane, 1);
    // A is where both lines meet again.
    let a_row = &rows[4];
    assert_eq!(a_row.lane, 0);
    assert!(a_row.up.iter().any(|e| e.from == 1 && e.to == 0), "{:?}", a_row.up);
    assert!(a_row.down.is_empty());
    assert!(rows.iter().all(|r| r.width <= 2));
    // up of each row equals down of the previous one.
    for i in 1..rows.len() {
        assert_eq!(rows[i].up, rows[i - 1].down);
    }
}

#[test]
fn commit_details_file_history_and_blame() {
    let t = TestRepo::new();
    t.write("src/old.ts", "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
    let first = t.commit_all("create");
    t.git(&["mv", "src/old.ts", "src/new.ts"]);
    let renamed = t.commit_all("rename");
    t.write("src/new.ts", "export const a = 1;\nexport const b = 20;\nexport const c = 3;\n");
    let edited = t.commit_all("edit\n\nlonger body");
    t.write("other.txt", "x\n");
    t.commit_all("unrelated");

    let det = t.repo.commit_details(&edited.parse().unwrap()).unwrap();
    assert_eq!(det.message.trim(), "edit\n\nlonger body");
    assert_eq!(det.info.summary, "edit");
    assert_eq!(det.files.len(), 1);
    assert_eq!(det.files[0].kind, ChangeKind::Modified);
    let det = t.repo.commit_details(&renamed.parse().unwrap()).unwrap();
    assert_eq!(det.files[0].kind, ChangeKind::Renamed);
    assert_eq!(det.files[0].old_path, Some(p("src/old.ts")));

    let hist = t.repo.file_history_with_paths(&p("src/new.ts"), 10).unwrap();
    let ids: Vec<(String, std::path::PathBuf)> = hist.iter().map(|(c, p)| (c.oid.to_string(), p.clone())).collect();
    assert_eq!(
        ids,
        vec![(edited.clone(), p("src/new.ts")), (renamed, p("src/new.ts")), (first.clone(), p("src/old.ts"))]
    );

    t.write("src/new.ts", "export const a = 1;\nexport const b = 20;\nexport const c = 3;\nlocal\n");
    let blame = t.repo.blame(&p("src/new.ts")).unwrap();
    assert_eq!(blame.len(), 4);
    assert_eq!(blame[0].oid.to_string(), first);
    assert_eq!(blame[1].oid.to_string(), edited);
    assert_eq!(blame[1].summary, "edit");
    assert_eq!(blame[1].author, "Test User");
    assert!(blame[3].oid.is_zero());
    let blame = t.repo.blame_text(&p("src/new.ts"), "new first line\nexport const a = 1;\n").unwrap();
    assert!(blame[0].oid.is_zero());
    assert_eq!(blame[1].oid.to_string(), first);
}

/// A clone of a bare "remote" with one commit on main.
fn with_remote() -> (tempfile::TempDir, TestRepo, TestRepo) {
    let remote = tempfile::tempdir().unwrap();
    git_in(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
    let seed = TestRepo::new();
    seed.write("f.txt", "1\n");
    seed.commit_all("seed");
    let url = remote.path().to_str().unwrap();
    seed.git(&["remote", "add", "origin", url]);
    seed.git(&["push", "-q", "-u", "origin", "main"]);

    let dir = tempfile::tempdir().unwrap();
    git_in(dir.path(), &["clone", "-q", url, "."]);
    configure(dir.path());
    let repo = Repo::discover(dir.path()).unwrap();
    (remote, seed, TestRepo { dir, repo })
}

#[test]
fn branches_ahead_behind_fetch_pull_push() {
    let (_remote, seed, t) = with_remote();
    seed.write("f.txt", "2\n");
    seed.commit_all("upstream change");
    seed.git(&["push", "-q"]);
    t.write("g.txt", "local\n");
    t.commit_all("local change");

    let out = t.repo.fetch().unwrap();
    assert!(out.success, "{out:?}");
    let br = t.repo.branches().unwrap();
    assert_eq!(br.current.as_deref(), Some("main"));
    let main = br.local.iter().find(|b| b.name == "main").unwrap();
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
    assert_eq!((main.ahead, main.behind), (1, 1));
    assert!(main.is_current);
    assert!(br.remote.iter().any(|b| b.name == "origin/main"));
    assert!(!br.remote.iter().any(|b| b.name.ends_with("HEAD")));

    let outgoing = t.repo.outgoing().unwrap();
    assert_eq!(outgoing.len(), 1);
    assert_eq!(outgoing[0].summary, "local change");

    let out = t.repo.pull(true).unwrap();
    assert!(out.success, "{out:?}");
    let main = t.repo.branches().unwrap().local.into_iter().find(|b| b.name == "main").unwrap();
    assert_eq!((main.ahead, main.behind), (1, 0));
    let out = t.repo.push(false, false).unwrap();
    assert!(out.success, "{out:?}");
    assert!(t.repo.outgoing().unwrap().is_empty());

    // A new branch has no upstream: outgoing lists what no remote has, push sets it up.
    t.repo.create_branch("topic", None, true).unwrap();
    t.write("t.txt", "t\n");
    t.commit_all("topic work");
    assert_eq!(t.repo.outgoing().unwrap().len(), 1);
    let out = t.repo.push(false, true).unwrap();
    assert!(out.success, "{out:?}");
    let topic = t.repo.branches().unwrap().local.into_iter().find(|b| b.name == "topic").unwrap();
    assert_eq!(topic.upstream.as_deref(), Some("origin/topic"));

    // Checking out a remote branch creates a tracking local branch.
    seed.git(&["checkout", "-q", "-b", "remote-only"]);
    seed.write("r.txt", "r\n");
    seed.commit_all("remote only");
    seed.git(&["push", "-q", "origin", "remote-only"]);
    t.repo.fetch().unwrap();
    t.repo.checkout("origin/remote-only").unwrap();
    let br = t.repo.branches().unwrap();
    assert_eq!(br.current.as_deref(), Some("remote-only"));
    let ro = br.local.iter().find(|b| b.name == "remote-only").unwrap();
    assert_eq!(ro.upstream.as_deref(), Some("origin/remote-only"));
    assert_eq!(br.recent.first().map(String::as_str), Some("topic"));
}

/// Push of a branch that is not checked out: new upstream, existing upstream under another
/// name, force-with-lease; HEAD and the worktree never move.
#[test]
fn push_non_current_branch() {
    let (remote, _seed, t) = with_remote();
    let remote_rev = |r: &str| git_in(remote.path(), &["rev-parse", r]).trim().to_string();
    t.repo.create_branch("feature", None, false).unwrap();
    t.git(&["checkout", "-q", "feature"]);
    t.write("feat.txt", "1\n");
    let f1 = t.commit_all("feature one");
    t.write("feat.txt", "2\n");
    let f2 = t.commit_all("feature two");
    t.git(&["checkout", "-q", "main"]);
    let head = t.git(&["rev-parse", "HEAD"]);

    // No upstream: outgoing lists what no remote has, the push creates the branch and tracks it.
    let out: Vec<String> = t.repo.outgoing_of("feature").unwrap().into_iter().map(|c| c.summary).collect();
    assert_eq!(out, ["feature two", "feature one"]);
    assert!(t.repo.outgoing().unwrap().is_empty(), "HEAD (main) has nothing to push");
    let target = t.repo.push_target("feature").unwrap();
    assert_eq!((target.remote.as_str(), target.branch.as_str(), target.tracked), ("origin", "feature", false));
    let res = t.repo.push_branch("feature", false, true).unwrap();
    assert!(res.success, "{res:?}");
    assert_eq!(remote_rev("refs/heads/feature"), f2);
    let feature = t.repo.branches().unwrap().local.into_iter().find(|b| b.name == "feature").unwrap();
    assert_eq!(feature.upstream.as_deref(), Some("origin/feature"));
    assert!(t.repo.outgoing_of("feature").unwrap().is_empty());
    assert_eq!(t.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(t.repo.branches().unwrap().current.as_deref(), Some("main"));

    // An existing upstream with a different name gets the push, not a same-named branch.
    t.git(&["branch", "--set-upstream-to=origin/main", "feature"]);
    let target = t.repo.push_target("feature").unwrap();
    assert_eq!((target.branch.as_str(), target.tracked), ("main", true));
    assert_eq!(t.repo.outgoing_of("feature").unwrap().len(), 2);
    let res = t.repo.push_branch("feature", false, false).unwrap();
    assert!(res.success, "{res:?}");
    assert_eq!(remote_rev("refs/heads/main"), f2);

    // A rewritten branch needs force-with-lease; a plain push is rejected.
    t.git(&["branch", "--set-upstream-to=origin/feature", "feature"]);
    t.git(&["branch", "-f", "feature", &f1]);
    t.git(&["checkout", "-q", "feature"]);
    t.write("feat.txt", "rewritten\n");
    let rewritten = t.commit_all("feature rewritten");
    t.git(&["checkout", "-q", "main"]);
    t.repo.fetch().unwrap();
    let res = t.repo.push_branch("feature", false, false).unwrap();
    assert!(!res.success, "a non-fast-forward push must fail");
    assert_eq!(remote_rev("refs/heads/feature"), f2);
    let res = t.repo.push_branch("feature", true, false).unwrap();
    assert!(res.success, "{res:?}");
    assert_eq!(remote_rev("refs/heads/feature"), rewritten);
    assert_eq!(t.repo.branches().unwrap().current.as_deref(), Some("main"));

    // Force-with-lease refuses when the remote moved since the last fetch.
    let other = tempfile::tempdir().unwrap();
    git_in(other.path(), &["clone", "-q", "-b", "feature", remote.path().to_str().unwrap(), "."]);
    configure(other.path());
    std::fs::write(other.path().join("o.txt"), "o\n").unwrap();
    git_in(other.path(), &["add", "-A"]);
    git_in(other.path(), &["commit", "-q", "-m", "someone else"]);
    git_in(other.path(), &["push", "-q", "origin", "feature"]);
    let theirs = remote_rev("refs/heads/feature");
    let res = t.repo.push_branch("feature", true, false).unwrap();
    assert!(!res.success, "stale lease must be rejected");
    assert_eq!(remote_rev("refs/heads/feature"), theirs);

    // A branch that tracks a local branch pushes to the default remote under its own name.
    t.git(&["branch", "--track", "local-child", "main"]);
    let target = t.repo.push_target("local-child").unwrap();
    assert_eq!((target.remote.as_str(), target.branch.as_str(), target.tracked), ("origin", "local-child", false));
    assert!(t.repo.push_branch("missing", false, false).is_err());
    assert_eq!(t.git(&["rev-parse", "HEAD"]), head);
}

#[test]
fn branch_management_and_log_actions() {
    let t = TestRepo::new();
    t.write("f.txt", "1\n");
    let first: Oid = t.commit_all("one").parse().unwrap();
    t.write("f.txt", "2\n");
    let second: Oid = t.commit_all("two").parse().unwrap();

    t.repo.create_branch("side", Some(&first.to_string()), false).unwrap();
    t.repo.rename_branch("side", "side2").unwrap();
    let br = t.repo.branches().unwrap();
    assert!(br.local.iter().any(|b| b.name == "side2" && b.oid == first));
    t.repo.checkout("side2").unwrap();
    assert_eq!(t.read("f.txt"), "1\n");
    t.repo.checkout("main").unwrap();
    assert!(t.repo.delete_branch("side2", false).is_ok(), "merged into main, so -d works");

    t.repo.create_branch("unmerged", None, true).unwrap();
    t.write("u.txt", "u\n");
    t.commit_all("unmerged work");
    t.repo.checkout("main").unwrap();
    assert!(t.repo.delete_branch("unmerged", false).is_err());
    t.repo.delete_branch("unmerged", true).unwrap();

    let out = t.repo.revert(&second).unwrap();
    assert!(out.success, "{out:?}");
    assert_eq!(t.read("f.txt"), "1\n");
    let out = t.repo.cherry_pick(&second).unwrap();
    assert!(out.success, "{out:?}");
    assert_eq!(t.read("f.txt"), "2\n");

    let out = t.repo.reset(&second, ResetMode::Soft).unwrap();
    assert!(out.success, "{out:?}");
    assert_eq!(t.read("f.txt"), "2\n");
    let out = t.repo.reset(&first, ResetMode::Hard).unwrap();
    assert!(out.success, "{out:?}");
    assert_eq!(t.read("f.txt"), "1\n");

    t.repo.checkout_revision(&second).unwrap();
    let br = t.repo.branches().unwrap();
    assert!(br.detached && br.current.is_none() && br.head == Some(second));
}

#[test]
fn stash_save_list_apply_drop() {
    let t = TestRepo::new();
    t.write("f.txt", "1\n");
    t.commit_all("init");
    t.write("f.txt", "2\n");
    t.write("new.txt", "untracked\n");
    t.repo.stash_save("first stash", true).unwrap();
    assert_eq!(t.read("f.txt"), "1\n");
    assert!(!t.exists("new.txt"));
    t.write("f.txt", "3\n");
    t.repo.stash_save("", false).unwrap();

    let list = t.repo.stash_list().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[1].index, 1);
    assert!(list[1].message.contains("first stash"), "{list:?}");

    let out = t.repo.stash_apply(1, true).unwrap();
    assert!(out.success, "{out:?}");
    assert_eq!(t.read("f.txt"), "2\n");
    assert!(t.exists("new.txt"));
    assert_eq!(t.repo.stash_list().unwrap().len(), 1);
    t.repo.stash_drop(0).unwrap();
    assert!(t.repo.stash_list().unwrap().is_empty());
}

#[test]
fn merge_conflict_detect_and_resolve() {
    let t = TestRepo::new();
    t.write("f.txt", "base\n");
    t.write("g.txt", "g base\n");
    t.commit_all("base");
    t.repo.create_branch("other", None, true).unwrap();
    t.write("f.txt", "theirs\n");
    t.write("g.txt", "g theirs\n");
    t.commit_all("other change");
    t.repo.checkout("main").unwrap();
    t.write("f.txt", "ours\n");
    t.write("g.txt", "g ours\n");
    t.commit_all("main change");

    let out = t.repo.merge("other").unwrap();
    assert!(!out.success);
    assert_eq!(t.repo.state().unwrap(), RepoState::Merge);
    assert_eq!(t.repo.conflicts().unwrap(), vec![p("f.txt"), p("g.txt")]);
    let st = t.repo.status().unwrap();
    assert!(st.iter().all(|c| c.kind() == ChangeKind::Conflicted));

    let sides = t.repo.conflict_sides(&p("f.txt")).unwrap();
    assert_eq!(sides.base.as_deref(), Some("base\n"));
    assert_eq!(sides.ours.as_deref(), Some("ours\n"));
    assert_eq!(sides.theirs.as_deref(), Some("theirs\n"));

    t.repo.resolve(&p("f.txt"), "merged\n").unwrap();
    t.repo.resolve_with(&p("g.txt"), ConflictChoice::Theirs).unwrap();
    assert!(t.repo.conflicts().unwrap().is_empty());
    assert_eq!(t.read("g.txt"), "g theirs\n");
    let out = t.repo.continue_operation().unwrap();
    assert!(out.success, "{out:?}");
    assert_eq!(t.repo.state().unwrap(), RepoState::Clean);
    assert_eq!(t.head_text("f.txt"), "merged\n");
    assert_eq!(t.git(&["rev-list", "--parents", "-n1", "HEAD"]).split_whitespace().count(), 3);
}

#[test]
fn commit_during_merge_commits_everything() {
    let t = TestRepo::new();
    t.write("f.txt", "base\n");
    t.commit_all("base");
    t.repo.create_branch("other", None, true).unwrap();
    t.write("f.txt", "theirs\n");
    t.commit_all("other");
    t.repo.checkout("main").unwrap();
    t.write("f.txt", "ours\n");
    t.commit_all("main");
    assert!(!t.repo.merge("other").unwrap().success);
    t.write("f.txt", "resolved\n");
    let out = t.repo.commit("Merge other", &[p("f.txt")], false).unwrap();
    assert!(out.success(), "{:?}", out.output);
    assert_eq!(t.repo.state().unwrap(), RepoState::Clean);
    assert_eq!(t.git(&["rev-list", "--parents", "-n1", "HEAD"]).split_whitespace().count(), 3);
}

#[test]
fn rebase_conflict_abort() {
    let t = TestRepo::new();
    t.write("f.txt", "base\n");
    t.commit_all("base");
    t.repo.create_branch("other", None, true).unwrap();
    t.write("f.txt", "theirs\n");
    t.commit_all("other");
    t.repo.checkout("main").unwrap();
    t.write("f.txt", "ours\n");
    t.commit_all("main");
    let out = t.repo.rebase("other").unwrap();
    assert!(!out.success);
    assert_eq!(t.repo.state().unwrap(), RepoState::Rebase);
    assert_eq!(t.repo.conflicts().unwrap(), vec![p("f.txt")]);
    assert!(t.repo.abort_operation().unwrap().success);
    assert_eq!(t.repo.state().unwrap(), RepoState::Clean);
    assert_eq!(t.read("f.txt"), "ours\n");
}

#[test]
fn empty_repo_is_not_an_error() {
    let t = TestRepo::new();
    assert!(t.repo.log(&LogFilter::default(), 0, 10).unwrap().is_empty());
    assert!(t.repo.outgoing().unwrap().is_empty());
    let br = t.repo.branches().unwrap();
    assert_eq!(br.current.as_deref(), Some("main"));
    assert!(br.head.is_none());
    assert!(t.repo.status().unwrap().is_empty());
}
