//! Restart, Stop and Start Language Servers, from the memory indicator's menu.
//!
//! Stop keeps the project's servers and linters off (`Languages::is_off`) until Start, also
//! across an IDE restart (`persist.rs`, key `languages_off`). Start is a restart with the
//! switch back on.
//!
//! Every language server and linter of a project stops at once (graceful shutdown, killed
//! after a short timeout), so a request stuck on a hung server fails right away. Each queue
//! then opens the project's open files again with their editor text, unsaved edits included,
//! and the servers start lazily as usual. Answers to requests sent before the restart are
//! dropped: navigation, hover and diagnostics bump their generations at the click.

use std::sync::{Arc, Mutex};

use crate::state::AppState;
use crate::workspace::WorkspaceId;

/// Which projects a restart covers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// The project in view.
    Active,
    /// Every project open in the window.
    All,
}

/// What the menu asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Restart,
    Stop,
    Start,
}

/// What finished so far; the last project to finish shows the toast.
struct Tally {
    projects_left: usize,
    files: usize,
}

/// Restarts the language servers and linters of the active project or of all projects. The
/// UI thread only collects the open files; the stop and the new start run on the queues.
pub fn restart_language_servers(state: &mut AppState, scope: Scope) {
    language_servers(state, scope, Action::Restart);
}

/// Restart, Stop or Start for the active project or all projects. Restart leaves projects
/// whose servers are off alone; Stop and Start skip projects already in that state.
pub fn language_servers(state: &mut AppState, scope: Scope, action: Action) {
    let ids: Vec<WorkspaceId> = match scope {
        Scope::Active => vec![state.active_id()],
        Scope::All => state.workspaces().iter().map(|w| w.id).collect(),
    };
    let ids: Vec<WorkspaceId> = ids
        .into_iter()
        .filter(|id| {
            state.workspace(*id).is_some_and(|w| match action {
                Action::Restart | Action::Stop => !w.langs.is_off(),
                Action::Start => w.langs.is_off(),
            })
        })
        .collect();
    if ids.is_empty() {
        return;
    }
    let tally = Arc::new(Mutex::new(Tally { projects_left: ids.len(), files: 0 }));
    for id in ids {
        let tally = tally.clone();
        state.with_ws(id, move |s| project(s, action, tally));
    }
}

fn project(s: &mut AppState, action: Action, tally: Arc<Mutex<Tally>>) {
    s.ws.nav.cancel_requests();
    // A Find Usages search in flight never reports back now.
    crate::find_window::cancel_searches(s);
    let mut docs = Vec::new();
    for (_, e) in s.ws.tabs.editors_mut() {
        if action == Action::Stop {
            // Old squiggles would go stale with every edit and never be checked again.
            e.problems.reset();
            continue;
        }
        e.problems.recheck();
        let Some(lang) = e.lang else { continue };
        e.lsp_version = Some(e.doc.version());
        docs.push((lang, e.path.clone(), e.doc.text()));
    }
    let files = docs.len();
    let jobs = s.jobs.clone();
    let label = match action {
        Action::Restart => "Restarting language servers",
        Action::Stop => "Stopping language servers",
        Action::Start => "Starting language servers",
    };
    // The servers restart on their own queue threads; the job cannot stop them early.
    let busy = jobs.busy_uncancellable(label.to_string());
    let done = move || {
        drop(busy);
        jobs.post(move |state| finished(state, &tally, action, files));
    };
    match action {
        Action::Restart => s.ws.langs.restart(docs, done),
        Action::Stop => s.ws.langs.stop(done),
        Action::Start => s.ws.langs.start(docs, done),
    }
}

fn finished(state: &mut AppState, tally: &Mutex<Tally>, action: Action, files: usize) {
    let mut t = super::lock(tally);
    t.files += files;
    t.projects_left = t.projects_left.saturating_sub(1);
    if t.projects_left > 0 {
        return;
    }
    let body = match t.files {
        0 => "They start again with the next file.".to_string(),
        1 => "1 open file was sent to the new servers.".to_string(),
        n => format!("{n} open files were sent to the new servers."),
    };
    drop(t);
    let title = match action {
        Action::Restart => "Language servers restarted",
        Action::Start => "Language servers started",
        // The memory indicator shows the off state; a toast would only repeat it.
        Action::Stop => {
            state.timings.log("language servers stopped");
            state.memory.sample_now();
            return;
        }
    };
    state.timings.log(format!("{title}: {body}"));
    state.notifications.info(title, body);
    // The tooltip shows the new processes without waiting for the timer.
    state.memory.sample_now();
}
