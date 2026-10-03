//! `HARWEX_IDE_INPUT_LOG=<file>`: a recorder for input bugs the headless tests do not see.
//!
//! Each frame that carries pointer input writes one line: the egui input time, the wall clock,
//! how long the previous `update` ran, and the raw pointer events. The Project tree adds its
//! decision for the row under the pointer. Lines go to a writer thread, so the UI thread never
//! waits on the disk.

use std::fmt::Write as _;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::time::Instant;

use egui::Event;

pub struct InputLog {
    tx: Sender<String>,
    start: Instant,
    update_start: Option<Instant>,
    last_update_ms: f64,
    /// The line of the current frame, sent at the end of `update`.
    line: String,
    interesting: bool,
}

impl InputLog {
    /// The recorder from `HARWEX_IDE_INPUT_LOG`, or `None` when the variable is unset.
    pub fn from_env() -> Option<InputLog> {
        let path = PathBuf::from(std::env::var_os("HARWEX_IDE_INPUT_LOG").filter(|v| !v.is_empty())?);
        let mut file = match std::fs::File::create(&path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[harwex-ide] input log {}: {e}", path.display());
                return None;
            }
        };
        let (tx, rx) = channel::<String>();
        std::thread::Builder::new()
            .name("input-log".into())
            .spawn(move || {
                for line in rx {
                    let _ = writeln!(file, "{line}");
                    let _ = file.flush();
                }
            })
            .ok()?;
        let _ = tx.send(format!("# harwex-ide input log, pid {}", std::process::id()));
        Some(InputLog { tx, start: Instant::now(), update_start: None, last_update_ms: 0.0, line: String::new(), interesting: false })
    }

    /// Writes a line on its own, outside the per-frame line.
    pub fn note(&self, text: impl Into<String>) {
        let _ = self.tx.send(text.into());
    }

    /// `raw_input_hook`: the raw events of the frame, before egui sees them.
    pub fn raw(&mut self, raw: &egui::RawInput) {
        self.line.clear();
        self.interesting = false;
        let wall = self.start.elapsed().as_secs_f64();
        let _ = write!(self.line, "wall={wall:.3} t={:.3} prev_update_ms={:.1}", raw.time.unwrap_or(f64::NAN), self.last_update_ms);
        let mut moves = 0;
        let mut last_move = None;
        for e in &raw.events {
            match e {
                Event::PointerMoved(p) => {
                    moves += 1;
                    last_move = Some(*p);
                }
                Event::PointerButton { pos, button, pressed, modifiers } => {
                    self.interesting = true;
                    let _ = write!(self.line, " | {:?} {} at ({:.1},{:.1}){}", button, if *pressed { "down" } else { "up" }, pos.x, pos.y, if modifiers.is_none() { String::new() } else { format!(" {modifiers:?}") });
                }
                Event::PointerGone => {
                    self.interesting = true;
                    self.line.push_str(" | gone");
                }
                Event::WindowFocused(f) => {
                    self.interesting = true;
                    let _ = write!(self.line, " | focused={f}");
                }
                _ => {}
            }
        }
        if let Some(p) = last_move {
            let _ = write!(self.line, " | moved x{moves} to ({:.1},{:.1})", p.x, p.y);
        }
    }

    /// Start of `update`: egui's view of the pointer after it processed the raw events.
    pub fn begin(&mut self, ctx: &egui::Context) {
        self.update_start = Some(Instant::now());
        let delay = ctx.options(|o| o.input_options.max_double_click_delay);
        let clicks = crate::clicks::egui_click_kind(ctx);
        let focused = ctx.input(|i| i.focused);
        if !clicks.is_empty() {
            self.interesting = true;
            let _ = write!(self.line, " | egui: {clicks} (delay {delay:.3})");
        }
        if self.interesting {
            let _ = write!(self.line, " | window focused={focused}");
        }
    }

    /// The tree's decision for the row under the pointer this frame.
    pub fn tree(&mut self, text: std::fmt::Arguments) {
        self.interesting = true;
        let _ = write!(self.line, " | tree {text}");
    }

    /// End of `update`: sends the frame's line when it carried pointer input.
    pub fn end(&mut self) {
        if let Some(s) = self.update_start.take() {
            self.last_update_ms = s.elapsed().as_secs_f64() * 1000.0;
        }
        if self.interesting {
            let _ = self.tx.send(std::mem::take(&mut self.line));
        }
        self.interesting = false;
    }
}
