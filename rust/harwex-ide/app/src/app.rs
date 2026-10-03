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
    /// The memory indicator's process source. `Auto` turns it off in deterministic mode.
    pub memory: MemorySource,
    /// Trash, Finder and the clipboard. `None` picks the system in a normal run and a
    /// recording stand-in in deterministic (test) mode, so tests never touch them.
    pub platform: Option<std::sync::Arc<dyn crate::fileops::Platform>>,
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
            memory: MemorySource::Auto,
            platform: None,
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
        state.platform = match options.platform {
            Some(p) => p,
            None if options.deterministic => std::sync::Arc::new(crate::fileops::RecordingPlatform::new(std::env::temp_dir().join("harwex-ide-test-trash"))),
            None => std::sync::Arc::new(crate::fileops::SystemPlatform),
        };
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
            state.memory.start(source, state.jobs.clone());
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
    fn update(&mut self, ctx: &Context, frame: &mut eframe::Frame) {
        let s = &mut self.state;
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
        let badge = |w: ToolWindow| if w == ToolWindow::Notifications { unread } else { 0 };
        let window = Frame::NONE.fill(t.window_bg);
        egui::SidePanel::left("left-strip").exact_width(t.space.strip_w).resizable(false).show_separator_line(false).frame(window).show(ctx, |ui| {
            layout::left_strip(ui, &mut s.layout, badge);
        });
        // Islands: each tool window and the editor sit on the window background as a rounded
        // surface. Half a gap on each inner edge makes one gap between neighbours. No strip
        // sits on the right, so the islands keep a full gap to the right window edge.
        let half = (t.space.gap / 2.0) as i8;
        let gap = t.space.gap as i8;
        let (has_left, has_bottom) = (s.layout.left.is_some(), s.layout.bottom.is_some());
        if let Some(w) = s.layout.bottom {
            egui::TopBottomPanel::bottom("bottom-tool-window")
                .default_height(240.0)
                .height_range(80.0..=900.0)
                .resizable(true)
                .show_separator_line(false)
                .frame(window.inner_margin(Margin { top: half, right: gap, ..Margin::ZERO }))
                .show(ctx, |ui| tool_window(s, ui, w));
        }
        if let Some(w) = s.layout.left {
            egui::SidePanel::left("left-tool-window")
                .default_width(300.0)
                .width_range(160.0..=900.0)
                .show_separator_line(false)
                .frame(window.inner_margin(Margin { right: half, bottom: if has_bottom { half } else { 0 }, ..Margin::ZERO }))
                .show(ctx, |ui| tool_window(s, ui, w));
        }
        let editor_margin = Margin { left: if has_left { half } else { 0 }, right: gap, bottom: if has_bottom { half } else { 0 }, ..Margin::ZERO };
        egui::CentralPanel::default().frame(window.inner_margin(editor_margin)).show(ctx, |ui| {
            layout::island(t.space.editor_pad).show(ui, |ui| {
                ui.set_min_size(ui.available_size());
                editor_area(s, ui);
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
        confirm_close(s, ctx);
        git::show_windows(s, ctx);
        s.notifications.show_toasts(ctx, 48.0);

        s.run_commands();
        nav::sync_lsp_debounced(s);
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
        self.state.langs.shutdown();
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
    editor_find_keys(s, ctx);
    if select_in {
        tree::select_opened_file(s);
    }
    if recent_e && s.project.is_some() {
        s.search.open_recent();
    }
    if s.git.repo.is_some() {
        if branches {
            let anchor = s.git_ui.branches_anchor.unwrap_or(pos2(chrome::current(ctx).content_x, theme::T.space.title_h));
            git::open_branches_popup(s, anchor);
        }
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
        // From the Project tree, Find and Replace in Files search the selected folder.
        if tree::has_focus(ctx) {
            let dir = s.tree.selected_dir();
            s.find.open_scoped(dir, replace_r);
        } else {
            let selected = s.tabs.active_editor().map(|e| e.doc.slice(e.view.selection().range()));
            s.find.open_scoped(None, replace_r);
            s.find.open_dialog(selected);
        }
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

/// The editor's find bar: Cmd+F, Cmd+R, Cmd+G, Shift+Cmd+G and Ctrl+Cmd+G (Select All
/// Occurrences). They act on the active editor while it or its bar has the focus (or nothing
/// has), never on another text field.
fn editor_find_keys(s: &mut AppState, ctx: &Context) {
    let ctrl_cmd = Modifiers::COMMAND | Modifiers::CTRL;
    let cmd_shift = Modifiers::COMMAND | Modifiers::SHIFT;
    let Some(e) = s.tabs.active_editor_mut() else { return };
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
/// vertically centered (`chrome`), then the project widget (badge, name), Settings and the current branch.
/// A soft tint of the badge color runs across it from the left.
fn title_bar(s: &mut AppState, ctx: &Context) {
    let t = &theme::T;
    egui::TopBottomPanel::top("title-bar").exact_height(t.space.title_h).show_separator_line(false).frame(Frame::NONE.fill(t.window_bg)).show(ctx, |ui| {
        let full = ui.max_rect();
        let name = s.project.as_ref().map(|p| p.name.clone());
        let badge = name.as_deref().map(|n| t.badge_color(n));
        if let Some(color) = badge {
            paint_tint(ui.painter(), full, color);
        }
        // The empty part of the bar moves the window; a double click zooms it.
        let drag = ui.interact(full, Id::new("title-bar-drag"), Sense::click_and_drag());
        if drag.drag_started() {
            ctx.send_viewport_cmd(ViewportCommand::StartDrag);
        }
        if drag.double_clicked() {
            match chrome::system_double_click() {
                chrome::DoubleClick::Zoom => {
                    let maximized = ctx.input(|i| i.viewport().maximized.unwrap_or(false));
                    ctx.send_viewport_cmd(ViewportCommand::Maximized(!maximized));
                }
                chrome::DoubleClick::Minimize => ctx.send_viewport_cmd(ViewportCommand::Minimized(true)),
                chrome::DoubleClick::Nothing => {}
            }
        }
        let left_inset = chrome::current(ctx).content_x;
        let mut row = ui.new_child(UiBuilder::new().max_rect(full.shrink2(egui::vec2(0.0, 6.0))).layout(Layout::left_to_right(Align::Center)));
        row.add_space(left_inset);
        row.spacing_mut().item_spacing.x = 2.0;
        let project = title_widget(&mut row, name.as_deref().map(|n| (initials(n), badge.unwrap_or(t.accent))), name.as_deref().unwrap_or("Open Folder..."), &format!("Project {}", name.as_deref().unwrap_or("")));
        if project.on_hover_text("Open another folder").clicked() {
            s.pick_folder();
        }
        row.add_space(4.0);
        let settings = layout::icon_button(&mut row, Icon::Settings, "Settings", "Settings");
        settings_menu(s, &row, &settings);
        // The branch is display-only. The branches popup opens with Ctrl+Shift+` and drops
        // down from here.
        if s.git.repo.is_some() {
            row.add_space(4.0);
            let branch = s.git.branch.clone().unwrap_or_else(|| "...".into());
            let label = if s.git.detached { format!("detached: {branch}") } else { branch };
            let r = branch_widget(&mut row, &label);
            s.git_ui.branches_anchor = Some(r.rect.left_bottom() + egui::vec2(0.0, 4.0));
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

/// A title bar widget: an optional badge, a text and a dropdown chevron, with a hover fill.
fn title_widget(ui: &mut egui::Ui, badge: Option<(String, egui::Color32)>, text: &str, label: &str) -> egui::Response {
    let t = &theme::T;
    let font = t.semibold(t.font.ui);
    let galley = ui.painter().layout_no_wrap(text.to_string(), font, t.text);
    let badge_w = if badge.is_some() { 20.0 + 8.0 } else { 0.0 };
    let size = egui::vec2(8.0 + badge_w + galley.size().x + 6.0 + 12.0 + 8.0, t.space.title_h - 12.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    crate::util::label_widget(&resp, egui::WidgetType::Button, label);
    let painter = ui.painter();
    if resp.hovered() {
        painter.rect_filled(rect, t.radius.button, t.hover_on_window);
    }
    let mut x = rect.min.x + 8.0;
    if let Some((initials, color)) = badge {
        let b = Rect::from_min_size(egui::pos2(x, rect.center().y - 10.0), egui::vec2(20.0, 20.0));
        painter.rect_filled(b, t.radius.badge, color);
        painter.text(b.center(), egui::Align2::CENTER_CENTER, initials, t.semibold(t.font.badge), t.badge_text);
        x += badge_w;
    }
    painter.galley(egui::pos2(x, rect.center().y - galley.size().y / 2.0), galley.clone(), t.text);
    x += galley.size().x + 6.0;
    icons::paint(painter, Rect::from_center_size(egui::pos2(x + 6.0, rect.center().y + 1.0), egui::vec2(12.0, 12.0)), Icon::ChevronDown, t.text_dim);
    resp
}

/// The current branch: an icon and the name. It takes no clicks.
fn branch_widget(ui: &mut egui::Ui, branch: &str) -> egui::Response {
    let t = &theme::T;
    let galley = ui.painter().layout_no_wrap(branch.to_string(), t.ui_font(), t.text);
    let size = egui::vec2(8.0 + 16.0 + 6.0 + galley.size().x + 8.0, t.space.title_h - 12.0);
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
        let config = s.project.as_ref().map(|p| p.root.join(".harwex/ide.toml"));
        if ui.add_enabled(config.is_some(), egui::Button::new("Project Settings (.harwex/ide.toml)")).clicked() {
            close(ui);
            if let Some(path) = config {
                s.open_location(&path, None, true);
            }
        }
        ui.separator();
        if ui.add(egui::Button::new("Notifications")).clicked() {
            close(ui);
            s.layout.show(ToolWindow::Notifications);
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
        ui.scope_builder(UiBuilder::new().max_rect(left).layout(Layout::left_to_right(Align::Center)), |ui| {
            ui.set_clip_rect(left);
            breadcrumbs::bar(s, ui);
            if let Some(note) = s.notifications.log().last() {
                if note.time.elapsed().as_secs() < 60 && ui.available_width() > 60.0 {
                    if !s.breadcrumbs.slots.is_empty() {
                        ui.add_space(12.0);
                    }
                    ui.add(egui::Label::new(RichText::new(&note.title).size(t.font.small).color(t.text_dim)).truncate());
                }
            }
        });
    });
    // The breadcrumb popups rest on the top edge of the status bar.
    s.breadcrumbs.baseline = Some(panel.response.rect.min.y);
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
    if let Some(tab) = s.tabs.active_tab() {
        match &tab.content {
            TabContent::Editor(e) => {
                item(ui, e.doc.language().name(), t.text);
                if let Some(backend) = e.lang.and_then(|l| s.langs.status(l, &e.path)).filter(|_| wide) {
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
                layout::Side::Left => s.layout.left = None,
                layout::Side::Bottom => s.layout.bottom = None,
            }
            return;
        }
        tool_window_body(s, ui, w);
    });
}

fn open_dropped_files(s: &mut AppState, ctx: &Context) {
    let dropped: Vec<PathBuf> = ctx.input(|i| i.raw.dropped_files.iter().filter_map(|f| f.path.clone()).collect());
    if s.project.is_none() {
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
        empty_editor_hints(ui);
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
    let resp = ui.interact(rect, Id::new("empty-editor"), Sense::hover());
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
