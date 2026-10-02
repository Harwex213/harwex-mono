//! One terminal in a window: `cargo run -p ide-term --release --example term [dir]`.
//!
//! Hooks for unattended checks:
//! - `HARWEX_TERM_CMD="..."` runs the command in the login shell, then leaves an interactive
//!   shell open.
//! - `HARWEX_TERM_STATS=1` prints frame timings and parse throughput once per second.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use eframe::egui;
use ide_term::{SpawnOptions, Terminal, TerminalView};

struct App {
    term: Terminal,
    title: String,
    focused_once: bool,
    stats: Option<Stats>,
}

struct Stats {
    window_start: Instant,
    last_frame: Instant,
    frames: u32,
    worst_gap: Duration,
    worst_update: Duration,
    bytes_at_start: u64,
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let started = Instant::now();
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE)
            .show(ctx, |ui| {
                let response = TerminalView::new(&mut self.term).font_size(13.0).show(ui);
                if !self.focused_once {
                    response.response.request_focus();
                    self.focused_once = true;
                }
                if let Some((path, line, column)) = response.open_path {
                    eprintln!("open {} line {line:?} column {column:?}", path.display());
                }
            });
        let title = self.term.title();
        if title != self.title {
            ctx.send_viewport_cmd(egui::ViewportCommand::Title(title.clone()));
            self.title = title;
        }

        if let Some(stats) = &mut self.stats {
            let now = Instant::now();
            stats.frames += 1;
            stats.worst_gap = stats.worst_gap.max(now - stats.last_frame);
            stats.worst_update = stats.worst_update.max(now - started);
            stats.last_frame = now;
            let elapsed = now - stats.window_start;
            if elapsed >= Duration::from_secs(1) {
                let bytes = self.term.bytes_processed();
                eprintln!(
                    "fps {:.0}  worst frame gap {:.1} ms  worst update {:.1} ms  parsed {:.1} MB/s",
                    stats.frames as f64 / elapsed.as_secs_f64(),
                    stats.worst_gap.as_secs_f64() * 1e3,
                    stats.worst_update.as_secs_f64() * 1e3,
                    (bytes - stats.bytes_at_start) as f64 / 1e6 / elapsed.as_secs_f64(),
                );
                *stats = Stats {
                    window_start: now,
                    last_frame: now,
                    frames: 0,
                    worst_gap: Duration::ZERO,
                    worst_update: Duration::ZERO,
                    bytes_at_start: bytes,
                };
                // Keep measuring while idle too.
                ctx.request_repaint_after(Duration::from_millis(250));
            }
        }
    }
}

fn main() -> eframe::Result {
    let cwd = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().expect("current dir"));
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([960.0, 600.0])
            .with_title("ide-term"),
        ..Default::default()
    };
    eframe::run_native(
        "ide-term",
        options,
        Box::new(move |cc| {
            let mut spawn = SpawnOptions::new(&cwd);
            if let Ok(cmd) = std::env::var("HARWEX_TERM_CMD") {
                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
                spawn.command = Some(vec![
                    shell.clone(),
                    "-lc".into(),
                    format!("{cmd}; exec {shell} -l"),
                ]);
            }
            let term = Terminal::spawn_with(spawn, cc.egui_ctx.clone())?;
            let now = Instant::now();
            let stats = std::env::var_os("HARWEX_TERM_STATS").map(|_| Stats {
                window_start: now,
                last_frame: now,
                frames: 0,
                worst_gap: Duration::ZERO,
                worst_update: Duration::ZERO,
                bytes_at_start: 0,
            });
            Ok(Box::new(App {
                term,
                title: String::new(),
                focused_once: false,
                stats,
            }))
        }),
    )
}
