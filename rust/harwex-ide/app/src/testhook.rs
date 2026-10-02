//! Hidden CLI hooks that drive the real UI code paths, for smoke tests without mouse input:
//!
//! ```text
//! harwex-ide <folder> --open <file> [--goto L:C] [--test-nav <kind>@L:C]... [--test-search <q>]
//!            [--test-find <q>] [--test-term <command>] [--test-quit]
//! ```
//!
//! `kind` is definition | source | type | usages. Positions are 1-based like the status bar.
//! Every step runs through `nav::request` on the `--open` file and logs its result to stderr;
//! the last result is navigated to as usual, so a screenshot shows where it landed.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use ide_editor::Position;

use crate::nav::{self, NavKind};
use crate::state::AppState;

#[derive(Default)]
pub struct TestScript {
    pub open: Option<PathBuf>,
    pub goto: Option<Position>,
    pub steps: VecDeque<(NavKind, Position)>,
    pub search: Option<String>,
    pub find: Option<String>,
    /// `--test-term <command>`: opens the Terminal window and runs the command.
    pub term: Option<String>,
    /// `--test-git-<step> [arg]`: Git UI steps, run in order by `git::remote::testing`.
    pub git: Vec<(String, Option<String>)>,
    pub quit: bool,
    started: bool,
    waiting: bool,
    finished_at: Option<Instant>,
}

/// Parses `L:C` (1-based) into a 0-based position.
pub fn parse_pos(s: &str) -> Option<Position> {
    let (l, c) = s.split_once(':')?;
    Some(Position::new(l.trim().parse::<usize>().ok()?.checked_sub(1)?, c.trim().parse::<usize>().ok()?.checked_sub(1)?))
}

/// Removes the hook flags from `args` and returns the script, if any flag was present.
pub fn parse(args: &mut Vec<String>) -> Option<TestScript> {
    let mut t = TestScript::default();
    let mut any = false;
    let mut rest = Vec::new();
    let mut it = std::mem::take(args).into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--open" => {
                t.open = it.next().map(PathBuf::from);
                any = true;
            }
            "--goto" => t.goto = it.next().as_deref().and_then(parse_pos),
            "--test-nav" => {
                if let Some(spec) = it.next() {
                    match spec.split_once('@').and_then(|(k, p)| Some((NavKind::parse(k)?, parse_pos(p)?))) {
                        Some(step) => t.steps.push_back(step),
                        None => eprintln!("[test] bad --test-nav spec: {spec}"),
                    }
                }
                any = true;
            }
            "--test-goto-definition" => {
                if let Some(p) = it.next().as_deref().and_then(parse_pos) {
                    t.steps.push_back((NavKind::Declaration, p));
                }
                any = true;
            }
            "--test-search" => {
                t.search = it.next();
                any = true;
            }
            "--test-find" => {
                t.find = it.next();
                any = true;
            }
            "--test-term" => {
                t.term = it.next();
                any = true;
            }
            // Git changes/diff/editor steps; queued in git::changes and run there.
            "--test-git-changes" => {
                crate::git::changes::test_queue(&a, String::new());
                any = true;
            }
            "--test-git-commit" => {
                let msg = it.next().unwrap_or_default();
                let paths = it.next().unwrap_or_default();
                crate::git::changes::test_queue(&a, format!("{msg}\u{1}{paths}"));
                any = true;
            }
            "--test-git-diff" | "--test-git-diff-next" | "--test-git-gutter" | "--test-git-rollback-lines" | "--test-git-blame-click" => {
                crate::git::changes::test_queue(&a, it.next().unwrap_or_default());
                any = true;
            }
            "--test-git-annotate" | "--test-git-history" => {
                crate::git::changes::test_queue(&a, String::new());
                any = true;
            }
            "--test-quit" => t.quit = true,
            git if git.starts_with("--test-git-") => {
                let name = git.trim_start_matches("--test-git-").to_string();
                let arg = it.as_slice().first().filter(|v| !v.starts_with("--")).cloned();
                if arg.is_some() {
                    it.next();
                }
                t.git.push((name, arg));
                any = true;
            }
            _ => rest.push(a),
        }
    }
    *args = rest;
    any.then_some(t)
}

/// Advances the script; called once per frame.
pub fn tick(state: &mut AppState) {
    let Some(t) = &mut state.test else { return };
    if state.project.is_none() {
        return;
    }
    if !t.started {
        t.started = true;
        let open = t.open.clone();
        let goto = t.goto;
        let search = t.search.clone();
        let find = t.find.clone();
        let term = t.term.clone();
        let git = std::mem::take(&mut t.git);
        if let Some(p) = open {
            state.open_location(&p, goto, false);
        }
        if let Some(q) = search {
            state.search.open();
            state.search.query = q;
        }
        if let Some(q) = find {
            state.find.query = q;
            crate::find::start(state);
        }
        if let Some(cmd) = term {
            crate::terminal::test_run(state, cmd);
        }
        if !git.is_empty() {
            crate::git::remote::test_steps(state, git);
        }
        return;
    }
    // Steps run on the --open file; wait until its tab exists.
    let tab = t.open.as_ref().and_then(|p| std::fs::canonicalize(p).ok()).and_then(|p| state.tabs.editor_by_path(&p));
    let Some(tab) = tab else {
        if t.open.is_none() {
            finish(state);
        }
        return;
    };
    if t.waiting {
        return;
    }
    if let Some((kind, pos)) = t.steps.pop_front() {
        t.waiting = true;
        state.timings.log(format!("[test] {} at {}:{}", kind.label(), pos.line + 1, pos.column + 1));
        let anchor = egui::pos2(400.0, 300.0);
        nav::request(state, kind, tab, pos, anchor);
    } else {
        finish(state);
    }
}

fn finish(state: &mut AppState) {
    let Some(t) = &mut state.test else { return };
    let at = *t.finished_at.get_or_insert_with(|| {
        eprintln!("[test] done");
        Instant::now()
    });
    if t.quit {
        // A moment for the last jump to render, then quit.
        if at.elapsed() > Duration::from_millis(1500) {
            state.ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        } else {
            state.ctx.request_repaint_after(Duration::from_millis(100));
        }
    }
}

/// A navigation step finished (successfully or not).
pub fn step_done(state: &mut AppState) {
    if let Some(t) = &mut state.test {
        t.waiting = false;
    }
    state.ctx.request_repaint();
}
