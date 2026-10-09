//! The background tasks slot in the status bar (task 088): a fixed-width slot, so the
//! breadcrumbs never move when jobs start or end; `+N` for more jobs; the tasks popup with a
//! row per job (name, progress, `×` when the job can be cancelled).
//!
//! The jobs are `busy` guards held by the test thread, so they run until the test drops them.
//! `settle` waits for running jobs, so the snapshots here use `snapshot_running`.

use crate::common::*;
use egui::Key;
use egui_kittest::kittest::Queryable;
use harwex_ide::jobs::report_progress;

const SUITE: &str = "status_jobs";
const DEEP: &str = "src/core/deep/level_one/level_two/level_three/target_file_name.ts";
const LONG: &str = "Indexing files of a project with a really long folder name";

fn deep_repo(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    repo.write(DEEP, "export const target = 1;\n");
    repo
}

/// The screen x of every crumb, left to right.
fn crumb_xs(ide: &Ide) -> Vec<f32> {
    ["repo", "src", "core", "deep", "level_one", "level_two", "level_three", "target_file_name.ts"].iter().map(|n| ide.rect(&format!("Breadcrumb {n}")).min.x).collect()
}

fn slot_text(ide: &Ide) -> Option<String> {
    ide.harness.query_all_by(|n| n.label().is_some_and(|l| l.starts_with("Running: "))).next().and_then(|n| n.value())
}

#[test]
fn breadcrumbs_stay_put_while_jobs_start_and_end() {
    let fx = Fixture::new(SUITE, "slot");
    let repo = deep_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    // The path does not fit, so the row scrolls to its end: a narrower bar would move it.
    ide.resize(egui::vec2(900.0, 800.0));
    ide.open_file(DEEP);
    ide.park_mouse();
    assert!(ide.state().ws.breadcrumbs.scroll_x > 0.0, "the path scrolls at 900 pt");
    let idle = crumb_xs(&ide);
    assert!(slot_text(&ide).is_none(), "an empty slot when nothing runs");
    ide.snapshot("no_jobs");

    let one = ide.state().jobs.busy(LONG);
    ide.steps(5);
    assert_eq!(crumb_xs(&ide), idle, "one job moves no crumb");
    // The long label is cut; the a11y value keeps the whole text.
    assert_eq!(slot_text(&ide).as_deref(), Some(LONG));
    ide.snapshot_running("one_job");

    let two = ide.state().jobs.busy_uncancellable("Git status");
    let three = ide.state().jobs.busy("oxlint: src/app.ts");
    ide.steps(5);
    assert_eq!(crumb_xs(&ide), idle, "three jobs move no crumb");
    assert_eq!(slot_text(&ide).as_deref(), Some(format!("{LONG}  +2").as_str()));
    ide.snapshot_running("three_jobs");

    drop((one, two, three));
    ide.settle();
    assert_eq!(crumb_xs(&ide), idle, "the end of the jobs moves no crumb");
    assert!(slot_text(&ide).is_none());
}

#[test]
fn tasks_popup_lists_every_job_and_cancels_one() {
    let fx = Fixture::new(SUITE, "popup");
    let repo = deep_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    let one = ide.state().jobs.busy(LONG);
    // The test thread holds all three guards; progress goes to the newest one.
    report_progress(0.4);
    let two = ide.state().jobs.busy_uncancellable("Git status");
    let three = ide.state().jobs.busy("oxlint: src/app.ts");
    report_progress(0.75);
    ide.steps(3);

    ide.click(&format!("Running: {LONG}"));
    ide.steps(3);
    assert!(harwex_ide::progress::list_open(&ide.ctx()));
    for label in [format!("Task {LONG}"), "Task Git status".into(), "Task oxlint: src/app.ts".into()] {
        assert!(ide.has(&label), "missing {label}: {:?}", ide.labels());
    }
    // A × for each job that can be cancelled, none for Git status.
    assert!(ide.has(&format!("Cancel {LONG} in the list (1)")));
    assert!(!ide.labels().iter().any(|l| l.starts_with("Cancel Git status")));
    assert!(ide.has("Cancel oxlint: src/app.ts in the list (3)"));
    ide.snapshot_running("tasks_popup");

    // Escape closes the popup; a press on the slot opens it again, a press outside closes it.
    ide.key(Key::Escape);
    assert!(!harwex_ide::progress::list_open(&ide.ctx()));
    ide.click(&format!("Running: {LONG}"));
    ide.steps(3);
    assert!(harwex_ide::progress::list_open(&ide.ctx()));
    let editor = ide.rect("Editor util.ts").center();
    ide.click_at(editor);
    assert!(!harwex_ide::progress::list_open(&ide.ctx()));

    // The popup follows the job list live: a cancelled job says so, an ended job leaves.
    ide.click(&format!("Running: {LONG}"));
    ide.steps(3);
    ide.click("Cancel oxlint: src/app.ts in the list (3)");
    assert!(ide.state().jobs.running().iter().any(|j| j.label == "oxlint: src/app.ts" && j.cancel.is_cancelled()));
    assert!(ide.has("Task oxlint: src/app.ts — cancelling…"), "{:?}", ide.labels());
    drop(three);
    ide.steps(3);
    assert!(!ide.labels().iter().any(|l| l.starts_with("Task oxlint")));
    assert!(harwex_ide::progress::list_open(&ide.ctx()), "the popup stays while jobs run");

    // When the last job ends, the popup closes.
    drop((one, two));
    ide.settle();
    assert!(!harwex_ide::progress::list_open(&ide.ctx()));
    assert!(!ide.labels().iter().any(|l| l.starts_with("Task ")));
}

/// The slot's width: from its left end (the job text) to its right end (the `×`).
fn slot_width(ide: &Ide) -> f32 {
    ide.rect(&format!("Cancel {LONG}")).max.x - ide.rect(&format!("Running: {LONG}")).min.x
}

#[test]
fn slot_is_204_wide_and_136_in_a_narrow_window() {
    use harwex_ide::progress::{SLOT_W, SLOT_W_NARROW};
    assert_eq!((SLOT_W, SLOT_W_NARROW), (204.0, 136.0), "15% under the first 240 and 160");
    let fx = Fixture::new(SUITE, "slot_width");
    let repo = deep_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("src/util.ts");
    // The narrow window first: `resize` settles, and settling waits for running jobs.
    ide.resize(egui::vec2(640.0, 800.0));
    let job = ide.state().jobs.busy(LONG);
    ide.steps(5);
    assert!((slot_width(&ide) - SLOT_W_NARROW).abs() < 0.5, "narrow slot: {}", slot_width(&ide));
    ide.snapshot_running("narrow_slot");
    drop(job);
    ide.resize(egui::vec2(1280.0, 800.0));
    let job = ide.state().jobs.busy(LONG);
    ide.steps(5);
    assert!((slot_width(&ide) - SLOT_W).abs() < 0.5, "wide slot: {}", slot_width(&ide));
    drop(job);
    ide.settle();
}
