//! The Terminal tool window in the bottom strip, like IDEA's: a tab per shell, a "+" button,
//! Alt+F12 to toggle and focus, Escape to return focus to the editor (except on the alternate
//! screen, where vim and less need Escape).
//!
//! Keyboard routing: `shortcuts` runs first in `app::shortcuts`. While a terminal has focus it
//! returns `true`, and the app skips its other global shortcuts, so Cmd+W, Shift Shift and the
//! rest reach the shell instead. Only Alt+F12 and Escape are handled here.
//!
//! Tabs reorder by drag, like IDEA and Chrome: the dragged tab follows the pointer, the others
//! make room, the release commits. Escape or a release away from the strip cancels.
//!
//! A double click on a tab or "Rename Tab…" in its context menu edits the name inline: Enter
//! keeps it, Escape cancels, an empty name goes back to the shell's own title.
//!
//! Tabs persist per project (`terminal_store.rs`): count, order, names, working directories and
//! the active tab. A restored tab starts its shell when it is first shown. A change is saved
//! after `SAVE_DEBOUNCE`; the working directories are read again on every save, every eframe
//! auto-save, when the project closes and on exit.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use egui::{Context, Id, Key, Modifiers, RichText, Ui};
use ide_editor::Position;
use ide_term::{Terminal, TerminalView};

use crate::layout::ToolWindow;
use crate::state::AppState;
use crate::terminal_store::{SavedTab, SavedTerminals};
use crate::theme;
use crate::workspace::Workspace;

/// Quiet time after a tab change before the tabs are written.
const SAVE_DEBOUNCE: Duration = Duration::from_millis(300);
/// Width of a tab while its name is edited, so a short title still leaves room to type.
const RENAME_W: f32 = 160.0;

struct TermTab {
    /// `None` until the tab is first shown: a restored tab starts its shell lazily.
    term: Option<Terminal>,
    /// Widget id, stable for the life of the tab, so focus can be checked and requested.
    id: Id,
    /// The name the user gave the tab. `None` shows the shell's own title.
    name: Option<String>,
    /// The title of a restored tab until its shell starts: the shell's title at save time.
    saved_title: String,
    /// Where a lazily started shell starts.
    cwd: PathBuf,
}

impl TermTab {
    /// The shell's own title, or the saved one while the shell has not started.
    fn auto_title(&self) -> String {
        self.term.as_ref().map_or_else(|| self.saved_title.clone(), Terminal::title)
    }

    fn title(&self) -> String {
        self.name.clone().unwrap_or_else(|| self.auto_title())
    }

    /// A tab whose shell has not started yet counts as alive: it starts when shown.
    fn is_alive(&self) -> bool {
        self.term.as_ref().is_none_or(Terminal::is_alive)
    }

    fn saved(&self) -> SavedTab {
        let cwd = match &self.term {
            Some(t) => t.current_dir().unwrap_or_else(|| t.cwd().to_path_buf()),
            None => self.cwd.clone(),
        };
        SavedTab { name: self.name.clone(), title: self.auto_title(), cwd: Some(cwd) }
    }
}

/// The inline name editor of one tab.
struct Rename {
    /// The tab's widget id.
    tab: Id,
    text: String,
    /// Focus the text box and select its text on the next draw.
    focus: bool,
    /// Enter (true) or Escape (false) arrived; the box ends after this frame's typing.
    done: Option<bool>,
}

impl Rename {
    fn edit_id(&self) -> Id {
        self.tab.with("rename")
    }
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
    /// The tab being dragged to a new place in the strip.
    drag: Option<TabDrag>,
    /// The tab whose name is being edited.
    rename: Option<Rename>,
    /// The project's saved tabs are being read; the window starts no shell meanwhile.
    loading: bool,
    /// Tab changes are saved: a store is set, a project is open and its saved tabs were read.
    persist: bool,
    /// When the debounced save runs.
    save_due: Option<Instant>,
    /// What the last save wrote, so an unchanged list is not written again.
    last_saved: Option<SavedTerminals>,
    /// A failed save warned once already.
    save_failed: bool,
}

/// A tab drag in progress. The tab is found by its widget id, so the drag survives a tab that
/// closes or opens meanwhile.
struct TabDrag {
    id: Id,
    /// Pointer x minus the tab's left edge at the press, so the tab does not jump under the pointer.
    grab: f32,
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

    /// The terminal of tab `index`, for tests that read the screen or the shell state. `None`
    /// also for a restored tab whose shell has not started yet.
    pub fn terminal(&self, index: usize) -> Option<&Terminal> {
        self.tabs.get(index).and_then(|t| t.term.as_ref())
    }

    /// True when tab `index` runs its shell (restored tabs start theirs when first shown).
    pub fn is_started(&self, index: usize) -> bool {
        self.tabs.get(index).is_some_and(|t| t.term.is_some())
    }

    /// The name the user gave tab `index`.
    pub fn name(&self, index: usize) -> Option<&str> {
        self.tabs.get(index).and_then(|t| t.name.as_deref())
    }

    /// The title tab `index` shows: its name, else the shell's title.
    pub fn title(&self, index: usize) -> Option<String> {
        self.tabs.get(index).map(TermTab::title)
    }

    /// True while the project's saved tabs are being read.
    pub fn is_loading(&self) -> bool {
        self.loading
    }

    /// True while the inline name editor is open.
    pub fn is_renaming(&self) -> bool {
        self.rename.is_some()
    }

    /// A tab change waits for its debounced save.
    pub fn save_pending(&self) -> bool {
        self.save_due.is_some()
    }

    /// The tabs as the store keeps them, with the shells' current working directories.
    fn snapshot(&self) -> SavedTerminals {
        SavedTerminals { tabs: self.tabs.iter().map(TermTab::saved).collect(), active: self.active.min(self.tabs.len().saturating_sub(1)) }
    }

    /// Schedules a save of the tab list.
    fn changed(&mut self) {
        if self.persist {
            self.save_due = Some(Instant::now() + SAVE_DEBOUNCE);
        }
    }

    /// The egui id of tab `index`'s widget.
    pub fn widget_id(&self, index: usize) -> Option<Id> {
        self.tabs.get(index).map(|t| t.id)
    }

    /// True when the focused terminal runs a program on the alternate screen.
    fn focused_is_alt_screen(&self, ctx: &Context) -> bool {
        let Some(focused) = ctx.memory(|m| m.focused()) else { return false };
        self.tabs.iter().any(|t| t.id == focused && t.term.as_ref().is_some_and(Terminal::is_alt_screen))
    }

    /// Pids of the running shells, for the memory indicator, which leaves their subtrees out.
    pub fn shell_pids(&self) -> impl Iterator<Item = u32> + Clone + '_ {
        self.tabs.iter().filter_map(|t| t.term.as_ref().and_then(Terminal::process_id))
    }

    /// Kills every shell. Called on app exit. The tabs stay, so a later save still lists them.
    pub fn kill_all(&mut self) {
        for t in &mut self.tabs {
            if let Some(term) = &mut t.term {
                term.kill();
            }
        }
    }

    fn launch(&self, cwd: &Path, ctx: Context) -> std::io::Result<Terminal> {
        match &self.command {
            Some(c) => {
                let mut options = ide_term::SpawnOptions::new(cwd);
                options.command = Some(c.argv.clone());
                options.env = c.env.clone();
                Terminal::spawn_with(options, ctx)
            }
            None => Terminal::spawn(cwd, ctx),
        }
    }

    fn new_tab(&mut self, term: Option<Terminal>, name: Option<String>, saved_title: String, cwd: PathBuf) {
        self.next_serial += 1;
        self.tabs.push(TermTab { term, id: crate::workspace::wid(("terminal-tab", self.next_serial)), name, saved_title, cwd });
    }

    fn spawn(&mut self, cwd: PathBuf, ctx: Context) -> std::io::Result<()> {
        let term = self.launch(&cwd, ctx)?;
        self.new_tab(Some(term), None, String::new(), cwd);
        self.active = self.tabs.len() - 1;
        self.focus_pending = true;
        self.changed();
        Ok(())
    }

    /// Starts the shell of a restored tab.
    fn start(&mut self, index: usize, ctx: Context) -> std::io::Result<()> {
        let Some(tab) = self.tabs.get(index) else { return Ok(()) };
        if tab.term.is_some() {
            return Ok(());
        }
        let term = self.launch(&tab.cwd, ctx)?;
        self.tabs[index].term = Some(term);
        Ok(())
    }

    /// Appends the saved tabs of the project. Their shells start when they are first shown.
    fn apply_saved(&mut self, saved: SavedTerminals, root: &Path) {
        let fresh = self.tabs.is_empty();
        for tab in &saved.tabs {
            let cwd = tab.cwd.clone().unwrap_or_else(|| root.to_path_buf());
            self.new_tab(None, tab.name.clone(), tab.title.clone(), cwd);
        }
        if fresh {
            self.active = saved.active.min(self.tabs.len().saturating_sub(1));
            self.last_saved = Some(saved);
        } else {
            // Shells started before the list was read stay in front; the joined list is new.
            self.changed();
        }
    }

    fn start_rename(&mut self, index: usize) {
        if let Some(tab) = self.tabs.get(index) {
            self.rename = Some(Rename { tab: tab.id, text: tab.title(), focus: true, done: None });
        }
    }

    /// Ends the inline rename. `keep` stores the edited name; an empty one clears the name.
    fn finish_rename(&mut self, keep: bool) {
        let Some(r) = self.rename.take() else { return };
        self.focus_pending = true;
        if !keep {
            return;
        }
        let Some(tab) = self.tabs.iter_mut().find(|t| t.id == r.tab) else { return };
        let text = r.text.trim();
        let name = (!text.is_empty()).then(|| text.to_string());
        if tab.name != name {
            tab.name = name;
            self.changed();
        }
    }

    /// True while a tab is being dragged.
    pub fn is_dragging_tab(&self) -> bool {
        self.drag.is_some()
    }

    /// Moves tab `from` to `to` (both indices into the current order). The shell keeps running;
    /// the moved tab becomes the active one.
    fn move_tab(&mut self, from: usize, to: usize) {
        if from >= self.tabs.len() {
            return;
        }
        let tab = self.tabs.remove(from);
        let to = to.min(self.tabs.len());
        self.tabs.insert(to, tab);
        self.active = to;
        self.changed();
    }

    fn activate(&mut self, index: usize) {
        if self.active != index {
            self.active = index;
            self.changed();
        }
        self.focus_pending = true;
    }

    fn close(&mut self, index: usize) {
        if index >= self.tabs.len() {
            return;
        }
        let tab = self.tabs.remove(index);
        if let Some(mut term) = tab.term {
            term.kill();
        }
        if self.rename.as_ref().is_some_and(|r| r.tab == tab.id) {
            self.rename = None;
        }
        if self.active > index || self.active >= self.tabs.len() {
            self.active = self.active.saturating_sub(1);
        }
        // Closing the last tab saves an empty list, so the window stays empty after a restart.
        self.changed();
    }
}

/// Reads the saved tabs of the project just installed in the workspace in context. Until the
/// answer arrives the Terminal window starts no shell, so a restored list is not doubled.
pub(crate) fn restore(s: &mut AppState, root: PathBuf) {
    let terms = &mut s.ws.terminals;
    terms.persist = false;
    terms.save_due = None;
    terms.last_saved = None;
    let Some(store) = s.terminal_store.clone() else { return };
    terms.loading = true;
    let generation = s.project_generation();
    let reply = store.load(root.clone());
    s.jobs.spawn_quiet(
        move || {
            let mut saved = reply.recv().unwrap_or_else(|_| Err("the terminal store stopped".into()))?;
            // A folder that is gone falls back to the project root when the shell starts.
            for tab in saved.iter_mut().flat_map(|s| s.tabs.iter_mut()) {
                if tab.cwd.as_ref().is_some_and(|c| !c.is_dir()) {
                    tab.cwd = None;
                }
            }
            Ok::<_, String>(saved)
        },
        move |state, res| {
            if state.project_generation() != generation {
                return;
            }
            let terms = &mut state.ws.terminals;
            terms.loading = false;
            terms.persist = true;
            match res {
                Ok(Some(saved)) => terms.apply_saved(saved, &root),
                Ok(None) => {}
                Err(e) => state.notifications.warn("Terminal tabs were not restored", e),
            }
        },
    );
}

/// Runs a due debounced save of the workspace in context.
pub(crate) fn tick(s: &mut AppState) {
    let Some(due) = s.ws.terminals.save_due else { return };
    let now = Instant::now();
    if now < due {
        s.ctx.request_repaint_after(due - now);
        return;
    }
    save_now(s);
}

/// Saves the tabs of the workspace in context when they differ from the last save. The
/// working directories are read now.
fn save_now(s: &mut AppState) {
    s.ws.terminals.save_due = None;
    let (Some(store), Some(project)) = (&s.terminal_store, &s.ws.project) else { return };
    let terms = &mut s.ws.terminals;
    if !terms.persist {
        return;
    }
    let saved = terms.snapshot();
    if terms.last_saved.as_ref() == Some(&saved) {
        return;
    }
    let reply = store.save(project.root.clone(), saved.clone());
    terms.last_saved = Some(saved);
    s.jobs.spawn_quiet(
        move || reply.recv().unwrap_or_else(|_| Err("the terminal store stopped".into())),
        |state, res| {
            if let Err(e) = res {
                // Every tab change saves; one toast is enough.
                state.ws.terminals.last_saved = None;
                if !std::mem::replace(&mut state.ws.terminals.save_failed, true) {
                    state.notifications.warn("Terminal tabs were not saved", e);
                } else {
                    state.notifications.log_only(crate::notifications::Level::Warning, "Terminal tabs were not saved", e);
                }
            }
        },
    );
}

/// Saves the tabs of every workspace (eframe's periodic save). A shell's `cd` changes no tab,
/// so this is what keeps the working directories fresh.
pub fn save_all(s: &mut AppState) {
    let ids: Vec<_> = s.all_ws().map(|w| w.id).collect();
    for id in ids {
        s.with_ws(id, save_now);
    }
}

/// Saves every workspace's tabs and waits for the store to write them. Blocks for at most two
/// seconds; call it on exit, before the shells are killed.
pub fn flush_on_exit(s: &mut AppState) {
    save_all(s);
    if let Some(store) = &s.terminal_store {
        if !store.flush(Duration::from_secs(2)) {
            eprintln!("[harwex-ide] terminal tabs: the store did not finish writing");
        }
    }
}

/// Saves the tabs of a workspace that is closing, before its shells stop. Nobody waits for the
/// answer: the workspace is gone, and requests to the store run in order.
pub(crate) fn save_closed(s: &AppState, ws: &Workspace) {
    let (Some(store), Some(project)) = (&s.terminal_store, &ws.project) else { return };
    if !ws.terminals.persist {
        return;
    }
    let saved = ws.terminals.snapshot();
    if ws.terminals.last_saved.as_ref() != Some(&saved) {
        drop(store.save(project.root.clone(), saved));
    }
}

/// Handles Alt+F12 and Escape. Returns true when a terminal has focus; the caller then skips
/// its own global shortcuts.
pub fn shortcuts(s: &mut AppState, ctx: &Context) -> bool {
    // The inline rename box owns Enter and Escape; nothing else may act on them.
    if let Some(r) = s.ws.terminals.rename.as_mut() {
        if ctx.memory(|m| m.has_focus(r.edit_id())) {
            let (enter, escape) = ctx.input_mut(|i| (i.consume_key(Modifiers::NONE, Key::Enter), i.consume_key(Modifiers::NONE, Key::Escape)));
            // A fast typist's frame holds the last letters and Enter: the box takes the
            // letters first, and `header_tabs` ends the rename after it.
            if enter || escape {
                r.done = Some(enter);
            }
            return true;
        }
    }
    let focused = s.ws.terminals.has_focus(ctx);
    if s.ws.terminals.drag.is_some() && ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Escape)) {
        // The tab goes back to its place; egui must forget the drag too, or the release drops it.
        s.ws.terminals.drag = None;
        ctx.stop_dragging();
        return focused;
    }
    let toggle = ctx.input_mut(|i| i.consume_key(Modifiers::ALT, Key::F12));
    if toggle {
        if s.ws.layout.bottom != Some(ToolWindow::Terminal) {
            s.ws.layout.show(ToolWindow::Terminal);
            s.ws.terminals.focus_pending = true;
        } else if focused {
            s.ws.layout.bottom = None;
            focus_editor(s, ctx);
        } else {
            s.ws.terminals.focus_pending = true;
        }
        return true;
    }
    // vim, less and htop run on the alternate screen and need Escape themselves.
    if focused && !s.ws.terminals.focused_is_alt_screen(ctx) && ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Escape)) {
        focus_editor(s, ctx);
    }
    focused
}

/// Moves keyboard focus to the active editor, or drops it when no editor is open.
pub(crate) fn focus_editor(s: &mut AppState, ctx: &Context) {
    if let Some(e) = s.ws.tabs.active_editor_mut() {
        e.view.request_focus();
        return;
    }
    if let Some(id) = ctx.memory(|m| m.focused()) {
        ctx.memory_mut(|m| m.surrender_focus(id));
    }
}

/// The terminal tabs in the tool window header, like IDEA: one flat tab per shell with its
/// close button, then "+". A tab drag moves the tab inside the strip.
pub fn header_tabs(s: &mut AppState, ui: &mut Ui) {
    let t = &theme::T;
    const GAP: f32 = 2.0;
    const CLOSE_W: f32 = 16.0;
    ui.spacing_mut().item_spacing.x = GAP;
    let clicks = s.clicks;
    let terms = &mut s.ws.terminals;
    if terms.rename.as_ref().is_some_and(|r| !terms.tabs.iter().any(|tab| tab.id == r.tab)) {
        terms.rename = None;
    }

    // Measure every tab first: a drag needs the whole strip to place the others.
    let tabs: Vec<_> = terms
        .tabs
        .iter()
        .enumerate()
        .map(|(i, term)| {
            let mut title = term.title();
            if title.chars().count() > 32 {
                title = format!("{}...", title.chars().take(30).collect::<String>());
            }
            let alive = term.is_alive();
            let active = i == terms.active;
            let color = match (active, alive) {
                (_, false) => t.text_dim,
                (true, true) => t.text_bright,
                (false, true) => t.text,
            };
            let galley = ui.painter().layout_no_wrap(title.clone(), t.small_font(), color);
            let mut width = 10.0 + galley.size().x + 4.0 + CLOSE_W + 6.0;
            if terms.rename.as_ref().is_some_and(|r| r.tab == term.id) {
                width = width.max(RENAME_W);
            }
            (term.id, title, alive, active, color, galley, width)
        })
        .collect();
    let total = tabs.iter().map(|tab| tab.6).sum::<f32>() + GAP * tabs.len().saturating_sub(1) as f32;
    let (strip, _) = ui.allocate_exact_size(egui::vec2(total, 24.0), egui::Sense::hover());

    // The drag preview: where the dragged tab floats and which slot it would drop into.
    let dragged = terms.drag.as_ref().and_then(|d| tabs.iter().position(|tab| tab.0 == d.id).map(|i| (i, d.grab)));
    if terms.drag.is_some() && dragged.is_none() {
        terms.drag = None;
    }
    let pointer = ui.ctx().pointer_latest_pos();
    let preview = dragged.map(|(d, grab)| {
        let w = tabs[d].6;
        let over_strip = pointer.is_some_and(|p| drop_zone(strip).contains(p));
        match pointer.filter(|_| over_strip) {
            Some(p) => {
                let left = (p.x - grab).clamp(strip.min.x, (strip.max.x - w).max(strip.min.x));
                // The slot is the number of other tabs whose middle lies left of the dragged tab's.
                let mut x = strip.min.x;
                let mut slot = 0;
                for (i, tab) in tabs.iter().enumerate() {
                    if i == d {
                        continue;
                    }
                    if x + tab.6 / 2.0 < left + w / 2.0 {
                        slot += 1;
                    }
                    x += tab.6 + GAP;
                }
                (d, slot, Some(left))
            }
            // Away from the strip a release cancels: show the tab back in its place.
            None => (d, d, None),
        }
    });

    // Display order: the tabs without the dragged one, with it put back at its slot.
    let mut order: Vec<usize> = (0..tabs.len()).collect();
    if let Some((d, slot, _)) = preview {
        order.remove(d);
        order.insert(slot, d);
    }
    let mut activate = None;
    let mut close = None;
    let mut rename = None;
    let mut rename_done = None;
    let mut drop = None;
    let mut floating = None;
    let mut x = strip.min.x;
    for &i in &order {
        let (id, title, alive, active, color, galley, width) = &tabs[i];
        let slot_rect = egui::Rect::from_min_size(egui::pos2(x, strip.min.y), egui::vec2(*width, strip.height()));
        x += width + GAP;
        let is_dragged = preview.is_some_and(|(d, ..)| d == i);
        let rect = match preview {
            Some((_, _, Some(left))) if is_dragged => slot_rect.translate(egui::vec2(left - slot_rect.min.x, 0.0)),
            _ => slot_rect,
        };
        let resp = ui.interact(rect, id.with("tab"), egui::Sense::click_and_drag());
        crate::util::label_selectable(&resp, title.clone(), *active);
        let close_rect = egui::Rect::from_center_size(egui::pos2(rect.max.x - 6.0 - CLOSE_W / 2.0, rect.center().y), egui::Vec2::splat(CLOSE_W));
        let close_resp = ui.interact(close_rect, id.with("close"), egui::Sense::click());
        crate::util::label_widget(&close_resp, egui::WidgetType::Button, "x");
        let renaming = terms.rename.as_ref().is_some_and(|r| r.tab == *id);
        resp.context_menu(|ui| {
            if ui.button("Rename Tab…").clicked() {
                rename = Some(i);
                ui.close_menu();
            }
            if ui.button("Close Tab").clicked() {
                close = Some(i);
                ui.close_menu();
            }
        });

        if resp.drag_started() && terms.drag.is_none() {
            let press = ui.input(|inp| inp.pointer.press_origin()).or(pointer).unwrap_or(rect.min);
            terms.drag = Some(TabDrag { id: *id, grab: press.x - rect.min.x });
        }
        if is_dragged {
            if resp.drag_stopped() {
                drop = preview.and_then(|(d, slot, left)| left.map(|_| (d, slot)));
                terms.drag = None;
            } else if !ui.ctx().is_being_dragged(resp.id) {
                terms.drag = None;
            }
        }

        let hovered = resp.hovered() && terms.drag.is_none();
        let close_hovered = close_resp.hovered() && terms.drag.is_none();
        let paint = move |painter: &egui::Painter| {
            if is_dragged {
                painter.rect_filled(rect, t.radius.button, t.tab_active_bg);
                painter.rect_stroke(rect, t.radius.button, egui::Stroke::new(1.0_f32, t.drop_target_border), egui::StrokeKind::Inside);
            } else if *active {
                painter.rect_filled(rect, t.radius.button, t.tab_active_bg);
            } else if hovered {
                painter.rect_filled(rect, t.radius.button, t.hover);
            }
            if !renaming {
                painter.galley(egui::pos2(rect.min.x + 10.0, rect.center().y - galley.size().y / 2.0), galley.clone(), *color);
            }
            if close_hovered {
                painter.rect_filled(close_rect, t.radius.small, t.button_hover);
            }
            crate::icons::paint(painter, close_rect.shrink(2.0), crate::icons::Icon::Close, if close_hovered { t.icon_active } else { t.text_dim });
        };
        if is_dragged {
            // Painted after the others, so it slides over them.
            floating = Some(paint);
        } else {
            paint(ui.painter());
        }
        // After the tab's background, which would cover the box.
        if renaming {
            let edit_rect = egui::Rect::from_min_max(egui::pos2(rect.min.x + 4.0, rect.min.y + 2.0), egui::pos2(close_rect.min.x - 4.0, rect.max.y - 2.0));
            let r = terms.rename.as_mut().expect("renaming");
            let edit_id = r.edit_id();
            let mut child = ui.new_child(egui::UiBuilder::new().max_rect(edit_rect).layout(egui::Layout::left_to_right(egui::Align::Center)));
            let mut out = egui::TextEdit::singleline(&mut r.text)
                .id(edit_id)
                .font(t.small_font())
                .desired_width(edit_rect.width())
                .margin(egui::Margin::symmetric(4, 2))
                .show(&mut child);
            // egui drops the focus on Escape at the start of the next frame, before `shortcuts`
            // sees the key, unless the focus filter keeps Escape. The box would then take the
            // lost focus for a click away. TextEdit sets its own filter while focused, so this
            // goes after `show`.
            if out.response.has_focus() {
                let filter = egui::EventFilter { horizontal_arrows: true, vertical_arrows: true, escape: true, ..Default::default() };
                ui.memory_mut(|m| m.set_focus_lock_filter(edit_id, filter));
            }
            crate::util::label_widget(&out.response, egui::WidgetType::TextEdit, "Tab name");
            if std::mem::take(&mut r.focus) {
                out.response.request_focus();
                let all = egui::text::CCursorRange::two(egui::text::CCursor::new(0), egui::text::CCursor::new(r.text.chars().count()));
                out.state.cursor.set_char_range(Some(all));
                out.state.store(ui.ctx(), edit_id);
            } else if let Some(keep) = r.done {
                rename_done = Some(keep);
            } else if out.response.lost_focus() {
                // A click elsewhere keeps the name.
                rename_done = Some(true);
            }
        }
        if terms.drag.is_some() || drop.is_some() {
            continue;
        }
        if close_resp.on_hover_text(if *alive { "Close (kills the shell)" } else { "Close" }).clicked() {
            close = Some(i);
        } else if resp.clicked() {
            activate = Some(i);
            if clicks.double(&resp) {
                rename = Some(i);
            }
        }
    }
    if let Some(paint) = floating {
        paint(ui.painter());
    }
    if terms.drag.is_some() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::Grabbing);
    }
    ui.add_space(2.0);
    let add = crate::layout::icon_button(ui, crate::icons::Icon::Plus, "+", "New terminal").clicked();
    if let Some(keep) = rename_done {
        terms.finish_rename(keep);
    }
    if let Some((from, to)) = drop {
        terms.move_tab(from, to);
        terms.focus_pending = true;
    }
    if let Some(i) = activate {
        terms.activate(i);
    }
    if let Some(i) = rename {
        terms.start_rename(i);
    }
    if let Some(i) = close {
        terms.close(i);
        if terms.tabs.is_empty() {
            // Like IDEA: closing the last terminal hides the window; reopening starts a new one.
            s.ws.layout.bottom = None;
            let ctx = ui.ctx().clone();
            focus_editor(s, &ctx);
            return;
        }
        terms.focus_pending = true;
    }
    if add {
        new_terminal(s);
    }
}

/// Where a dragged tab may be released to land in the strip: the strip plus a margin, so a
/// slightly low release still counts. Further away, the release cancels the drag.
fn drop_zone(strip: egui::Rect) -> egui::Rect {
    strip.expand2(egui::vec2(24.0, 12.0))
}

/// Body of the Terminal tool window. Spawns the first shell when the window opens empty.
pub fn tool_window(s: &mut AppState, ui: &mut Ui) {
    if s.ws.terminals.loading {
        // The saved tabs arrive in a moment (the job's callback repaints).
        return;
    }
    if s.ws.terminals.tabs.is_empty() {
        new_terminal(s);
        if s.ws.terminals.tabs.is_empty() {
            ui.label(RichText::new("Could not start a shell. See Notifications.").color(theme::T.text_dim));
            return;
        }
    }

    let active = s.ws.terminals.active.min(s.ws.terminals.tabs.len() - 1);
    s.ws.terminals.active = active;
    // A restored tab starts its shell the first time it is shown.
    if let Err(e) = s.ws.terminals.start(active, s.ctx.clone()) {
        s.notifications.error("Could not start a terminal", e.to_string());
        s.ws.terminals.close(active);
        if s.ws.terminals.tabs.is_empty() {
            s.ws.layout.bottom = None;
        }
        return;
    }
    let terms = &mut s.ws.terminals;
    if !terms.tabs[active].is_alive() {
        let mut close_dead = false;
        ui.horizontal(|ui| {
            ui.label(RichText::new("[process exited]").color(theme::T.warning));
            close_dead = ui.small_button("Close").clicked();
        });
        if close_dead {
            terms.close(active);
            if terms.tabs.is_empty() {
                s.ws.layout.bottom = None;
            }
            return;
        }
    }
    let tab = &mut terms.tabs[active];
    let Some(term) = tab.term.as_mut() else { return };
    if let Some(text) = terms.pending_input.take() {
        term.write(text.into_bytes());
        terms.dump_at = Some(std::time::Instant::now() + std::time::Duration::from_secs(3));
    }
    if let Some(at) = terms.dump_at {
        if std::time::Instant::now() >= at {
            terms.dump_at = None;
            eprintln!("[test] terminal screen (alt screen {}):\n{}", term.is_alt_screen(), term.screen_text().trim_end());
        } else {
            ui.ctx().request_repaint_after(std::time::Duration::from_millis(200));
        }
    }
    let r = TerminalView::new(term).id(tab.id).theme(theme::T.terminal.clone()).font_size(theme::T.font.mono).show(ui);
    if std::mem::take(&mut terms.focus_pending) {
        r.response.request_focus();
    }
    if let Some((path, line, col)) = r.open_path {
        // ide-term reports 1-based positions; the editor is 0-based.
        let pos = line.map(|l| Position::new(l.saturating_sub(1), col.unwrap_or(1).saturating_sub(1)));
        s.open_location(&path, pos, true);
    }
    if let Some(url) = r.open_url {
        open_url(s, url);
    }
}

/// Opens a Cmd+clicked URL in the default browser. `open` can take a moment, so it runs on a
/// worker. A terminal program controls OSC 8 URIs, so only http, https, file and mailto pass.
fn open_url(s: &mut AppState, url: String) {
    if !ide_term::is_openable_url(&url) {
        return;
    }
    let platform = s.platform.clone();
    s.jobs.spawn_quiet(
        move || platform.open_url(&url),
        |state, res| {
            if let Err(e) = res {
                state.notifications.error("Cannot open the link", e);
            }
        },
    );
}

fn new_terminal(s: &mut AppState) {
    let cwd = s.ws.project.as_ref().map(|p| p.root.clone()).or_else(|| std::env::var_os("HOME").map(PathBuf::from)).unwrap_or_else(|| PathBuf::from("/"));
    if let Err(e) = s.ws.terminals.spawn(cwd, s.ctx.clone()) {
        s.notifications.error("Could not start a terminal", e.to_string());
    }
}

/// Opens a new terminal tab in `cwd` and shows the Terminal window ("Open In > Terminal").
pub fn open_at(s: &mut AppState, cwd: PathBuf) {
    s.ws.layout.show(ToolWindow::Terminal);
    if let Err(e) = s.ws.terminals.spawn(cwd, s.ctx.clone()) {
        s.notifications.error("Could not start a terminal", e.to_string());
    }
}

/// Test hook: opens the Terminal window and types `command` followed by Enter.
pub fn test_run(s: &mut AppState, command: String) {
    s.ws.layout.show(ToolWindow::Terminal);
    s.ws.terminals.focus_pending = true;
    s.ws.terminals.pending_input = Some(format!("{command}\r"));
}
