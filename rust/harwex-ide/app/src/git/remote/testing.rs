//! Hidden `--test-git-<step> [arg]` hooks for the log, branches, remote and conflicts UI.
//! Steps run one after another; each waits until no labelled job is running, plus a short
//! pause so the previous step's result is drawn (and can be screenshotted).
//!
//! Steps: `log`, `select <row>`, `filter <text>`, `filehistory <path>`, `branches`,
//! `branch-menu <name>`, `checkout <branch>`, `merge <branch>`, `rebase <branch>`, `push [branch]`,
//! `update`, `stash`, `unstash`, `conflicts`, `mergetool <path>`, `take <ours|theirs>`, `save`, `dump`, `logaction <copy|checkout|newbranch|reset|revert|cherry-pick>`, `wait <ms>`.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::state::AppState;

pub fn test_steps(state: &mut AppState, steps: Vec<(String, Option<String>)>) {
    state.git_ui.remote.tests.extend(steps);
    state.git_ui.remote.test_next = Some(Instant::now() + Duration::from_millis(800));
}

pub(super) fn tick(state: &mut AppState) {
    let Some(at) = state.git_ui.remote.test_next else { return };
    let now = Instant::now();
    if now < at || !state.jobs.running().is_empty() || state.git.branch.is_none() {
        state.ctx.request_repaint_after(Duration::from_millis(100));
        return;
    }
    let Some((name, arg)) = state.git_ui.remote.tests.pop_front() else {
        state.git_ui.remote.test_next = None;
        eprintln!("[test-git] done");
        return;
    };
    eprintln!("[test-git] {name} {}", arg.as_deref().unwrap_or(""));
    let mut pause = Duration::from_millis(900);
    let arg_s = arg.clone().unwrap_or_default();
    match name.as_str() {
        "log" => state.layout.show(crate::layout::ToolWindow::Git),
        "select" => super::super::log::test_select(state, arg_s.parse().unwrap_or(0)),
        "filter" => super::super::log::test_filter(state, &arg_s),
        "filehistory" => {
            let p = PathBuf::from(&arg_s);
            let abs = if p.is_absolute() { p } else { state.git.repo.as_ref().map(|r| r.workdir().join(&p)).unwrap_or(p) };
            super::super::log::show_file_history(state, &abs);
        }
        "branches" => super::super::branches::open_popup(state, egui::pos2(120.0, 34.0)),
        "branch-menu" => super::super::branches::test_expand(state, &arg_s),
        "checkout" | "merge" | "rebase" => super::super::branches::test_action(state, &name, &arg_s),
        "push" if arg_s.is_empty() => super::open_push_dialog(state),
        "push" => super::open_push_dialog_for(state, arg_s.clone()),
        "update" => super::open_update_dialog(state),
        "stash" => super::open_stash_dialog(state),
        "unstash" => super::open_unstash_dialog(state),
        "conflicts" => super::super::conflicts::open_if_conflicts(state),
        "mergetool" => super::super::conflicts::open_merge(state, PathBuf::from(&arg_s)),
        "save" => super::super::conflicts::test_save(state),
        "take" => super::super::conflicts::test_take_all(state, arg_s == "theirs"),
        "dump" => dump(state),
        "logfile" => super::super::log::test_open_file(state, arg_s.parse().unwrap_or(0)),
        "diffstate" => super::super::diff::test_next(state, 0),
        "logaction" => super::super::log::test_action(state, &arg_s),
        "update-go" => super::update_project(state, arg_s == "rebase"),
        "newbranch" => {
            let n = arg_s.clone();
            super::run_op(state, "New Branch", format!("Created {n}"), false, move |r| r.create_branch(&n, None, true).map(|_| None), |_, _| {});
        }
        "push-go" => {
            let job = state.git_ui.remote.push.as_ref().and_then(|p| {
                let up = p.set_upstream && p.target.as_ref().is_some_and(|t| !t.tracked);
                p.branch.clone().map(|b| super::push_job(b, false, up))
            });
            if let Some(job) = job {
                job(state);
            }
        }
        "stash-go" => {
            state.git_ui.remote.stash = None;
            super::run_op(state, "Stash Changes", "Changes stashed", false, move |r| r.stash_save(&arg_s, true).map(|_| None), |_, _| {});
        }
        "unstash-pop" => super::run_op(state, "Unstash (pop)", "Applied", true, |r| r.stash_apply_with(0, true, false).map(Some), |state, ok| {
            if ok {
                state.git_ui.remote.unstash = None;
            }
        }),
        "continue" => super::super::conflicts::test_continue(state),
        "abort" => super::super::conflicts::test_abort(state),
        "wait" => pause = Duration::from_millis(arg_s.parse().unwrap_or(1000)),
        other => eprintln!("[test-git] unknown step {other}"),
    }
    state.git_ui.remote.test_next = Some(now + pause);
    state.ctx.request_repaint_after(Duration::from_millis(100));
}

/// Prints what the dialogs hold, for runs where no screenshot can be taken.
fn dump(state: &mut AppState) {
    let r = &state.git_ui.remote;
    if let Some(p) = &r.push {
        let subjects: Vec<&str> = p.commits.iter().take(5).map(|c| c.summary.as_str()).collect();
        eprintln!("[test-git] push dialog: branch {:?} target {:?} {} commits {:?} files {:?}", p.branch, p.target, p.commits.len(), subjects, p.details.as_ref().map(|d| d.files.len()));
    }
    if let Some(u) = &r.unstash {
        let msgs: Vec<&str> = u.entries.iter().map(|e| e.message.as_str()).collect();
        eprintln!("[test-git] unstash dialog: {msgs:?}");
    }
    eprintln!("[test-git] {}", super::super::conflicts::test_describe(state));
    eprintln!("[test-git] {}", super::super::log::test_describe(state));
    let tabs: Vec<String> = state.tabs.list.iter().map(|t| t.title()).collect();
    eprintln!("[test-git] tabs {tabs:?}, branch {:?}", state.git.branch);
}
