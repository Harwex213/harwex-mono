//! IDEA-style notifications: a toast in the bottom-right corner plus a log in the
//! Notifications tool window. Call from the UI thread, or through `Jobs::post` from a worker.

use std::time::{Duration, Instant};

use egui::{Align2, Color32, Context, Frame, Id, Margin, RichText, ScrollArea, Stroke, Ui};

use crate::theme;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug)]
pub struct Notification {
    pub level: Level,
    pub title: String,
    /// Details, e.g. a git command's stderr. Shown in monospace.
    pub body: String,
    pub time: Instant,
}

struct Toast {
    id: u64,
    note: Notification,
    shown: Instant,
    expanded: bool,
}

#[derive(Default)]
pub struct Notifications {
    log: Vec<Notification>,
    toasts: Vec<Toast>,
    next_id: u64,
    /// Entries added since the Notifications tool window was last shown.
    pub unread: usize,
    /// Toasts never time out and the log shows no ages (snapshot tests).
    pub frozen: bool,
}

const MAX_LOG: usize = 500;
const MAX_TOASTS: usize = 4;

impl Notifications {
    pub fn info(&mut self, title: impl Into<String>, body: impl Into<String>) {
        self.push(Level::Info, title.into(), body.into());
    }

    pub fn warn(&mut self, title: impl Into<String>, body: impl Into<String>) {
        self.push(Level::Warning, title.into(), body.into());
    }

    pub fn error(&mut self, title: impl Into<String>, body: impl Into<String>) {
        self.push(Level::Error, title.into(), body.into());
    }

    /// Adds to the log only, without a toast. For chatty but useful events.
    pub fn log_only(&mut self, level: Level, title: impl Into<String>, body: impl Into<String>) {
        let note = Notification { level, title: title.into(), body: body.into(), time: Instant::now() };
        self.add_log(note);
    }

    pub fn push(&mut self, level: Level, title: String, body: String) {
        let note = Notification { level, title, body, time: Instant::now() };
        self.next_id += 1;
        self.toasts.push(Toast { id: self.next_id, note: note.clone(), shown: Instant::now(), expanded: false });
        if self.toasts.len() > MAX_TOASTS {
            self.toasts.remove(0);
        }
        self.add_log(note);
    }

    fn add_log(&mut self, note: Notification) {
        self.log.push(note);
        if self.log.len() > MAX_LOG {
            self.log.remove(0);
        }
        self.unread += 1;
    }

    pub fn log(&self) -> &[Notification] {
        &self.log
    }

    pub fn clear(&mut self) {
        self.log.clear();
        self.unread = 0;
    }

    /// Closes every toast; the log keeps them.
    pub fn dismiss_toasts(&mut self) {
        self.toasts.clear();
    }

    /// Titles of the visible toasts, oldest first.
    pub fn toast_titles(&self) -> Vec<String> {
        self.toasts.iter().map(|t| t.note.title.clone()).collect()
    }

    /// Draws the toasts above the status bar. Errors stay longer, because their text matters.
    pub fn show_toasts(&mut self, ctx: &Context, bottom_offset: f32) {
        let now = Instant::now();
        let frozen = self.frozen;
        self.toasts.retain(|t| frozen || t.expanded || now.duration_since(t.shown) < life(t.note.level));
        let mut offset = bottom_offset + 8.0;
        let mut close = Vec::new();
        for toast in self.toasts.iter_mut().rev() {
            let resp = egui::Area::new(Id::new(("toast", toast.id)))
                .anchor(Align2::RIGHT_BOTTOM, [-12.0, -offset])
                .order(egui::Order::Foreground)
                .show(ctx, |ui| {
                    Frame::popup(ui.style())
                        .fill(theme::T.popup_bg)
                        .stroke(Stroke::new(1.0_f32, if toast.note.level == Level::Info { theme::T.popup_border } else { level_color(toast.note.level) }))
                        .corner_radius(egui::CornerRadius::same(theme::T.radius.popup as u8))
                        .inner_margin(Margin::same(12))
                        .show(ui, |ui| {
                            ui.set_max_width(380.0);
                            ui.horizontal(|ui| {
                                ui.label(RichText::new(&toast.note.title).strong().color(level_color(toast.note.level)));
                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
                                    if crate::layout::icon_button(ui, crate::icons::Icon::Close, "x", "").clicked() {
                                        close.push(toast.id);
                                    }
                                });
                            });
                            if !toast.note.body.is_empty() {
                                let body = toast.note.body.trim_end();
                                let long = body.lines().count() > 6 || body.len() > 500;
                                if long && !toast.expanded {
                                    let short: String = body.lines().take(6).collect::<Vec<_>>().join("\n");
                                    ui.label(RichText::new(short).monospace().size(theme::T.font.tiny));
                                    if ui.link("Show more").clicked() {
                                        toast.expanded = true;
                                    }
                                } else {
                                    ScrollArea::vertical().max_height(260.0).show(ui, |ui| {
                                        ui.label(RichText::new(body).monospace().size(theme::T.font.tiny));
                                    });
                                }
                            }
                        });
                });
            if resp.response.hovered() {
                // Keep a toast alive while the user reads it.
                toast.shown = now;
            }
            offset += resp.response.rect.height() + 8.0;
        }
        self.toasts.retain(|t| !close.contains(&t.id));
        if !self.toasts.is_empty() && !self.frozen {
            ctx.request_repaint_after(Duration::from_millis(500));
        }
    }

    /// The Notifications tool window body.
    pub fn show_log(&mut self, ui: &mut Ui) {
        self.unread = 0;
        // The island header already says "Notifications".
        if ui.small_button("Clear").clicked() {
            self.log.clear();
        }
        ui.add_space(2.0);
        ScrollArea::vertical().auto_shrink([false, false]).stick_to_bottom(true).show(ui, |ui| {
            for note in &self.log {
                let ago = if self.frozen { String::new() } else { format!("{:>4}s ago", note.time.elapsed().as_secs()) };
                ui.horizontal_wrapped(|ui| {
                    ui.label(RichText::new(ago).weak().monospace().size(theme::T.font.tiny));
                    ui.label(RichText::new(&note.title).color(level_color(note.level)));
                });
                if !note.body.is_empty() {
                    ui.label(RichText::new(note.body.trim_end()).monospace().size(theme::T.font.tiny).color(theme::T.text_dim));
                }
            }
        });
    }
}

fn life(level: Level) -> Duration {
    match level {
        Level::Info => Duration::from_secs(6),
        Level::Warning => Duration::from_secs(10),
        Level::Error => Duration::from_secs(15),
    }
}

pub fn level_color(level: Level) -> Color32 {
    match level {
        Level::Info => theme::T.text,
        Level::Warning => theme::T.warning,
        Level::Error => theme::T.error,
    }
}
