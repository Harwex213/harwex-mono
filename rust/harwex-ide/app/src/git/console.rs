//! Console tab: git commands the IDE ran (`ide_git::CommandEvent`) with output. Task 028 owns this file.
//!
//! `attach` gives the project's `Repo` a command sink before anything clones it. A forwarding
//! thread posts each event to the UI thread, where `on_event` stores it. A writing command
//! reopens a closed Console tab without switching to it.

use std::sync::mpsc;

use egui::{RichText, ScrollArea, Ui};
use ide_git::{CommandEvent, Repo};

use crate::jobs::Jobs;
use crate::state::AppState;
use crate::theme;

/// Older commands are dropped; the Console is a log, not a history store.
const MAX_ENTRIES: usize = 500;
/// Output lines shown per stream and command.
const MAX_LINES: usize = 40;

#[derive(Default)]
pub struct ConsoleUi {
    /// Commands in start order. A finish event replaces the start event with the same id.
    entries: Vec<CommandEvent>,
    /// Read-only commands (diff, blame, show) are hidden unless this is on.
    pub show_reads: bool,
}

impl ConsoleUi {
    pub fn entries(&self) -> &[CommandEvent] {
        &self.entries
    }

    fn store(&mut self, ev: CommandEvent) {
        match self.entries.iter_mut().rev().find(|e| e.id == ev.id) {
            Some(slot) => *slot = ev,
            None => {
                self.entries.push(ev);
                if self.entries.len() > MAX_ENTRIES {
                    let extra = self.entries.len() - MAX_ENTRIES;
                    self.entries.drain(..extra);
                }
            }
        }
    }
}

/// Reports every CLI run of `repo` and its clones to the Console of project `generation`.
/// Call before the `Repo` is cloned into workers: clones made earlier have no sink.
pub fn attach(mut repo: Repo, jobs: &Jobs, generation: u64) -> Repo {
    let (tx, rx) = mpsc::channel::<CommandEvent>();
    repo.set_command_sink(tx);
    let jobs = jobs.clone();
    // The loop ends when the last clone of the repository handle is dropped.
    let spawned = std::thread::Builder::new().name("git console".into()).spawn(move || {
        for ev in rx {
            jobs.post(move |state| {
                if state.project_generation() == generation {
                    on_event(state, ev);
                }
            });
        }
    });
    if let Err(e) = spawned {
        eprintln!("[harwex-ide] git console thread: {e}");
    }
    repo
}

pub fn on_event(state: &mut AppState, ev: CommandEvent) {
    let writes = !ev.read_only && !ev.is_finished();
    state.git_ui.window.console.store(ev);
    if writes {
        super::window::reopen_console(state);
    }
}

pub fn body(state: &mut AppState, ui: &mut Ui) {
    let t = &theme::T;
    let deterministic = state.deterministic;
    let console = &mut state.git_ui.window.console;
    ui.horizontal(|ui| {
        if ui.small_button("Clear").clicked() {
            console.entries.clear();
        }
        ui.checkbox(&mut console.show_reads, "Show read commands");
    });
    ui.add_space(2.0);
    let shown: Vec<&CommandEvent> = console.entries.iter().filter(|e| console.show_reads || !e.read_only).collect();
    if shown.is_empty() {
        ui.label(RichText::new("No git commands yet. Commands the IDE runs (fetch, checkout, commit, ...) show here with their output.").color(t.text_dim));
        return;
    }
    ScrollArea::vertical().auto_shrink([false, false]).stick_to_bottom(true).id_salt("git-console").show(ui, |ui| {
        ui.spacing_mut().item_spacing.y = 1.0;
        for ev in shown {
            let line = ev.command_line();
            let (color, status) = match (ev.is_finished(), ev.success()) {
                (false, _) => (t.text_dim, "running...".to_string()),
                (true, true) => (t.text_bright, String::new()),
                (true, false) => (t.error, match ev.exit_code {
                    Some(c) => format!("exit code {c}"),
                    None => "failed".to_string(),
                }),
            };
            let resp = ui.horizontal(|ui| {
                ui.label(RichText::new(&line).font(t.mono_font()).color(color));
                if !status.is_empty() {
                    ui.label(RichText::new(&status).font(t.small_font()).color(if ev.is_finished() { t.error } else { t.text_dim }));
                }
                if let (Some(end), false) = (ev.finished, deterministic) {
                    if let Ok(d) = end.duration_since(ev.started) {
                        ui.label(RichText::new(format!("{} ms", d.as_millis())).font(t.small_font()).color(t.text_dim));
                    }
                }
            });
            crate::util::label_widget(&resp.response, egui::WidgetType::Label, format!("Command {line}"));
            let failed = ev.is_finished() && !ev.success();
            for (text, c) in [(&ev.stdout, t.text), (&ev.stderr, if failed { t.error } else { t.text_dim })] {
                let trimmed = text.trim_end();
                if trimmed.is_empty() {
                    continue;
                }
                let lines: Vec<&str> = trimmed.lines().collect();
                for l in lines.iter().take(MAX_LINES) {
                    ui.label(RichText::new(format!("  {l}")).font(t.mono_small_font()).color(c));
                }
                if lines.len() > MAX_LINES {
                    ui.label(RichText::new(format!("  ... {} more lines", lines.len() - MAX_LINES)).font(t.mono_small_font()).color(t.text_dim));
                }
            }
            ui.add_space(4.0);
        }
    });
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::SystemTime;

    use super::*;

    fn ev(id: u64, finished: bool) -> CommandEvent {
        CommandEvent {
            id,
            args: vec!["fetch".into()],
            cwd: PathBuf::new(),
            started: SystemTime::UNIX_EPOCH,
            finished: finished.then_some(SystemTime::UNIX_EPOCH),
            exit_code: finished.then_some(0),
            stdout: String::new(),
            stderr: String::new(),
            read_only: false,
        }
    }

    #[test]
    fn finish_replaces_start() {
        let mut c = ConsoleUi::default();
        c.store(ev(1, false));
        c.store(ev(2, false));
        c.store(ev(1, true));
        assert_eq!(c.entries.len(), 2);
        assert!(c.entries[0].is_finished());
        assert!(!c.entries[1].is_finished());
    }
}
