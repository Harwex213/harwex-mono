//! Shared support for the headless UI tests: the `Ide` driver (an `egui_kittest` harness around
//! the real `IdeApp`), input helpers that send real pointer and key events, and snapshot
//! comparison. Fixtures (throwaway repos and projects) live in `fixtures.rs`.
//!
//! Nothing here opens a window or touches the user's app storage.

#![allow(dead_code)] // Each test binary uses a different subset.

pub mod fixtures;

use std::path::{Path, PathBuf};
use std::sync::Once;
use std::time::{Duration, Instant};

use egui::{Event, Key, Modifiers, PointerButton, Pos2, Rect, Vec2};
use egui_kittest::kittest::{Node, Queryable};
use egui_kittest::{Harness, SnapshotError, SnapshotOptions};
use harwex_ide::{AppOptions, AppState, IdeApp, TerminalCommand};

pub use fixtures::*;

/// Window size of every test. Snapshots depend on it.
pub const SIZE: Vec2 = Vec2::new(1280.0, 800.0);
/// Virtual time per frame. Small enough that two clicks in a row count as a double click.
pub const STEP_DT: f32 = 0.05;
/// Pixels that may differ before a snapshot fails (anti-aliasing noise between GPU runs).
pub const MAX_DIFF_PIXELS: i32 = 64;
const SETTLE_TIMEOUT: Duration = Duration::from_secs(40);

pub const CMD: Modifiers = Modifiers { alt: false, ctrl: false, shift: false, mac_cmd: true, command: true };
pub const CMD_SHIFT: Modifiers = Modifiers { alt: false, ctrl: false, shift: true, mac_cmd: true, command: true };
pub const CTRL_SHIFT: Modifiers = Modifiers { alt: false, ctrl: true, shift: true, mac_cmd: false, command: false };
pub const SHIFT: Modifiers = Modifiers::SHIFT;
pub const ALT: Modifiers = Modifiers::ALT;

static INIT: Once = Once::new();

/// Process-wide setup, run before any test thread spawns a child process. Git commands that the
/// app runs inherit a fixed identity and date, so hashes and log dates are stable.
pub fn init() {
    INIT.call_once(|| {
        for (k, v) in [
            ("GIT_AUTHOR_NAME", "Test User"),
            ("GIT_AUTHOR_EMAIL", "test@example.com"),
            ("GIT_COMMITTER_NAME", "Test User"),
            ("GIT_COMMITTER_EMAIL", "test@example.com"),
            ("GIT_AUTHOR_DATE", "2024-06-01T12:00:00+0000"),
            ("GIT_COMMITTER_DATE", "2024-06-01T12:00:00+0000"),
            ("GIT_CONFIG_NOSYSTEM", "1"),
            ("GIT_TERMINAL_PROMPT", "0"),
        ] {
            // Runs once, before this binary starts any thread that reads the environment.
            std::env::set_var(k, v);
        }
        fixtures::use_test_rust_tools();
    });
}

/// The terminal every test uses: zsh without rc files and with a fixed prompt, so the screen
/// does not depend on the user's shell setup.
pub fn test_terminal() -> TerminalCommand {
    TerminalCommand {
        argv: vec!["/bin/zsh".into(), "-f".into()],
        env: vec![("PROMPT".into(), "$ ".into()), ("PS1".into(), "$ ".into()), ("HISTFILE".into(), "/dev/null".into())],
    }
}

/// Options for a test run: no storage, no file watcher, fixed visuals.
pub fn test_options(project: Option<&Path>) -> AppOptions {
    AppOptions {
        project: project.map(Path::to_path_buf),
        restore_last_folder: false,
        watch_files: false,
        find_node_at_start: false,
        terminal: Some(test_terminal()),
        deterministic: true,
        ..AppOptions::default()
    }
}

/// An in-memory `eframe::Storage`, for the layout persistence round trip.
#[derive(Default)]
pub struct MemoryStorage {
    pub map: std::collections::HashMap<String, String>,
}

impl eframe::Storage for MemoryStorage {
    fn get_string(&self, key: &str) -> Option<String> {
        self.map.get(key).cloned()
    }
    fn set_string(&mut self, key: &str, value: String) {
        self.map.insert(key.to_string(), value);
    }
    fn flush(&mut self) {}
}

pub struct Ide {
    pub harness: Harness<'static, IdeApp>,
    suite: &'static str,
    pointer: Pos2,
    /// Current window size (`SIZE` unless a test called `resize`).
    size: Vec2,
    /// egui time of the last click; the next one waits so egui does not merge them into a
    /// double or triple click.
    last_click: f64,
}

impl Ide {
    /// Opens `project` and waits until the tree, the file index and git status are loaded.
    pub fn open(suite: &'static str, project: &Path) -> Ide {
        Ide::with_options(suite, test_options(Some(project)), None)
    }

    pub fn with_options(suite: &'static str, options: AppOptions, storage: Option<&dyn eframe::Storage>) -> Ide {
        init();
        let has_project = options.project.is_some();
        let harness = Harness::builder()
            .with_size(SIZE)
            .with_pixels_per_point(1.0)
            .with_step_dt(STEP_DT)
            .with_max_steps(100)
            .wgpu()
            .build_eframe(move |cc| IdeApp::create(&cc.egui_ctx, storage, options));
        let mut ide = Ide { harness, suite, pointer: Pos2::new(-10.0, -10.0), size: SIZE, last_click: f64::NEG_INFINITY };
        if has_project {
            ide.wait_for("project loaded", |s| {
                s.project.as_ref().is_some_and(|p| s.tree.is_loaded(&p.root)) && s.index.build_ms.is_some() && (s.git.repo.is_none() || s.git.status_ms.is_some())
            });
        }
        ide.settle();
        ide
    }

    /// Changes the window size, e.g. to test a narrow window. Snapshots use the new size.
    pub fn resize(&mut self, size: Vec2) {
        self.size = size;
        self.harness.set_size(size);
        self.settle();
    }

    pub fn state(&self) -> &AppState {
        &self.harness.state().state
    }

    pub fn state_mut(&mut self) -> &mut AppState {
        &mut self.harness.state_mut().state
    }

    pub fn ctx(&self) -> egui::Context {
        self.harness.ctx.clone()
    }

    pub fn root(&self) -> PathBuf {
        self.state().project.as_ref().expect("a project is open").root.clone()
    }

    /// One frame.
    pub fn step(&mut self) {
        self.harness.step();
    }

    pub fn steps(&mut self, n: usize) {
        for _ in 0..n {
            self.harness.step();
        }
    }

    fn repaint_delay(&self) -> Duration {
        self.harness.output().viewport_output.get(&egui::ViewportId::ROOT).map_or(Duration::MAX, |v| v.repaint_delay)
    }

    /// Steps frames until no background work is pending and egui wants no immediate repaint.
    pub fn settle(&mut self) {
        let start = Instant::now();
        let mut quiet = 0;
        loop {
            self.harness.step();
            if self.state().is_idle() {
                quiet += 1;
            } else {
                quiet = 0;
                std::thread::sleep(Duration::from_millis(2));
            }
            // Spinners repaint forever; after enough idle frames the UI is as settled as it gets.
            if quiet >= 3 && (self.repaint_delay() > Duration::ZERO || quiet >= 30) {
                return;
            }
            if start.elapsed() > SETTLE_TIMEOUT {
                let jobs: Vec<String> = self.state().jobs.running().into_iter().map(|j| j.label).collect();
                panic!("settle timed out: in flight {}, language queues {}, running {jobs:?}", self.state().jobs.in_flight(), self.state().langs.queued());
            }
        }
    }

    /// Steps frames (sleeping a little in between, so worker threads and child processes make
    /// progress) until `cond` holds. Panics with `what` after the timeout.
    pub fn wait_for(&mut self, what: &str, cond: impl Fn(&AppState) -> bool) {
        self.wait_until(what, |ide| cond(ide.state()));
    }

    /// Like `wait_for`, with access to the whole driver (accessibility tree, harness).
    pub fn wait_until(&mut self, what: &str, cond: impl Fn(&Ide) -> bool) {
        let start = Instant::now();
        loop {
            self.harness.step();
            if cond(self) {
                return;
            }
            if start.elapsed() > SETTLE_TIMEOUT {
                // The bodies carry the error text (a git stderr), which names the real cause.
                let notes: Vec<String> = self.state().notifications.log().iter().map(|n| format!("{}: {}", n.title, n.body)).collect();
                panic!("timed out waiting for: {what} (notifications: {notes:?})");
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// Steps frames for `d` of wall-clock time (for real-time debounces such as the 500 ms hover).
    pub fn wait_real(&mut self, d: Duration) {
        let start = Instant::now();
        while start.elapsed() < d {
            self.harness.step();
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    // ---------------------------------------------------------------------------------------
    // Keyboard

    fn push(&mut self, ev: Event) {
        self.harness.input_mut().events.push(ev);
    }

    /// Presses and releases `key` with `mods` held, one frame each.
    pub fn key_mods(&mut self, mods: Modifiers, key: Key) {
        self.harness.input_mut().modifiers = mods;
        self.push(Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers: mods });
        self.step();
        self.push(Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers: mods });
        self.step();
        self.harness.input_mut().modifiers = Modifiers::NONE;
        self.step();
    }

    pub fn key(&mut self, key: Key) {
        self.key_mods(Modifiers::NONE, key);
    }

    pub fn cmd(&mut self, key: Key) {
        self.key_mods(CMD, key);
    }

    pub fn cmd_shift(&mut self, key: Key) {
        self.key_mods(CMD_SHIFT, key);
    }

    /// Types `text` one character per event, like a keyboard. `\n` presses Enter.
    pub fn type_text(&mut self, text: &str) {
        for c in text.chars() {
            if c == '\n' {
                self.push(Event::Key { key: Key::Enter, physical_key: None, pressed: true, repeat: false, modifiers: Modifiers::NONE });
                self.push(Event::Key { key: Key::Enter, physical_key: None, pressed: false, repeat: false, modifiers: Modifiers::NONE });
            } else {
                self.push(Event::Text(c.to_string()));
            }
        }
        self.step();
    }

    /// Taps Shift twice with nothing in between (Search Everywhere).
    pub fn double_shift(&mut self) {
        for _ in 0..2 {
            self.harness.input_mut().modifiers = Modifiers::SHIFT;
            self.step();
            self.harness.input_mut().modifiers = Modifiers::NONE;
            self.step();
        }
    }

    // ---------------------------------------------------------------------------------------
    // Pointer

    pub fn move_to(&mut self, pos: Pos2) {
        self.pointer = pos;
        self.push(Event::PointerMoved(pos));
        self.step();
    }

    /// Moves the pointer to a spot with no widget (the `gap` right of the islands, above the
    /// status bar), so snapshots carry no hover highlight or tooltip.
    pub fn park_mouse(&mut self) {
        let p = Pos2::new(self.size.x - 6.0, self.size.y - 36.0);
        if self.pointer != p {
            self.move_to(p);
        }
    }

    fn time(&self) -> f64 {
        self.harness.ctx.input(|i| i.time)
    }

    /// Lets enough virtual time pass since the last click that the next one counts as new.
    fn click_gap(&mut self) {
        while self.time() - self.last_click < 0.7 {
            self.step();
        }
    }

    pub fn click_button_at(&mut self, pos: Pos2, button: PointerButton, mods: Modifiers) {
        self.click_gap();
        self.harness.input_mut().modifiers = mods;
        self.move_to(pos);
        self.push(Event::PointerButton { pos, button, pressed: true, modifiers: mods });
        self.step();
        self.push(Event::PointerButton { pos, button, pressed: false, modifiers: mods });
        self.step();
        self.last_click = self.time();
        self.harness.input_mut().modifiers = Modifiers::NONE;
        self.step();
    }

    pub fn click_at(&mut self, pos: Pos2) {
        self.click_button_at(pos, PointerButton::Primary, Modifiers::NONE);
    }

    pub fn right_click_at(&mut self, pos: Pos2) {
        self.click_button_at(pos, PointerButton::Secondary, Modifiers::NONE);
    }

    pub fn middle_click_at(&mut self, pos: Pos2) {
        self.click_button_at(pos, PointerButton::Middle, Modifiers::NONE);
    }

    /// Presses at `from`, moves to `to` in a few steps, releases there.
    pub fn drag(&mut self, from: Pos2, to: Pos2) {
        self.click_gap();
        self.move_to(from);
        self.push(Event::PointerButton { pos: from, button: PointerButton::Primary, pressed: true, modifiers: Modifiers::NONE });
        self.step();
        for i in 1..=4 {
            let p = from + (to - from) * (i as f32 / 4.0);
            self.move_to(p);
        }
        self.push(Event::PointerButton { pos: to, button: PointerButton::Primary, pressed: false, modifiers: Modifiers::NONE });
        self.step();
        self.last_click = self.time();
        self.step();
    }

    /// Holds `mods` and moves the pointer to `pos` (Cmd+hover). Call `release_modifiers` after.
    pub fn hover_with(&mut self, mods: Modifiers, pos: Pos2) {
        self.harness.input_mut().modifiers = mods;
        self.move_to(pos);
        self.step();
    }

    pub fn release_modifiers(&mut self) {
        self.harness.input_mut().modifiers = Modifiers::NONE;
        self.step();
    }

    /// The mouse cursor shape the app asked for in the last frame.
    pub fn cursor_icon(&self) -> egui::CursorIcon {
        self.harness.output().platform_output.cursor_icon
    }

    pub fn double_click_at(&mut self, pos: Pos2) {
        self.click_gap();
        self.move_to(pos);
        for _ in 0..2 {
            self.push(Event::PointerButton { pos, button: PointerButton::Primary, pressed: true, modifiers: Modifiers::NONE });
            self.step();
            self.push(Event::PointerButton { pos, button: PointerButton::Primary, pressed: false, modifiers: Modifiers::NONE });
            self.step();
        }
        self.last_click = self.time();
        self.step();
    }

    // ---------------------------------------------------------------------------------------
    // Accessibility tree

    /// The single node labelled `label`. Panics (with the tree) when there is none or several.
    pub fn node<'a>(&'a self, label: &'a str) -> Node<'a> {
        let mut all: Vec<Node<'_>> = self.harness.query_all_by_label(label).collect();
        match all.len() {
            1 => all.remove(0),
            0 => panic!("no widget labelled {label:?}; labels: {:?}", self.labels()),
            n => panic!("{n} widgets labelled {label:?}"),
        }
    }

    /// The first node whose label contains `text`.
    pub fn node_containing<'a>(&'a self, text: &'a str) -> Node<'a> {
        match self.harness.query_all_by_label_contains(text).next() {
            Some(n) => n,
            None => panic!("no widget label contains {text:?}; labels: {:?}", self.labels()),
        }
    }

    pub fn click_containing(&mut self, text: &str) {
        let r = self.node_containing(text).raw_bounds().expect("bounds");
        self.click_at(Pos2::new(((r.x0 + r.x1) / 2.0) as f32, ((r.y0 + r.y1) / 2.0) as f32));
    }

    pub fn has(&self, label: &str) -> bool {
        self.harness.query_all_by_label(label).next().is_some()
    }

    /// Every label and label-like value in the tree (for failure messages).
    pub fn labels(&self) -> Vec<String> {
        self.harness.query_all_by(|_| true).filter_map(|n| n.label().or_else(|| n.value()).map(|s| s.to_string())).filter(|s| !s.is_empty()).collect()
    }

    /// True when some widget's label or text contains `text`.
    pub fn shows_text(&self, text: &str) -> bool {
        self.harness.query_all_by(|n| n.label().is_some_and(|l| l.contains(text)) || n.value().is_some_and(|v| v.contains(text))).next().is_some()
    }

    pub fn assert_text(&self, text: &str) {
        assert!(self.shows_text(text), "expected {text:?} on screen; visible: {:?}", self.labels());
    }

    pub fn assert_no_text(&self, text: &str) {
        assert!(!self.shows_text(text), "expected no {text:?} on screen");
    }

    pub fn rect(&self, label: &str) -> Rect {
        let r = self.node(label).raw_bounds().unwrap_or_else(|| panic!("{label:?} has no bounds"));
        Rect::from_min_max(Pos2::new(r.x0 as f32, r.y0 as f32), Pos2::new(r.x1 as f32, r.y1 as f32))
    }

    /// Bounds of every widget labelled `label`, in tree order.
    pub fn rects(&self, label: &str) -> Vec<Rect> {
        self.harness
            .query_all_by_label(label)
            .filter_map(|n| n.raw_bounds())
            .map(|r| Rect::from_min_max(Pos2::new(r.x0 as f32, r.y0 as f32), Pos2::new(r.x1 as f32, r.y1 as f32)))
            .collect()
    }

    /// Bounds of every widget with `role` (e.g. text inputs, which have no label).
    pub fn role_rects(&self, role: egui::accesskit::Role) -> Vec<Rect> {
        self.harness
            .query_all_by_role(role)
            .filter_map(|n| n.raw_bounds())
            .map(|r| Rect::from_min_max(Pos2::new(r.x0 as f32, r.y0 as f32), Pos2::new(r.x1 as f32, r.y1 as f32)))
            .collect()
    }

    /// Clicks the `index`-th widget labelled `label` (for labels that repeat, like "x").
    pub fn click_nth(&mut self, label: &str, index: usize) {
        let rects = self.rects(label);
        let r = rects.get(index).unwrap_or_else(|| panic!("only {} widgets labelled {label:?}", rects.len()));
        self.click_at(r.center());
    }

    /// True when the widget labelled `label` has keyboard focus.
    pub fn is_focused(&self, label: &str) -> bool {
        self.node(label).is_focused()
    }

    pub fn is_selected(&self, label: &str) -> bool {
        self.node(label).toggled() == Some(egui::accesskit::Toggled::True)
    }

    /// Enabled state of the `index`-th widget labelled `label`.
    pub fn is_enabled_nth(&self, label: &str, index: usize) -> bool {
        let n = self.harness.query_all_by_label(label).nth(index).unwrap_or_else(|| panic!("no widget {index} labelled {label:?}"));
        !n.is_disabled()
    }

    pub fn is_enabled(&self, label: &str) -> bool {
        !self.node(label).is_disabled()
    }

    /// Clicks the center of the widget labelled `label` with a real pointer press and release.
    pub fn click(&mut self, label: &str) {
        let c = self.rect(label).center();
        self.click_at(c);
    }

    pub fn right_click(&mut self, label: &str) {
        let c = self.rect(label).center();
        self.right_click_at(c);
    }

    pub fn double_click(&mut self, label: &str) {
        let c = self.rect(label).center();
        self.double_click_at(c);
    }

    pub fn hover(&mut self, label: &str) {
        let c = self.rect(label).center();
        self.move_to(c);
    }

    // ---------------------------------------------------------------------------------------
    // Editor

    /// Geometry of the active editor, from the last frame.
    pub fn editor_geometry(&self) -> ide_editor::EditorGeometry {
        self.state().tabs.active_editor().and_then(|e| e.view.geometry()).expect("an editor is drawn")
    }

    /// A point just right of the left edge of a character cell: a click there puts the caret
    /// before that character (0-based line and column).
    pub fn caret_pos(&self, line: usize, column: usize) -> Pos2 {
        let g = self.editor_geometry();
        self.char_pos(line, column) - egui::vec2(g.char_w * 0.3, 0.0)
    }

    /// Screen position of the center of a character of the active editor (0-based).
    pub fn char_pos(&self, line: usize, column: usize) -> Pos2 {
        let e = self.state().tabs.active_editor().expect("active editor");
        e.view.geometry().expect("editor drawn").char_center(&e.doc, ide_editor::Position::new(line, column))
    }

    /// Caret of the active editor as (line, column), 0-based.
    pub fn cursor(&self) -> (usize, usize) {
        let c = self.state().tabs.active_editor().expect("active editor").view.cursor();
        (c.line, c.column)
    }

    pub fn selected_text(&self) -> String {
        let e = self.state().tabs.active_editor().expect("active editor");
        e.doc.slice(e.view.selection().range())
    }

    pub fn active_line(&self, line: usize) -> String {
        self.state().tabs.active_editor().expect("active editor").doc.line(line)
    }

    pub fn active_text(&self) -> String {
        self.state().tabs.active_editor().expect("active editor").doc.text()
    }

    pub fn active_title(&self) -> Option<String> {
        self.state().tabs.active_tab().map(|t| t.title())
    }

    pub fn tab_titles(&self) -> Vec<String> {
        self.state().tabs.list.iter().map(|t| t.title()).collect()
    }

    /// Opens `rel` (relative to the project root) and waits for its tab.
    pub fn open_file(&mut self, rel: &str) {
        let path = std::fs::canonicalize(self.root().join(rel)).expect("file exists");
        self.state_mut().open_location(&path, None, true);
        self.wait_for(&format!("tab for {rel}"), |s| s.tabs.active_editor().is_some_and(|e| e.path == path));
        self.settle();
    }

    /// Closes the toasts (they never time out in tests), e.g. before a snapshot of a dialog.
    pub fn dismiss_toasts(&mut self) {
        self.state_mut().notifications.dismiss_toasts();
        self.step();
    }

    // ---------------------------------------------------------------------------------------
    // Snapshots

    /// Label (or role) and bounds of every widget in the accessibility tree.
    fn layout_fingerprint(&self) -> Vec<(String, [f64; 4])> {
        self.harness
            .query_all_by(|_| true)
            .filter_map(|n| {
                let r = n.raw_bounds()?;
                let key = n.label().or_else(|| n.value()).map_or_else(|| format!("{:?}", n.role()), |s| s.to_string());
                Some((key, [r.x0, r.y0, r.x1, r.y1]))
            })
            .collect()
    }

    /// Fails when one more frame moves a widget. `settle` trusts egui's repaint request, and a
    /// layout that changes every frame without asking for a repaint (a panel that resizes to its
    /// own content) would make the snapshot depend on how many frames the waits took.
    fn assert_layout_still(&mut self, name: &str) {
        let before = self.layout_fingerprint();
        self.step();
        let after = self.layout_fingerprint();
        if before != after {
            let moved: Vec<_> = before.iter().zip(&after).filter(|(a, b)| a != b).take(5).collect();
            panic!("snapshot {name:?}: the layout still moves without a repaint request (first changes: {moved:?})");
        }
    }

    /// Parks the mouse, settles, renders and compares with `tests/snapshots/<suite>/<name>.png`.
    pub fn snapshot(&mut self, name: &str) {
        self.park_mouse();
        self.snapshot_here(name);
    }

    /// Like `snapshot`, but keeps the pointer where it is (hover effects are part of the shot).
    pub fn snapshot_here(&mut self, name: &str) {
        self.settle();
        self.steps(2);
        self.assert_layout_still(name);
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/snapshots").join(self.suite);
        let options = SnapshotOptions::new().output_path(&dir);
        match self.harness.try_snapshot_options(name, &options) {
            Ok(()) => {}
            Err(SnapshotError::Diff { diff, .. }) if diff <= MAX_DIFF_PIXELS => {
                // Within tolerance: the stored image stays, the noise is not worth a diff file.
                let _ = std::fs::remove_file(dir.join(format!("{name}.diff.png")));
            }
            Err(e) => panic!("{e}"),
        }
        // `.new.png` is only interesting when the snapshot failed.
        let _ = std::fs::remove_file(dir.join(format!("{name}.new.png")));
    }
}
