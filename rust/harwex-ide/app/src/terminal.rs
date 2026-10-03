//! The Terminal tool window in the bottom strip, like IDEA's: a tab per shell, a "+" button,
//! Alt+F12 to toggle and focus, Escape to return focus to the editor (except on the alternate
//! screen, where vim and less need Escape).
//!
//! Keyboard routing: `shortcuts` runs first in `app::shortcuts`. While a terminal has focus it
//! returns `true`, and the app skips its other global shortcuts, so Cmd+W, Shift Shift and the
//! rest reach the shell instead. Only Alt+F12 and Escape are handled here.

use std::path::PathBuf;

use egui::{Context, Id, Key, Modifiers, RichText, Ui};
use ide_editor::Position;
use ide_term::{Terminal, TerminalView};

use crate::layout::ToolWindow;
use crate::state::AppState;
use crate::theme;

struct TermTab {
    term: Terminal,
    /// Widget id, stable for the life of the tab, so focus can be checked and requested.
    id: Id,
}

#[derive(Default)]
pub struct Terminals {
    tabs: Vec<TermTab>,
    active: usize,
    next_serial: u64,
    /// Focus the active terminal the next time it is drawn.
    focus_pending: bool,
    /// Text to type into the next drawn terminal (test hook).
    pending_input: Option<String>,
    /// When to print the active terminal's screen to stderr (test hook).
    dump_at: Option<std::time::Instant>,
    /// Runs this instead of the login shell (tests use a shell without rc files).
    pub command: Option<crate::app::TerminalCommand>,
}

impl Terminals {
    /// True when one of the terminal widgets has keyboard focus.
    pub fn has_focus(&self, ctx: &Context) -> bool {
        let Some(focused) = ctx.memory(|m| m.focused()) else { return false };
        self.tabs.iter().any(|t| t.id == focused)
    }

    /// Number of terminal tabs.
    pub fn len(&self) -> usize {
        self.tabs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tabs.is_empty()
    }

    /// Index of the active tab.
    pub fn active_index(&self) -> usize {
        self.active
    }

    /// The terminal of tab `index`, for tests that read the screen or the shell state.
    pub fn terminal(&self, index: usize) -> Option<&Terminal> {
        self.tabs.get(index).map(|t| &t.term)
    }

    /// The egui id of tab `index`'s widget.
    pub fn widget_id(&self, index: usize) -> Option<Id> {
        self.tabs.get(index).map(|t| t.id)
    }

    /// True when the focused terminal runs a program on the alternate screen.
    fn focused_is_alt_screen(&self, ctx: &Context) -> bool {
        let Some(focused) = ctx.memory(|m| m.focused()) else { return false };
        self.tabs.iter().any(|t| t.id == focused && t.term.is_alt_screen())
    }

    /// Pids of the running shells, for the memory indicator, which leaves their subtrees out.
    pub fn shell_pids(&self) -> impl Iterator<Item = u32> + Clone + '_ {
        self.tabs.iter().filter_map(|t| t.term.process_id())
    }

    /// Kills every shell. Called on app exit.
    pub fn kill_all(&mut self) {
        for t in &mut self.tabs {
            t.term.kill();
        }
    }

    fn spawn(&mut self, cwd: PathBuf, ctx: Context) -> std::io::Result<()> {
        let term = match &self.command {
            Some(c) => {
                let mut options = ide_term::SpawnOptions::new(&cwd);
                options.command = Some(c.argv.clone());
                options.env = c.env.clone();
                Terminal::spawn_with(options, ctx)?
            }
            None => Terminal::spawn(&cwd, ctx)?,
        };
        self.next_serial += 1;
        self.tabs.push(TermTab { term, id: Id::new(("terminal-tab", self.next_serial)) });
        self.active = self.tabs.len() - 1;
        self.focus_pending = true;
        Ok(())
    }

    fn close(&mut self, index: usize) {
        if index >= self.tabs.len() {
            return;
        }
        let mut tab = self.tabs.remove(index);
        tab.term.kill();
        if self.active > index || self.active >= self.tabs.len() {
            self.active = self.active.saturating_sub(1);
        }
    }
}

/// Handles Alt+F12 and Escape. Returns true when a terminal has focus; the caller then skips
/// its own global shortcuts.
pub fn shortcuts(s: &mut AppState, ctx: &Context) -> bool {
    let focused = s.terminals.has_focus(ctx);
    let toggle = ctx.input_mut(|i| i.consume_key(Modifiers::ALT, Key::F12));
    if toggle {
        if s.layout.bottom != Some(ToolWindow::Terminal) {
            s.layout.show(ToolWindow::Terminal);
            s.terminals.focus_pending = true;
        } else if focused {
            s.layout.bottom = None;
            focus_editor(s, ctx);
        } else {
            s.terminals.focus_pending = true;
        }
        return true;
    }
    // vim, less and htop run on the alternate screen and need Escape themselves.
    if focused && !s.terminals.focused_is_alt_screen(ctx) && ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Escape)) {
        focus_editor(s, ctx);
    }
    focused
}

/// Moves keyboard focus to the active editor, or drops it when no editor is open.
pub(crate) fn focus_editor(s: &mut AppState, ctx: &Context) {
    if let Some(e) = s.tabs.active_editor_mut() {
        e.view.request_focus();
        return;
    }
    if let Some(id) = ctx.memory(|m| m.focused()) {
        ctx.memory_mut(|m| m.surrender_focus(id));
    }
}

/// The terminal tabs in the tool window header, like IDEA: one flat tab per shell with its
/// close button, then "+".
pub fn header_tabs(s: &mut AppState, ui: &mut Ui) {
    let t = &theme::T;
    let mut activate = None;
    let mut close = None;
    ui.spacing_mut().item_spacing.x = 2.0;
    for (i, term) in s.terminals.tabs.iter().enumerate() {
        let mut title = term.term.title();
        if title.chars().count() > 32 {
            title = format!("{}...", title.chars().take(30).collect::<String>());
        }
        let alive = term.term.is_alive();
        let active = i == s.terminals.active;
        let color = match (active, alive) {
            (_, false) => t.text_dim,
            (true, true) => t.text_bright,
            (false, true) => t.text,
        };
        let galley = ui.painter().layout_no_wrap(title.clone(), t.small_font(), color);
        let close_w = 16.0;
        let size = egui::vec2(10.0 + galley.size().x + 4.0 + close_w + 6.0, 24.0);
        let (rect, resp) = ui.allocate_exact_size(size, egui::Sense::click());
        crate::util::label_selectable(&resp, title.clone(), active);
        let painter = ui.painter();
        if active {
            painter.rect_filled(rect, t.radius.button, t.tab_active_bg);
        } else if resp.hovered() {
            painter.rect_filled(rect, t.radius.button, t.hover);
        }
        painter.galley(egui::pos2(rect.min.x + 10.0, rect.center().y - galley.size().y / 2.0), galley, color);
        let close_rect = egui::Rect::from_center_size(egui::pos2(rect.max.x - 6.0 - close_w / 2.0, rect.center().y), egui::Vec2::splat(close_w));
        let close_resp = ui.interact(close_rect, egui::Id::new(("terminal-close", term.id)), egui::Sense::click());
        crate::util::label_widget(&close_resp, egui::WidgetType::Button, "x");
        if close_resp.hovered() {
            ui.painter().rect_filled(close_rect, t.radius.small, t.button_hover);
        }
        crate::icons::paint(ui.painter(), close_rect.shrink(2.0), crate::icons::Icon::Close, if close_resp.hovered() { t.icon_active } else { t.text_dim });
        if close_resp.on_hover_text(if alive { "Close (kills the shell)" } else { "Close" }).clicked() {
            close = Some(i);
        } else if resp.clicked() {
            activate = Some(i);
        }
    }
    ui.add_space(2.0);
    let add = crate::layout::icon_button(ui, crate::icons::Icon::Plus, "+", "New terminal").clicked();
    if let Some(i) = activate {
        s.terminals.active = i;
        s.terminals.focus_pending = true;
    }
    if let Some(i) = close {
        s.terminals.close(i);
        if s.terminals.tabs.is_empty() {
            // Like IDEA: closing the last terminal hides the window; reopening starts a new one.
            s.layout.bottom = None;
            let ctx = ui.ctx().clone();
            focus_editor(s, &ctx);
            return;
        }
        s.terminals.focus_pending = true;
    }
    if add {
        new_terminal(s);
    }
}

/// Body of the Terminal tool window. Spawns the first shell when the window opens empty.
pub fn tool_window(s: &mut AppState, ui: &mut Ui) {
    if s.terminals.tabs.is_empty() {
        new_terminal(s);
        if s.terminals.tabs.is_empty() {
            ui.label(RichText::new("Could not start a shell. See Notifications.").color(theme::T.text_dim));
            return;
        }
    }

    let terms = &mut s.terminals;
    let active = terms.active.min(terms.tabs.len() - 1);
    terms.active = active;
    let tab = &mut terms.tabs[active];
    if !tab.term.is_alive() {
        let mut close_dead = false;
        ui.horizontal(|ui| {
            ui.label(RichText::new("[process exited]").color(theme::T.warning));
            close_dead = ui.small_button("Close").clicked();
        });
        if close_dead {
            terms.close(active);
            if terms.tabs.is_empty() {
                s.layout.bottom = None;
            }
            return;
        }
    }
    if let Some(text) = terms.pending_input.take() {
        tab.term.write(text.into_bytes());
        terms.dump_at = Some(std::time::Instant::now() + std::time::Duration::from_secs(3));
    }
    if let Some(at) = terms.dump_at {
        if std::time::Instant::now() >= at {
            terms.dump_at = None;
            eprintln!("[test] terminal screen (alt screen {}):\n{}", tab.term.is_alt_screen(), tab.term.screen_text().trim_end());
        } else {
            ui.ctx().request_repaint_after(std::time::Duration::from_millis(200));
        }
    }
    let r = TerminalView::new(&mut tab.term).id(tab.id).theme(theme::T.terminal.clone()).font_size(theme::T.font.mono).show(ui);
    if std::mem::take(&mut terms.focus_pending) {
        r.response.request_focus();
    }
    if let Some((path, line, col)) = r.open_path {
        // ide-term reports 1-based positions; the editor is 0-based.
        let pos = line.map(|l| Position::new(l.saturating_sub(1), col.unwrap_or(1).saturating_sub(1)));
        s.open_location(&path, pos, true);
    }
}

fn new_terminal(s: &mut AppState) {
    let cwd = s.project.as_ref().map(|p| p.root.clone()).or_else(|| std::env::var_os("HOME").map(PathBuf::from)).unwrap_or_else(|| PathBuf::from("/"));
    if let Err(e) = s.terminals.spawn(cwd, s.ctx.clone()) {
        s.notifications.error("Could not start a terminal", e.to_string());
    }
}

/// Opens a new terminal tab in `cwd` and shows the Terminal window ("Open In > Terminal").
pub fn open_at(s: &mut AppState, cwd: PathBuf) {
    s.layout.show(ToolWindow::Terminal);
    if let Err(e) = s.terminals.spawn(cwd, s.ctx.clone()) {
        s.notifications.error("Could not start a terminal", e.to_string());
    }
}

/// Test hook: opens the Terminal window and types `command` followed by Enter.
pub fn test_run(s: &mut AppState, command: String) {
    s.layout.show(ToolWindow::Terminal);
    s.terminals.focus_pending = true;
    s.terminals.pending_input = Some(format!("{command}\r"));
}
