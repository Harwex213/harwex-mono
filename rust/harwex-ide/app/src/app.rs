//! The eframe app: frame layout and input routing. Feature logic lives in the other modules.

use std::path::PathBuf;
use std::time::Instant;

use egui::{pos2, Align, Context, CornerRadius, Frame, Id, Key, Layout, Margin, Modifiers, Modal, Rect, RichText, Sense, UiBuilder};
use ide_editor::{EditorAction, EditorView};

use crate::layout::{self, ToolWindow};
use crate::nav::{self, NavKind};
use crate::state::{AppState, TabEnv};
use crate::tabs::{TabBarEvent, TabContent};
use crate::testhook::TestScript;
use crate::{breadcrumbs, find, git, search, testhook, theme, tree};

pub const STORAGE_LAST_FOLDER: &str = "last_folder";
pub const STORAGE_LAYOUT: &str = "tool_windows";

/// The shell a new terminal tab runs instead of the user's login shell.
#[derive(Clone, Debug, Default)]
pub struct TerminalCommand {
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// How the app starts. `main.rs` fills it from the command line; tests build it by hand.
pub struct AppOptions {
    /// Folder to open. `None` falls back to the stored last folder (if `restore_last_folder`).
    pub project: Option<PathBuf>,
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
    /// Process start, for the timings log.
    pub start: Instant,
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
            start: Instant::now(),
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
        let mut state = AppState::new(ctx.clone(), options.start);
        state.timings.quiet = options.deterministic;
        state.timings.log("window created");
        state.test = options.test;
        state.watch_files = options.watch_files;
        state.terminals.command = options.terminal;
        if options.deterministic {
            state.deterministic = true;
            state.notifications.frozen = true;
        }
        if options.find_node_at_start {
            // Warms ide-ts's node lookup (a login-shell probe can take ~0.5 s) before the
            // first navigation request needs it.
            state.jobs.spawn_quiet(ide_ts::find_node, |state, node| match node {
                Some(n) => state.timings.log(format!("node: {}", n.display())),
                None => state.notifications.warn("node not found", "TypeScript navigation needs node on PATH, in nvm or in /opt/homebrew/bin."),
            });
        }
        if let Some(layout) = storage.and_then(|s| s.get_string(STORAGE_LAYOUT)).and_then(|t| layout::Layout::from_storage(&t)) {
            state.layout = layout;
        }
        let last = if options.restore_last_folder { storage.and_then(|s| s.get_string(STORAGE_LAST_FOLDER)).map(PathBuf::from) } else { None };
        if let Some(folder) = options.project.or(last) {
            state.open_project(folder);
        }
        IdeApp::new(state)
    }
}

impl eframe::App for IdeApp {
    fn update(&mut self, ctx: &Context, _frame: &mut eframe::Frame) {
        let s = &mut self.state;
        self.frames += 1;
        if self.frames == 1 {
            s.timings.log("first frame (update called)");
        } else if self.frames == 2 {
            s.timings.log("second frame (first frame presented)");
        }
        s.drain_inbox();
        shortcuts(s, ctx);

        top_bar(s, ctx);
        // Right under the top bar while a merge/rebase/cherry-pick/revert is in progress.
        git::conflicts::banner(s, ctx);
        status_bar(s, ctx);
        egui::TopBottomPanel::bottom("bottom-strip").exact_height(24.0).frame(Frame::NONE.fill(theme::STRIP_BG).inner_margin(Margin::symmetric(30, 2))).show(ctx, |ui| {
            let unread = s.notifications.unread;
            layout::bottom_strip(ui, &mut s.layout, |w| if w == ToolWindow::Notifications { unread } else { 0 });
        });
        egui::SidePanel::left("left-strip").exact_width(26.0).resizable(false).frame(Frame::NONE.fill(theme::STRIP_BG).inner_margin(Margin::symmetric(2, 0))).show(ctx, |ui| {
            layout::left_strip(ui, &mut s.layout, |_| 0);
        });
        if let Some(w) = s.layout.left {
            egui::SidePanel::left("left-tool-window")
                .default_width(300.0)
                .width_range(160.0..=900.0)
                .frame(Frame::NONE.fill(theme::PANEL_BG).inner_margin(Margin::same(6)))
                .show(ctx, |ui| {
                    if layout::header(ui, w.title()) {
                        s.layout.left = None;
                    }
                    tool_window_body(s, ui, w);
                });
        }
        if let Some(w) = s.layout.bottom {
            egui::TopBottomPanel::bottom("bottom-tool-window")
                .default_height(240.0)
                .height_range(80.0..=900.0)
                .resizable(true)
                .frame(Frame::NONE.fill(theme::PANEL_BG).inner_margin(Margin::same(6)))
                .show(ctx, |ui| {
                    if layout::header(ui, w.title()) {
                        s.layout.bottom = None;
                    }
                    tool_window_body(s, ui, w);
                });
        }
        egui::CentralPanel::default().frame(Frame::NONE.fill(theme::EDITOR_BG)).show(ctx, |ui| {
            editor_area(s, ui);
        });

        if let Some(path) = search::show(s, ctx) {
            s.open_location(&path, None, true);
        }
        find::show_dialog(s, ctx);
        nav::show_popup(s, ctx);
        breadcrumbs::show_popup(s, ctx);
        confirm_close(s, ctx);
        git::show_windows(s, ctx);
        s.notifications.show_toasts(ctx, 48.0);

        s.run_commands();
        nav::sync_ts_debounced(s);
        s.schedule_gutter();
        testhook::tick(s);
        if !s.jobs.running().is_empty() {
            // Keeps the spinner turning; ~10 fps is enough and costs nothing measurable.
            ctx.request_repaint_after(std::time::Duration::from_millis(100));
        }
    }

    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        if let Some(p) = &self.state.project {
            storage.set_string(STORAGE_LAST_FOLDER, p.root.display().to_string());
        }
        storage.set_string(STORAGE_LAYOUT, self.state.layout.to_storage());
    }

    fn on_exit(&mut self) {
        self.state.terminals.kill_all();
        self.state.ts.service.shutdown();
    }
}

fn shortcuts(s: &mut AppState, ctx: &Context) {
    nav::take_popup_keys(s, ctx);
    breadcrumbs::take_keys(s, ctx);
    // A focused terminal gets every key except Alt+F12 and Escape.
    if crate::terminal::shortcuts(s, ctx) {
        return;
    }
    breadcrumbs::shortcut(s, ctx);
    let cmd_shift = Modifiers::COMMAND | Modifiers::SHIFT;
    // Most specific first: consume_key ignores extra Shift.
    let (search_o, find_f, save_all, save, close, back, fwd, back_alt, fwd_alt) = ctx.input_mut(|i| {
        (
            i.consume_key(cmd_shift, Key::O),
            i.consume_key(cmd_shift, Key::F),
            i.consume_key(Modifiers::COMMAND | Modifiers::ALT, Key::S),
            i.consume_key(Modifiers::COMMAND, Key::S),
            i.consume_key(Modifiers::COMMAND, Key::W),
            i.consume_key(Modifiers::COMMAND, Key::OpenBracket),
            i.consume_key(Modifiers::COMMAND, Key::CloseBracket),
            i.consume_key(Modifiers::COMMAND | Modifiers::ALT, Key::ArrowLeft),
            i.consume_key(Modifiers::COMMAND | Modifiers::ALT, Key::ArrowRight),
        )
    });
    let (push_k, update_t) = ctx.input_mut(|i| (i.consume_key(cmd_shift, Key::K), i.consume_key(Modifiers::COMMAND, Key::T)));
    if s.git.repo.is_some() {
        if push_k {
            git::push_clicked(s);
        }
        if update_t {
            git::update_project_clicked(s);
        }
    }
    let double_shift = s.search.detect_double_shift(ctx);
    if (search_o || double_shift) && s.project.is_some() {
        s.search.open();
    }
    if find_f && s.project.is_some() {
        let selected = s.tabs.active_editor().map(|e| e.doc.slice(e.view.selection().range()));
        s.find.open_dialog(selected);
    }
    if save_all {
        s.save_all();
    } else if save {
        if let Some(id) = s.tabs.active {
            s.save_tab(id, false);
        }
    }
    if close {
        if let Some(id) = s.tabs.active {
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

fn top_bar(s: &mut AppState, ctx: &Context) {
    egui::TopBottomPanel::top("top-bar").exact_height(34.0).frame(Frame::NONE.fill(theme::PANEL_BG).inner_margin(Margin::symmetric(10, 4))).show(ctx, |ui| {
        ui.horizontal_centered(|ui| {
            let name = s.project.as_ref().map_or("Open Folder...".to_string(), |p| p.name.clone());
            if ui.add(egui::Button::new(RichText::new(name).strong().color(theme::TEXT_BRIGHT)).frame(false)).on_hover_text("Open another folder").clicked() {
                s.pick_folder();
            }
            if s.git.repo.is_some() {
                ui.add_space(8.0);
                let branch = s.git.branch.clone().unwrap_or_else(|| "...".into());
                let label = if s.git.detached { format!("detached: {branch}") } else { branch };
                let r = ui.add(egui::Button::new(RichText::new(format!("{label}  v")).color(theme::TEXT)).frame(false)).on_hover_text("Git branches");
                if r.clicked() {
                    git::branch_button_clicked(s, r.rect.left_bottom());
                }
            }
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if s.project.is_some() && ui.button("Search").on_hover_text("Search Everywhere (Shift Shift, Cmd+Shift+O)").clicked() {
                    s.search.open();
                }
                if s.git.repo.is_some() {
                    ui.add_space(12.0);
                    if ui.button("Push").on_hover_text("Push... (Cmd+Shift+K)").clicked() {
                        git::push_clicked(s);
                    }
                    if ui.button("Commit").on_hover_text("Commit... (Cmd+K)").clicked() {
                        git::commit_clicked(s);
                    }
                    if ui.button("Update").on_hover_text("Update Project (Cmd+T)").clicked() {
                        git::update_project_clicked(s);
                    }
                }
            });
        });
    });
}

fn status_bar(s: &mut AppState, ctx: &Context) {
    let panel = egui::TopBottomPanel::bottom("status-bar").exact_height(24.0).frame(Frame::NONE.fill(theme::PANEL_BG).inner_margin(Margin::symmetric(10, 2))).show(ctx, |ui| {
        let full = ui.max_rect();
        // The right part goes first: the breadcrumbs get the width that is left.
        let right = ui
            .scope_builder(UiBuilder::new().max_rect(full).layout(Layout::right_to_left(Align::Center)), |ui| {
                status_right(s, ui);
            })
            .response
            .rect;
        let left = Rect::from_min_max(full.min, pos2((right.min.x - 16.0).max(full.min.x), full.max.y));
        ui.scope_builder(UiBuilder::new().max_rect(left).layout(Layout::left_to_right(Align::Center)), |ui| {
            ui.set_clip_rect(left);
            breadcrumbs::bar(s, ui);
            if let Some(note) = s.notifications.log().last() {
                if note.time.elapsed().as_secs() < 60 && ui.available_width() > 60.0 {
                    if !s.breadcrumbs.slots.is_empty() {
                        ui.add_space(12.0);
                    }
                    ui.add(egui::Label::new(RichText::new(&note.title).size(12.0).color(theme::TEXT_DIM)).truncate());
                }
            }
        });
    });
    // The breadcrumb popups rest on the top edge of the status bar.
    s.breadcrumbs.baseline = Some(panel.response.rect.min.y);
}

fn status_right(s: &mut AppState, ui: &mut egui::Ui) {
    let running = s.jobs.running();
    if let Some(b) = &s.git.branch {
        ui.label(RichText::new(b).size(12.0));
        ui.separator();
    }
    if let Some(tab) = s.tabs.active_tab() {
        match &tab.content {
            TabContent::Editor(e) => {
                ui.label(RichText::new(e.doc.language().name()).size(12.0));
                ui.separator();
                if e.read_only {
                    ui.label(RichText::new("read-only").size(12.0).color(theme::WARNING));
                    ui.separator();
                }
                let c = e.view.cursor();
                ui.label(RichText::new(format!("{}:{}", c.line + 1, c.column + 1)).size(12.0));
                ui.separator();
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
        ui.label(RichText::new(label).size(12.0).color(theme::TEXT_DIM));
        ui.add(egui::Spinner::new().size(12.0));
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
        ToolWindow::Find => {
            if let Some((p, pos)) = find::show_results(s, ui) {
                s.open_location(&p, Some(pos), true);
            }
        }
        ToolWindow::Git => git::log_tool_window(s, ui),
        ToolWindow::Usages => nav::show_usages(s, ui),
        ToolWindow::Terminal => crate::terminal::tool_window(s, ui),
        ToolWindow::Notifications => s.notifications.show_log(ui),
    }
}

fn editor_area(s: &mut AppState, ui: &mut egui::Ui) {
    if s.project.is_none() {
        welcome(s, ui);
        return;
    }
    if !s.tabs.list.is_empty() {
        match s.tabs.show_bar(ui) {
            Some(TabBarEvent::Activate(id)) => {
                s.tabs.activate(id);
                if let Some(e) = s.tabs.editor_mut(id) {
                    e.view.request_focus();
                }
            }
            Some(TabBarEvent::Close(id)) => s.close_tab(id, false),
            None => {}
        }
    }
    let Some(active) = s.tabs.active else {
        ui.centered_and_justified(|ui| {
            ui.label(RichText::new("Search Everywhere: Shift Shift\nFind in Files: Cmd+Shift+F\nOpen a file from the Project tree: double-click").color(theme::TEXT_DIM).size(14.0));
        });
        return;
    };

    let AppState { tabs, jobs, notifications, project, git: git_info, commands, editor_theme, .. } = &mut *s;
    let Some(tab) = tabs.get_mut(active) else { return };
    let out = match &mut tab.content {
        TabContent::Editor(e) => {
            let r = EditorView::new(&mut e.doc, &mut e.view)
                .gutter_marks(&e.marks)
                .annotations(&e.annotations)
                .theme(editor_theme)
                .read_only(e.read_only)
                .show(ui);
            if r.changed {
                e.last_edit = Instant::now();
            }
            Some(r)
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
    let Some(r) = out else { return };
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
    nav::hover(s, active, if menu_open || s.nav.popup.is_some() { None } else { r.hover }, r.response.layer_id);
}

fn welcome(s: &mut AppState, ui: &mut egui::Ui) {
    ui.vertical_centered(|ui| {
        ui.add_space(ui.available_height() * 0.35);
        ui.label(RichText::new("harwex-ide").size(24.0).color(theme::TEXT_BRIGHT));
        ui.add_space(12.0);
        if ui.add(egui::Button::new(RichText::new("Open Folder...").size(15.0)).corner_radius(CornerRadius::same(4)).min_size(egui::vec2(160.0, 32.0))).clicked() {
            s.pick_folder();
        }
        let _ = ui.interact(ui.max_rect(), Id::new("welcome"), Sense::hover());
    });
}

fn confirm_close(s: &mut AppState, ctx: &Context) {
    let Some(id) = s.confirm_close else { return };
    let Some(title) = s.tabs.get(id).map(|t| t.title()) else {
        s.confirm_close = None;
        return;
    };
    let mut choice = None;
    let modal = Modal::new(Id::new("confirm-close")).show(ctx, |ui| {
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
            s.confirm_close = None;
            s.save_tab(id, true);
        }
        Some(1) => {
            s.confirm_close = None;
            s.close_tab(id, true);
        }
        Some(_) => s.confirm_close = None,
        None => {}
    }
}
