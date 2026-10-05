//! The eframe app: frame layout and input routing. Feature logic lives in the other modules.

use std::path::PathBuf;
use std::time::Instant;

use egui::{pos2, Align, Context, CornerRadius, FontId, Frame, Id, Key, Layout, Margin, Modifiers, Modal, Rect, RichText, Sense, UiBuilder, ViewportCommand};
use ide_editor::{EditorAction, EditorView};

use crate::layout::{self, ToolWindow};
use crate::nav::{self, NavKind};
use crate::state::{AppState, TabEnv};
use crate::tabs::{TabBarEvent, TabContent};
use crate::testhook::TestScript;
use crate::icons::{self, Icon};
use crate::memory::{MemorySource, ProcessSource, RealSource};
use crate::{breadcrumbs, chrome, find, git, search, testhook, theme, tree};

pub use crate::persist::{STORAGE_LAST_FOLDER, STORAGE_LAYOUT};

/// The shell a new terminal tab runs instead of the user's login shell.
#[derive(Clone, Debug, Default)]
pub struct TerminalCommand {
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// How the app starts. `main.rs` fills it from the command line; tests build it by hand.
pub struct AppOptions {
    /// Folder to open and activate, next to the restored ones.
    pub project: Option<PathBuf>,
    /// Reopen the projects of the last run (`persist.rs`).
    pub restore_last_folder: bool,
    /// File watching through `notify`. Tests turn it off: events arrive at OS-dependent times.
    pub watch_files: bool,
    /// Warm up `ide_ts::find_node` on a worker at startup.
    pub find_node_at_start: bool,
    /// Overrides the login shell for terminal tabs.
    pub terminal: Option<TerminalCommand>,
    /// For snapshot tests: toasts stay until dismissed, and durations ("12 ms", "3s ago") are
    /// not shown, so the same input always draws the same pixels.
    pub deterministic: bool,
    pub test: Option<TestScript>,
    /// The memory indicator's process source. `Auto` turns it off in deterministic mode.
    pub memory: MemorySource,
    /// Trash, Finder and the clipboard. `None` picks the system in a normal run and a
    /// recording stand-in in deterministic (test) mode, so tests never touch them.
    pub platform: Option<std::sync::Arc<dyn crate::fileops::Platform>>,
    /// Process start, for the timings log.
    pub start: Instant,
    /// The single-instance socket this process bound (`instance.rs`). `None` in tests.
    pub instance: Option<crate::instance::Server>,
    /// The SQLite file that keeps terminal tabs per project (`terminal_store.rs`). `None` (the
    /// default) keeps no tabs; tests that need it point it into their fixture folder.
    pub terminal_db: Option<PathBuf>,
}

impl Default for AppOptions {
    fn default() -> Self {
        AppOptions {
            project: None,
            restore_last_folder: true,
            watch_files: true,
            find_node_at_start: true,
            terminal: None,
            deterministic: false,
            test: None,
            memory: MemorySource::Auto,
            platform: None,
            start: Instant::now(),
            instance: None,
            terminal_db: None,
        }
    }
}

pub struct IdeApp {
    pub state: AppState,
    frames: u64,
}

impl IdeApp {
    pub fn new(state: AppState) -> IdeApp {
        IdeApp { state, frames: 0 }
    }

    /// Builds the app on `ctx`: theme, state, stored layout, and the project to open.
    /// `storage` is eframe's storage; tests pass `None` or an in-memory one.
    pub fn create(ctx: &Context, storage: Option<&dyn eframe::Storage>, options: AppOptions) -> IdeApp {
        theme::apply(ctx);
        // Tests take the macOS default instead of the machine's setting, through the same path.
        let interval = if options.deterministic { Some(chrome::DEFAULT_DOUBLE_CLICK_INTERVAL) } else { chrome::system_double_click_interval() };
        if let Some(interval) = interval {
            ctx.options_mut(|o| o.input_options.max_double_click_delay = interval);
        }
        let mut state = AppState::new(ctx.clone(), options.start);
        state.timings.quiet = options.deterministic;
        state.timings.log("window created");
        state.test = options.test;
        state.watch_files = options.watch_files;
        state.terminal_command = options.terminal.clone();
        state.ws.terminals.command = options.terminal;
        state.terminal_store = options.terminal_db.map(crate::terminal_store::TerminalStore::new);
        state.platform = match options.platform {
            Some(p) => p,
            None if options.deterministic => std::sync::Arc::new(crate::fileops::RecordingPlatform::new(std::env::temp_dir().join("harwex-ide-test-trash"))),
            None => std::sync::Arc::new(crate::fileops::SystemPlatform),
        };
        if !options.deterministic {
            state.input_log = crate::inputlog::InputLog::from_env();
            if let Some(log) = &state.input_log {
                log.note(format!("max_double_click_delay {:.3}", ctx.options(|o| o.input_options.max_double_click_delay)));
            }
        }
        if options.deterministic {
            state.deterministic = true;
            state.notifications.frozen = true;
        }
        let source: Option<std::sync::Arc<dyn ProcessSource>> = match options.memory {
            MemorySource::Auto if options.deterministic => None,
            MemorySource::Auto | MemorySource::Real => RealSource::new().map(|r| std::sync::Arc::new(r) as _),
            MemorySource::Off => None,
            MemorySource::Custom(s) => Some(s),
        };
        if let Some(source) = source {
            state.memory.start(source, state.jobs.window());
        }
        if options.find_node_at_start {
            // Warms ide-ts's node lookup (a login-shell probe can take ~0.5 s) before the
            // first navigation request needs it.
            state.jobs.window().spawn_quiet(ide_ts::find_node, |state, node| match node {
                Some(n) => state.timings.log(format!("node: {}", n.display())),
                None => state.notifications.warn("node not found", "TypeScript navigation needs node on PATH, in nvm or in /opt/homebrew/bin."),
            });
        }
        let mut restore = crate::persist::Restore::default();
        if let Some(storage) = storage {
            git::load_storage(&mut state, storage);
            find::load_storage(&mut state, storage);
            restore = crate::persist::load(&mut state, storage);
        }
        if options.restore_last_folder {
            let mut active = None;
            for root in restore.roots {
                let id = state.open_workspace(root.clone());
                if restore.active.as_ref() == Some(&root) {
                    active = Some(id);
                }
            }
            if let Some(id) = active {
                state.activate(id);
            }
        }
        if let Some(folder) = options.project {
            state.open_workspace(folder);
        }
        if let Some(server) = options.instance {
            // A background or test window never pulls itself to the front.
            let focus = !options.deterministic && std::env::var_os("HARWEX_IDE_BACKGROUND").is_none_or(|v| v != "1");
            server.serve(state.jobs.window(), focus);
        }
        IdeApp::new(state)
    }
}

impl eframe::App for IdeApp {
    fn update(&mut self, ctx: &Context, frame: &mut eframe::Frame) {
        let s = &mut self.state;
        if let Some(log) = s.input_log.as_mut() {
            log.begin(ctx);
        }
        s.clicks.begin_frame(ctx);
        self.frames += 1;
        if self.frames == 1 {
            s.timings.log("first frame (update called)");
        } else if self.frames == 2 {
            s.timings.log("second frame (first frame presented)");
        }
        s.drain_inbox();
        shortcuts(s, ctx);
        chrome::sync(ctx, frame, s.test.as_mut().and_then(|t| t.chrome.as_mut()));

        title_bar(s, ctx);
        // Right under the title bar while a merge/rebase/cherry-pick/revert is in progress.
        git::conflicts::banner(s, ctx);
        status_bar(s, ctx);
        let t = &theme::T;
        let unread = s.notifications.unread;
        let (terminals, changes) = (s.ws.terminals.len(), s.ws.git.changes.len());
        let badge = |w: ToolWindow| match w {
            ToolWindow::Notifications if unread > 0 => layout::StripBadge::Dot,
            ToolWindow::Terminal => layout::StripBadge::Count(terminals),
            ToolWindow::Commit => layout::StripBadge::Count(changes),
            _ => layout::StripBadge::None,
        };
        let window = Frame::NONE.fill(t.window_bg);
        egui::SidePanel::left("left-strip").exact_width(t.space.strip_w).resizable(false).show_separator_line(false).frame(window).show(ctx, |ui| {
            layout::left_strip(ui, &mut s.ws.layout, badge);
        });
        // Islands: each tool window and the editor sit on the window background as a rounded
        // surface. Half a gap on each inner edge makes one gap between neighbours. No strip
        // sits on the right, so the islands keep a full gap to the right window edge.
        let half = (t.space.gap / 2.0) as i8;
        let gap = t.space.gap as i8;
        let (has_left, has_bottom) = (s.ws.layout.left.is_some(), s.ws.layout.bottom.is_some());
        if let Some(w) = s.ws.layout.bottom {
            egui::TopBottomPanel::bottom(crate::workspace::wid("bottom-tool-window"))
                .default_height(240.0)
                .height_range(80.0..=900.0)
                .resizable(true)
                .show_separator_line(false)
                .frame(window.inner_margin(Margin { top: half, right: gap, ..Margin::ZERO }))
                .show(ctx, |ui| tool_window(s, ui, w));
        }
        if let Some(w) = s.ws.layout.left {
            egui::SidePanel::left(crate::workspace::wid("left-tool-window"))
                .default_width(300.0)
                .width_range(160.0..=900.0)
                .show_separator_line(false)
                .frame(window.inner_margin(Margin { right: half, bottom: if has_bottom { half } else { 0 }, ..Margin::ZERO }))
                .show(ctx, |ui| tool_window(s, ui, w));
        }
        let editor_margin = Margin { left: if has_left { half } else { 0 }, right: gap, bottom: if has_bottom { half } else { 0 }, ..Margin::ZERO };
        egui::CentralPanel::default().frame(window.inner_margin(editor_margin)).show(ctx, |ui| {
            // The central panel's id is egui's own; the salt keeps the editor's ids per project.
            ui.push_id(crate::workspace::salt(), |ui| {
                layout::island(t.space.editor_pad).show(ui, |ui| {
                    ui.set_min_size(ui.available_size());
                    editor_area(s, ui);
                });
            });
        });
        open_dropped_files(s, ctx);

        if let Some(path) = search::show(s, ctx) {
            s.open_location(&path, None, true);
        }
        find::show_dialog(s, ctx);
        crate::tree_menu::show_dialogs(s, ctx);
        nav::show_popup(s, ctx);
        breadcrumbs::show_popup(s, ctx);
        crate::projects_popup::show(s, ctx);
        confirm_close(s, ctx);
        confirm_close_workspace(s, ctx);
        git::show_windows(s, ctx);
        s.notifications.show_toasts(ctx, 48.0);
        crate::util::close_orphaned_context_menu(ctx);

        s.tick_workspaces();
        testhook::tick(s);
        if !s.jobs.running().is_empty() {
            // Keeps the spinner turning; ~10 fps is enough and costs nothing measurable.
            ctx.request_repaint_after(std::time::Duration::from_millis(100));
        }
        if let Some(log) = s.input_log.as_mut() {
            log.end();
        }
    }

    fn raw_input_hook(&mut self, _ctx: &Context, raw_input: &mut egui::RawInput) {
        crate::testhook::tree_hits::inject(&mut self.state, raw_input);
        if let Some(log) = self.state.input_log.as_mut() {
            log.raw(raw_input);
        }
    }

    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        crate::persist::save(&mut self.state, storage);
        git::save_storage(&self.state, storage);
        find::save_storage(&self.state, storage);
        // Terminal tabs live in their own database; this refreshes the shells' directories.
        crate::terminal::save_all(&mut self.state);
    }

    fn on_exit(&mut self) {
        // Before the shells die: their working directories are read now.
        crate::terminal::flush_on_exit(&mut self.state);
        self.state.shutdown_all();
    }
}

fn shortcuts(s: &mut AppState, ctx: &Context) {
    nav::take_popup_keys(s, ctx);
    find::take_keys(s, ctx);
    crate::projects_popup::take_keys(s, ctx);
    breadcrumbs::take_keys(s, ctx);
    // A focused terminal gets every key except Alt+F12 and Escape.
    if crate::terminal::shortcuts(s, ctx) {
        return;
    }
    breadcrumbs::shortcut(s, ctx);
    let cmd_shift = Modifiers::COMMAND | Modifiers::SHIFT;
    // Most specific first: consume_key ignores extra Shift. ⇧⌘R (Replace in Files) is taken
    // here, before the editor's ⌘R.
    let mut replace_r = false;
    let (search_o, find_f, save_all, save, close, back, fwd, back_alt, fwd_alt) = ctx.input_mut(|i| {
        (
            i.consume_key(cmd_shift, Key::O),
            i.consume_key(cmd_shift, Key::F) || {
                replace_r = i.consume_key(cmd_shift, Key::R);
                replace_r
            },
            i.consume_key(Modifiers::COMMAND | Modifiers::ALT, Key::S),
            i.consume_key(Modifiers::COMMAND, Key::S),
            i.consume_key(Modifiers::COMMAND, Key::W),
            i.consume_key(Modifiers::COMMAND, Key::OpenBracket),
            i.consume_key(Modifiers::COMMAND, Key::CloseBracket),
            i.consume_key(Modifiers::COMMAND | Modifiers::ALT, Key::ArrowLeft),
            i.consume_key(Modifiers::COMMAND | Modifiers::ALT, Key::ArrowRight),
        )
    });
    let (push_k, update_t, recent_e) = ctx.input_mut(|i| (i.consume_key(cmd_shift, Key::K), i.consume_key(Modifiers::COMMAND, Key::T), i.consume_key(Modifiers::COMMAND, Key::E)));
    // IDEA's "Branches..." (Ctrl+Shift+`) and "Select In > Project View" (Alt+F1).
    let ctrl_shift = Modifiers::CTRL | Modifiers::SHIFT;
    let (branches, select_in) = ctx.input_mut(|i| (i.consume_key(ctrl_shift, Key::Backtick), i.consume_key(Modifiers::ALT, Key::F1)));
    // Shift+F2 first: `consume_key(NONE, F2)` ignores an extra Shift.
    let (prev_problem, next_problem) = ctx.input_mut(|i| (i.consume_key(Modifiers::SHIFT, Key::F2), i.consume_key(Modifiers::NONE, Key::F2)));
    if prev_problem || next_problem {
        crate::diagnostics::goto_next(s, next_problem);
    }
    editor_find_keys(s, ctx);
    if select_in {
        tree::select_opened_file(s);
    }
    if recent_e && s.ws.project.is_some() {
        s.ws.search.open_recent();
    }
    if s.ws.git.repo.is_some() {
        if branches {
            let anchor = s.ws.git_ui.branches_anchor.unwrap_or(pos2(chrome::current(ctx).content_x, theme::T.space.title_h));
            git::open_branches_popup(s, anchor);
        }
        if push_k {
            git::push_clicked(s);
        }
        if update_t {
            git::update_project_clicked(s);
        }
    }
    let double_shift = s.ws.search.detect_double_shift(ctx);
    if (search_o || double_shift) && s.ws.project.is_some() {
        s.ws.search.open();
    }
    if find_f && s.ws.project.is_some() {
        // From the Project tree, Find and Replace in Files search the selected folder.
        if tree::has_focus(ctx) {
            let dir = s.ws.tree.selected_dir();
            s.ws.find.open_scoped(dir, replace_r);
        } else {
            let selected = s.ws.tabs.active_editor().map(|e| e.doc.slice(e.view.selection().range()));
            s.ws.find.open_scoped(None, replace_r);
            s.ws.find.open_dialog(selected);
        }
    }
    if save_all {
        s.save_all();
    } else if save {
        if let Some(id) = s.ws.tabs.active {
            s.save_tab(id, false);
        }
    }
    if close {
        if let Some(id) = s.ws.tabs.active {
            s.close_tab(id, false);
        }
    }
    if back || back_alt {
        nav::go_back(s);
    }
    if fwd || fwd_alt {
        nav::go_forward(s);
    }
}

/// The editor's find bar: Cmd+F, Cmd+R, Cmd+G, Shift+Cmd+G and Ctrl+Cmd+G (Select All
/// Occurrences). They act on the active editor while it or its bar has the focus (or nothing
/// has), never on another text field.
fn editor_find_keys(s: &mut AppState, ctx: &Context) {
    let ctrl_cmd = Modifiers::COMMAND | Modifiers::CTRL;
    let cmd_shift = Modifiers::COMMAND | Modifiers::SHIFT;
    let Some(e) = s.ws.tabs.active_editor_mut() else { return };
    let free = ctx.memory(|m| m.focused()).is_none() || e.view.owns_focus(ctx);
    if !free {
        return;
    }
    let (select_all, prev, next, replace, find) = ctx.input_mut(|i| {
        (
            i.consume_key(ctrl_cmd, Key::G),
            i.consume_key(cmd_shift, Key::G),
            i.consume_key(Modifiers::COMMAND, Key::G),
            i.consume_key(Modifiers::COMMAND, Key::R),
            i.consume_key(Modifiers::COMMAND, Key::F),
        )
    });
    if find || replace {
        e.view.open_find(&e.doc, replace);
    }
    if next {
        e.view.find_next();
    }
    if prev {
        e.view.find_previous();
    }
    if select_all {
        e.view.select_all_occurrences(&mut e.doc);
    }
}

/// The title bar, merged with the window chrome like IDEA's New UI: the macOS window buttons,
/// vertically centered (`chrome`), and a group of the project widget (badge, name), Settings and
/// the current branch, centered on the window (`title_group_place`). A soft tint of the badge
/// color runs across it from the left.
fn title_bar(s: &mut AppState, ctx: &Context) {
    let t = &theme::T;
    egui::TopBottomPanel::top("title-bar").exact_height(t.space.title_h).show_separator_line(false).frame(Frame::NONE.fill(t.window_bg)).show(ctx, |ui| {
        let full = ui.max_rect();
        let name = s.ws.project.as_ref().map(|p| p.name.clone());
        let badge = name.as_deref().map(|n| t.badge_color(n));
        if let Some(color) = badge {
            paint_tint(ui.painter(), full, color);
        }
        // The empty part of the bar moves the window; a double click zooms it.
        let drag = ui.interact(full, Id::new("title-bar-drag"), Sense::click_and_drag());
        if drag.drag_started() {
            ctx.send_viewport_cmd(ViewportCommand::StartDrag);
        }
        if s.clicks.double(&drag) {
            // Tests do not depend on the user's macOS setting.
            let action = if s.deterministic { chrome::DoubleClick::Zoom } else { chrome::system_double_click() };
            match action {
                chrome::DoubleClick::Zoom => {
                    let maximized = ctx.input(|i| i.viewport().maximized.unwrap_or(false));
                    ctx.send_viewport_cmd(ViewportCommand::Maximized(!maximized));
                }
                chrome::DoubleClick::Minimize => ctx.send_viewport_cmd(ViewportCommand::Minimized(true)),
                chrome::DoubleClick::Nothing => {}
            }
        }
        let has_branch = s.ws.git.repo.is_some();
        let branch_label = has_branch.then(|| {
            let branch = s.ws.git.branch.clone().unwrap_or_else(|| "...".into());
            if s.ws.git.detached {
                format!("detached: {branch}")
            } else {
                branch
            }
        });
        let project_text = name.as_deref().unwrap_or("Open Folder...").to_string();
        let project_badge = name.as_deref().map(|n| (initials(n), badge.unwrap_or(t.accent)));
        let measure = |text: &str, font: egui::FontId| ui.painter().layout_no_wrap(text.to_string(), font, t.text).size().x;
        let project_text_w = measure(&project_text, t.semibold(t.font.ui));
        let branch_text_w = branch_label.as_deref().map_or(0.0, |b| measure(b, t.ui_font()));
        let place = title_group_place(
            full.min.x..full.max.x,
            full.min.x + chrome::current(ctx).content_x,
            TitleGroup { project_fixed: title_widget_fixed_w(project_badge.is_some()), project_text: project_text_w, settings: t.space.strip_button - 4.0, branch_fixed: has_branch.then_some(BRANCH_FIXED_W), branch_text: branch_text_w },
        );
        let mut row = ui.new_child(UiBuilder::new().max_rect(full.shrink2(egui::vec2(0.0, 6.0))).layout(Layout::left_to_right(Align::Center)));
        row.add_space(place.x - full.min.x);
        row.spacing_mut().item_spacing.x = 0.0;
        let open_projects = s.all_ws().count();
        let project = title_widget(&mut row, project_badge, &project_text, place.project_text, &format!("Project {}", name.as_deref().unwrap_or("")), s.projects.open, open_projects);
        crate::projects_popup::on_widget(s, &row, &project);
        row.add_space(TITLE_GAP);
        let settings = layout::icon_button(&mut row, Icon::Settings, "Settings", "Settings");
        settings_menu(s, &row, &settings);
        // The branch is display-only. The branches popup opens with Ctrl+Shift+` and drops
        // down from here.
        if let Some(label) = branch_label {
            row.add_space(TITLE_GAP);
            let r = branch_widget(&mut row, &label, place.branch_text);
            s.ws.git_ui.branches_anchor = Some(r.rect.left_bottom() + egui::vec2(0.0, 4.0));
        }
    });
}

/// The badge color fading out to the right across the title bar.
fn paint_tint(painter: &egui::Painter, rect: Rect, color: egui::Color32) {
    let t = &theme::T;
    let strong = color.gamma_multiply(t.title_tint_alpha as f32 / 255.0);
    let mid = egui::pos2(rect.min.x + rect.width() * 0.45, rect.max.y);
    let mut mesh = egui::Mesh::default();
    mesh.colored_vertex(rect.left_top(), strong);
    mesh.colored_vertex(egui::pos2(mid.x, rect.min.y), t.clear);
    mesh.colored_vertex(mid, t.clear);
    mesh.colored_vertex(rect.left_bottom(), strong);
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(0, 2, 3);
    painter.add(egui::Shape::mesh(mesh));
}

/// "harwex-mono" -> "HM", "ide" -> "ID".
pub fn initials(name: &str) -> String {
    let parts: Vec<&str> = name.split(|c: char| !c.is_alphanumeric()).filter(|p| !p.is_empty()).collect();
    let mut out: String = match parts.as_slice() {
        [] => String::new(),
        [one] => one.chars().take(2).collect(),
        [a, b, ..] => a.chars().take(1).chain(b.chars().take(1)).collect(),
    };
    out.make_ascii_uppercase();
    out.to_uppercase()
}

/// The space between the project widget, Settings and the branch.
const TITLE_GAP: f32 = 6.0;
/// The branch widget without its text: padding, icon, gap, padding.
const BRANCH_FIXED_W: f32 = 8.0 + 16.0 + 6.0 + 8.0;
/// A name never truncates below this width.
const TITLE_TEXT_MIN_W: f32 = 24.0;

/// The project widget without its text: padding, badge, chevron.
fn title_widget_fixed_w(badge: bool) -> f32 {
    let badge_w = if badge { 20.0 + 8.0 } else { 0.0 };
    8.0 + badge_w + 6.0 + 12.0 + 8.0
}

/// The widths of the title bar group: the project widget, Settings and the optional branch.
#[derive(Clone, Copy, Debug)]
pub struct TitleGroup {
    pub project_fixed: f32,
    pub project_text: f32,
    pub settings: f32,
    pub branch_fixed: Option<f32>,
    pub branch_text: f32,
}

/// Where the title bar group goes: its left x and the text widths after truncation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TitlePlace {
    pub x: f32,
    pub project_text: f32,
    pub branch_text: f32,
}

/// Centers the group on the window width (`bar`). A narrow window moves the group right until it
/// starts at `content_x` (after the macOS buttons). When the group still does not fit before the
/// right padding, the longer name truncates first, then both.
pub fn title_group_place(bar: std::ops::Range<f32>, content_x: f32, g: TitleGroup) -> TitlePlace {
    let right = bar.end - theme::T.space.title_pad;
    let fixed = g.project_fixed + TITLE_GAP + g.settings + g.branch_fixed.map_or(0.0, |b| TITLE_GAP + b);
    let branch_text = if g.branch_fixed.is_some() { g.branch_text } else { 0.0 };
    let (mut project_text, mut branch_text) = (g.project_text, branch_text);
    let room = (right - content_x - fixed).max(0.0);
    if project_text + branch_text > room {
        if g.branch_fixed.is_none() {
            project_text = room;
        } else {
            let half = room / 2.0;
            if project_text <= half {
                branch_text = room - project_text;
            } else if branch_text <= half {
                project_text = room - branch_text;
            } else {
                project_text = half;
                branch_text = half;
            }
        }
        project_text = project_text.max(TITLE_TEXT_MIN_W.min(g.project_text));
        branch_text = branch_text.max(TITLE_TEXT_MIN_W.min(g.branch_text));
    }
    let width = fixed + project_text + branch_text;
    let center = (bar.start + bar.end) / 2.0;
    let x = (center - width / 2.0).max(content_x).round();
    TitlePlace { x, project_text, branch_text }
}

/// One line of `text`, cut with `…` to `max_w`.
fn title_galley(ui: &egui::Ui, text: &str, font: egui::FontId, max_w: f32) -> std::sync::Arc<egui::Galley> {
    let t = &theme::T;
    let mut job = egui::text::LayoutJob::simple_singleline(text.to_string(), font, t.text);
    job.wrap = egui::text::TextWrapping::truncate_at_width(max_w.ceil());
    ui.painter().layout_job(job)
}

/// A title bar widget: an optional badge, a text and a dropdown chevron, with a hover fill.
/// `text_w`: the room for the text, which truncates with `…` beyond it. `open`: its popup is
/// open, so it keeps the hover fill. `projects`: the open projects; a count badge on the
/// initials shows it above 1.
fn title_widget(ui: &mut egui::Ui, badge: Option<(String, egui::Color32)>, text: &str, text_w: f32, label: &str, open: bool, projects: usize) -> egui::Response {
    let t = &theme::T;
    let galley = title_galley(ui, text, t.semibold(t.font.ui), text_w);
    let badge_w = if badge.is_some() { 20.0 + 8.0 } else { 0.0 };
    let size = egui::vec2(title_widget_fixed_w(badge.is_some()) + text_w, t.space.title_h - 12.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    crate::util::label_widget(&resp, egui::WidgetType::Button, label);
    let painter = ui.painter();
    let hovered = resp.hovered() || open;
    if hovered {
        painter.rect_filled(rect, t.radius.button, t.hover_on_window);
    }
    let mut x = rect.min.x + 8.0;
    if let Some((initials, color)) = badge {
        let b = Rect::from_min_size(egui::pos2(x, rect.center().y - 10.0), egui::vec2(20.0, 20.0));
        painter.rect_filled(b, t.radius.badge, color);
        painter.text(b.center(), egui::Align2::CENTER_CENTER, initials, t.semibold(t.font.badge), t.badge_text);
        if projects > 1 {
            // The tint under the bar is faint; the plain bar color makes a clean enough ring.
            let ring = if hovered { t.hover_on_window } else { t.window_bg };
            crate::badge::show(ui, Id::new("title-projects-badge"), b.right_top() + egui::vec2(-1.0, 1.0), projects, ring, format!("{projects} open projects"));
        }
        x += badge_w;
    }
    painter.galley(egui::pos2(x, rect.center().y - galley.size().y / 2.0), galley.clone(), t.text);
    x = rect.max.x - 8.0 - 12.0;
    icons::paint(painter, Rect::from_center_size(egui::pos2(x + 6.0, rect.center().y + 1.0), egui::vec2(12.0, 12.0)), Icon::ChevronDown, t.text_dim);
    resp
}

/// The current branch: an icon and the name. It takes no clicks.
fn branch_widget(ui: &mut egui::Ui, branch: &str, text_w: f32) -> egui::Response {
    let t = &theme::T;
    let galley = title_galley(ui, branch, t.ui_font(), text_w);
    let size = egui::vec2(BRANCH_FIXED_W + text_w, t.space.title_h - 12.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::hover());
    crate::util::label_widget(&resp, egui::WidgetType::Label, format!("Branch {branch}"));
    let painter = ui.painter();
    let mut x = rect.min.x + 8.0;
    icons::paint(painter, Rect::from_min_size(egui::pos2(x, rect.center().y - 8.0), egui::vec2(16.0, 16.0)), Icon::Branch, t.icon);
    x += 22.0;
    painter.galley(egui::pos2(x, rect.center().y - galley.size().y / 2.0), galley, t.text);
    resp
}

fn settings_menu(s: &mut AppState, ui: &egui::Ui, button: &egui::Response) {
    let popup_id = Id::new("settings-menu");
    if button.clicked() {
        ui.memory_mut(|m| m.toggle_popup(popup_id));
    }
    egui::popup_below_widget(ui, popup_id, button, egui::PopupCloseBehavior::CloseOnClickOutside, |ui| {
        ui.set_min_width(220.0);
        let close = |ui: &egui::Ui| ui.memory_mut(|m| m.close_popup());
        if ui.add(egui::Button::new("Open Folder...")).clicked() {
            close(ui);
            s.pick_folder();
        }
        let config = s.ws.project.as_ref().map(|p| p.root.join(".harwex/ide.toml"));
        if ui.add_enabled(config.is_some(), egui::Button::new("Project Settings (.harwex/ide.toml)")).clicked() {
            close(ui);
            if let Some(path) = config {
                s.open_location(&path, None, true);
            }
        }
        ui.separator();
        if ui.add(egui::Button::new("Notifications")).clicked() {
            close(ui);
            s.ws.layout.show(ToolWindow::Notifications);
        }
    });
}

fn status_bar(s: &mut AppState, ctx: &Context) {
    let t = &theme::T;
    let panel = egui::TopBottomPanel::bottom("status-bar").exact_height(t.space.status_h).show_separator_line(false).frame(Frame::NONE.fill(t.window_bg).inner_margin(Margin::symmetric(10, 2))).show(ctx, |ui| {
        let full = ui.max_rect();
        // The right part goes first: the breadcrumbs get the width that is left.
        let right = ui
            .scope_builder(UiBuilder::new().max_rect(full).layout(Layout::right_to_left(Align::Center)), |ui| {
                ui.spacing_mut().item_spacing.x = 14.0;
                status_right(s, ui);
            })
            .response
            .rect;
        let left = Rect::from_min_max(full.min, pos2((right.min.x - 16.0).max(full.min.x), full.max.y));
        ui.scope_builder(UiBuilder::new().max_rect(left).layout(Layout::left_to_right(Align::Center)).id_salt(crate::workspace::salt()), |ui| {
            ui.set_clip_rect(left);
            breadcrumbs::bar(s, ui);
            if let Some(note) = s.notifications.log().last() {
                if note.time.elapsed().as_secs() < 60 && ui.available_width() > 60.0 {
                    if !s.ws.breadcrumbs.slots.is_empty() {
                        ui.add_space(12.0);
                    }
                    ui.add(egui::Label::new(RichText::new(&note.title).size(t.font.small).color(t.text_dim)).truncate());
                }
            }
        });
    });
    // The breadcrumb popups rest on the top edge of the status bar.
    s.ws.breadcrumbs.baseline = Some(panel.response.rect.min.y);
}

fn status_right(s: &mut AppState, ui: &mut egui::Ui) {
    let t = &theme::T;
    let running = s.jobs.running();
    // A narrow window keeps its room for the breadcrumbs.
    let wide = ui.available_width() >= 800.0;
    let item = |ui: &mut egui::Ui, text: &str, color: egui::Color32| {
        ui.label(RichText::new(text).size(t.font.small).color(color));
    };
    // Right to left: the memory indicator sits in the bottom right corner.
    // The branch lives in the title bar; the caret position is not shown. The language stays:
    // it tells whether the IDE understands the file or treats it as plain text.
    crate::memory::status_widget(s, ui);
    if let Some(tab) = s.ws.tabs.active_tab() {
        match &tab.content {
            TabContent::Editor(e) => {
                item(ui, e.doc.language().name(), t.text);
                if let Some(backend) = e.lang.and_then(|l| s.ws.langs.status(l, &e.path)).filter(|_| wide) {
                    item(ui, &backend, t.text_dim);
                }
                if e.read_only {
                    item(ui, "read-only", t.warning);
                }
            }
            TabContent::Custom(_) => {}
        }
    }
    if !running.is_empty() {
        let label = running
            .iter()
            .map(|j| match j.started.elapsed().as_secs() {
                0 => j.label.clone(),
                n => format!("{} ({n}s)", j.label),
            })
            .collect::<Vec<_>>()
            .join(", ");
        ui.spacing_mut().item_spacing.x = 6.0;
        item(ui, &label, t.text_dim);
        ui.add(egui::Spinner::new().size(theme::T.font.small));
    }
}

/// A tool window island: the header with the title and the hide button, then the body.
fn tool_window(s: &mut AppState, ui: &mut egui::Ui, w: ToolWindow) {
    let t = &theme::T;
    layout::island(0.0).inner_margin(Margin { left: t.space.island_pad as i8, right: t.space.island_pad as i8, top: 0, bottom: t.space.island_pad as i8 / 2 }).show(ui, |ui| {
        ui.set_min_size(ui.available_size());
        let mut locate = false;
        let can_locate = w == ToolWindow::Project && breadcrumbs::active_file(s).is_some();
        let extra = |ui: &mut egui::Ui| match w {
            ToolWindow::Project => {
                let (r, _) = ui.allocate_exact_size(egui::vec2(12.0, 12.0), Sense::hover());
                icons::paint(ui.painter(), r, Icon::ChevronDown, t.text_dim);
            }
            ToolWindow::Terminal => crate::terminal::header_tabs(s, ui),
            ToolWindow::Git => git::log_header(s, ui),
            ToolWindow::Find => crate::find_window::header_tabs(s, ui),
            _ => {}
        };
        let actions = |ui: &mut egui::Ui| {
            if w == ToolWindow::Project {
                locate = layout::icon_button_enabled(ui, can_locate, Icon::Locate, "Select Opened File", "Select Opened File (⌥F1)").clicked();
            }
        };
        let hide = layout::header_with_actions(ui, w.title(), extra, actions);
        if locate {
            tree::select_opened_file(s);
        }
        if hide {
            match w.side() {
                layout::Side::Left => s.ws.layout.left = None,
                layout::Side::Bottom => s.ws.layout.bottom = None,
            }
            return;
        }
        // The header can hide its own window (closing the last terminal tab does). The body
        // must not run then: the Terminal body would start a new shell in the hidden window.
        if s.ws.layout.left != Some(w) && s.ws.layout.bottom != Some(w) {
            return;
        }
        tool_window_body(s, ui, w);
    });
}

fn open_dropped_files(s: &mut AppState, ctx: &Context) {
    let dropped: Vec<PathBuf> = ctx.input(|i| i.raw.dropped_files.iter().filter_map(|f| f.path.clone()).collect());
    if s.ws.project.is_none() {
        return;
    }
    for path in dropped {
        s.open_location(&path, None, true);
    }
}

fn tool_window_body(s: &mut AppState, ui: &mut egui::Ui, w: ToolWindow) {
    match w {
        ToolWindow::Project => {
            if let Some(tree::TreeEvent::Open(p)) = tree::show(s, ui) {
                s.open_location(&p, None, true);
            }
        }
        ToolWindow::Commit => git::commit_tool_window(s, ui),
        ToolWindow::Find => crate::find_window::show(s, ui),
        ToolWindow::Git => git::log_tool_window(s, ui),
        ToolWindow::Problems => crate::diagnostics::problems::tool_window(s, ui),
        ToolWindow::Terminal => crate::terminal::tool_window(s, ui),
        ToolWindow::Notifications => s.notifications.show_log(ui),
    }
}

fn editor_area(s: &mut AppState, ui: &mut egui::Ui) {
    if s.ws.project.is_none() {
        welcome(s, ui);
        return;
    }
    if !s.ws.tabs.list.is_empty() {
        match s.ws.tabs.show_bar(ui) {
            Some(TabBarEvent::Activate(id)) => {
                s.ws.tabs.activate(id);
                if let Some(e) = s.ws.tabs.editor_mut(id) {
                    e.view.request_focus();
                }
            }
            Some(TabBarEvent::Close(id)) => s.close_tab(id, false),
            None => {}
        }
    }
    let Some(active) = s.ws.tabs.active else {
        empty_editor_hints(ui);
        return;
    };

    let AppState { ws, jobs, notifications, editor_theme, .. } = &mut *s;
    let crate::workspace::Workspace { tabs, project, git: git_info, commands, .. } = ws;
    let Some(tab) = tabs.get_mut(active) else { return };
    let out = match &mut tab.content {
        TabContent::Editor(e) => {
            e.problems.refresh(&e.doc);
            let r = EditorView::new(&mut e.doc, &mut e.view)
                .problems(&e.problems.marks)
                .gutter_marks(&e.marks)
                .annotations(&e.annotations)
                .theme(editor_theme)
                .read_only(e.read_only)
                .show(ui);
            if r.changed {
                e.last_edit = Instant::now();
                e.problems.refresh(&e.doc);
            }
            let next_problem = crate::diagnostics::problems::counts_widget(ui, e.view.geometry().map_or(r.response.rect, |g| g.text_rect), e);
            let hover_problems = r.hover.map(|p| crate::diagnostics::hover_lines(e, p)).unwrap_or_default();
            Some((r, next_problem, hover_problems))
        }
        TabContent::Custom(c) => {
            let mut env = TabEnv {
                jobs,
                notifications,
                project: project.as_ref(),
                git: git_info,
                commands,
                tab_id: active,
                editor_theme,
            };
            c.ui(ui, &mut env);
            None
        }
    };
    let Some((r, next_problem, hover_problems)) = out else { return };
    if next_problem {
        crate::diagnostics::goto_next(s, true);
    }
    let rect = r.response.rect;
    if let Some(action) = r.action {
        let anchor = nav::anchor_for(ui.ctx(), rect);
        match action {
            EditorAction::GoToDeclaration(p) => nav::request(s, NavKind::Declaration, active, p, anchor),
            EditorAction::GoToSourceDefinition(p) => nav::request(s, NavKind::SourceDefinition, active, p, anchor),
            EditorAction::GoToTypeDefinition(p) => nav::request(s, NavKind::TypeDefinition, active, p, anchor),
            EditorAction::FindUsages(p) => nav::request(s, NavKind::Usages, active, p, anchor),
            other @ (EditorAction::GitAnnotate | EditorAction::GitShowHistory | EditorAction::GitRollbackLines) => {
                git::on_editor_action(s, active, &other)
            }
        }
    }
    if let Some(line) = r.gutter_clicked {
        git::on_gutter_click(s, active, line);
    }
    if let Some(line) = r.annotation_clicked {
        git::on_annotation_click(s, active, line);
    }
    let menu_open = ui.ctx().memory(|m| m.any_popup_open());
    let quiet = menu_open || s.ws.nav.popup.is_some();
    nav::hover(s, active, if quiet { None } else { r.hover }, r.response.layer_id, if quiet { &[] } else { &hover_problems });
}

/// IDEA's hint list in an empty editor.
fn empty_editor_hints(ui: &mut egui::Ui) {
    let t = &theme::T;
    let hints = [
        ("Search Everywhere", "Double ⇧"),
        ("Go to File", "⇧⌘O"),
        ("Recent Files", "⌘E"),
        ("Navigation Bar", "⌥Home"),
        ("Drop files here to open them", ""),
    ];
    let rect = ui.max_rect();
    let line_h = 26.0;
    let top = rect.center().y - line_h * hints.len() as f32 / 2.0;
    let painter = ui.painter();
    let gap = 10.0;
    for (i, (action, keys)) in hints.iter().enumerate() {
        let y = top + i as f32 * line_h + line_h / 2.0;
        let a = painter.layout_no_wrap(action.to_string(), FontId::proportional(t.font.hint), t.text_dim);
        let k = painter.layout_no_wrap(keys.to_string(), FontId::proportional(t.font.hint), t.link);
        let w = a.size().x + if keys.is_empty() { 0.0 } else { gap + k.size().x };
        let x = rect.center().x - w / 2.0;
        painter.galley(pos2(x, y - a.size().y / 2.0), a.clone(), t.text_dim);
        if !keys.is_empty() {
            painter.galley(pos2(x + a.size().x + gap, y - k.size().y / 2.0), k, t.link);
        }
    }
    let resp = ui.interact(rect, crate::workspace::wid("empty-editor"), Sense::hover());
    crate::util::label_widget(&resp, egui::WidgetType::Other, "Empty editor");
}

fn welcome(s: &mut AppState, ui: &mut egui::Ui) {
    ui.vertical_centered(|ui| {
        ui.add_space(ui.available_height() * 0.35);
        ui.label(RichText::new("harwex-ide").size(theme::T.font.welcome).color(theme::T.text_bright));
        ui.add_space(12.0);
        if ui.add(egui::Button::new(RichText::new("Open Folder...").size(theme::T.font.big)).corner_radius(CornerRadius::same(4)).min_size(egui::vec2(160.0, 32.0))).clicked() {
            s.pick_folder();
        }
        let _ = ui.interact(ui.max_rect(), crate::workspace::wid("welcome"), Sense::hover());
    });
}

fn confirm_close(s: &mut AppState, ctx: &Context) {
    let Some(id) = s.ws.confirm_close else { return };
    let Some(title) = s.ws.tabs.get(id).map(|t| t.title()) else {
        s.ws.confirm_close = None;
        return;
    };
    let mut choice = None;
    let modal = Modal::new(crate::workspace::wid("confirm-close")).show(ctx, |ui| {
        ui.set_width(360.0);
        ui.label(RichText::new(format!("Save changes to {title}?")).strong());
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            if ui.button("Save").clicked() {
                choice = Some(0);
            }
            if ui.button("Don't Save").clicked() {
                choice = Some(1);
            }
            if ui.button("Cancel").clicked() {
                choice = Some(2);
            }
        });
    });
    if choice.is_none() && modal.should_close() {
        choice = Some(2);
    }
    match choice {
        Some(0) => {
            s.ws.confirm_close = None;
            s.save_tab(id, true);
        }
        Some(1) => {
            s.ws.confirm_close = None;
            s.close_tab(id, true);
        }
        Some(_) => s.ws.confirm_close = None,
        None => {}
    }
}

/// "Close project?" for a workspace with unsaved files (`AppState::close_workspace`). The
/// workspace is active while the prompt shows.
fn confirm_close_workspace(s: &mut AppState, ctx: &Context) {
    let Some(id) = s.confirm_close_ws else { return };
    if s.ws.id != id && !s.activate(id) {
        s.confirm_close_ws = None;
        return;
    }
    let dirty: Vec<String> = s.ws.tabs.list.iter().filter(|t| t.is_dirty()).map(|t| t.title()).collect();
    if dirty.is_empty() {
        // Saved meanwhile: nothing to ask.
        s.confirm_close_ws = None;
        s.close_workspace_now(id);
        return;
    }
    let name = s.ws.project.as_ref().map_or_else(String::new, |p| p.name.clone());
    let mut choice = None;
    let modal = Modal::new(Id::new("confirm-close-project")).show(ctx, |ui| {
        ui.set_width(380.0);
        ui.label(RichText::new(format!("Close project {name}?")).strong());
        ui.add_space(4.0);
        ui.label(format!("Unsaved changes: {}.", dirty.join(", ")));
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            if ui.button("Save and Close").clicked() {
                choice = Some(0);
            }
            if ui.button("Close Without Saving").clicked() {
                choice = Some(1);
            }
            if ui.button("Cancel").clicked() {
                choice = Some(2);
            }
        });
    });
    if choice.is_none() && modal.should_close() {
        choice = Some(2);
    }
    match choice {
        Some(0) => {
            s.confirm_close_ws = None;
            s.save_all();
            s.ws.close_when_saved = true;
        }
        Some(1) => s.close_workspace_now(id),
        Some(_) => s.confirm_close_ws = None,
        None => {}
    }
}
