//! Double clicks for every widget of the app.
//!
//! egui's `double_clicked()` is wrong for a real user's clicks. egui calls a click "triple" up
//! to twice `max_double_click_delay` after the click before last (1 s with the macOS 0.5 s),
//! and it ignores where a click lands. So a double click right after a selecting click, or a
//! second double click, never fires, and a quick click elsewhere fires as a double.
//!
//! `Clicks` counts presses instead, like AppKit's click count: each press within the double-click
//! interval of the one before and near it (`ide_editor::ClickChain`). `IdeApp::update` feeds it
//! the frame's button events before any widget is drawn.
//!
//! A double click is the release of the chain's second press. A late frame can carry the first
//! release and the second press together. egui then reports that frame's click, and the frame of
//! the second release reports another one. So `double` asks which press a click of the frame
//! ends, not where the chain stands at the end of the frame. This module is the only place that may call
//! egui's `double_clicked()` or `triple_clicked()` (`tests::no_egui_double_clicks` checks it).

use egui::{Context, Event, PointerButton, Response};
use ide_editor::{ClickChain, CHAIN_DIST};

/// The primary presses of the current multi-click, shared by all widgets.
#[derive(Clone, Copy, Debug, Default)]
pub struct Clicks {
    chain: ClickChain,
    /// The place of the last press in its chain (1, 2, 3, ...).
    count: u32,
    /// The place in its chain of the press that the next primary release ends; 0 when no
    /// press is held.
    held: u32,
    /// A primary release of this frame ended the second press of a chain.
    second_released: bool,
}

impl Clicks {
    /// Counts this frame's primary presses. Call once per frame, before the widgets.
    pub fn begin_frame(&mut self, ctx: &Context) {
        let delay = ctx.options(|o| o.input_options.max_double_click_delay);
        self.second_released = false;
        ctx.input(|i| {
            // In order: one frame may hold both clicks of a double click.
            for e in &i.events {
                if let Event::PointerButton { pos, button: PointerButton::Primary, pressed, .. } = e {
                    if *pressed {
                        self.count = self.chain.press(i.time, *pos, delay, CHAIN_DIST);
                        self.held = self.count;
                    } else {
                        self.second_released |= self.held == 2;
                        self.held = 0;
                    }
                }
            }
        });
    }

    /// The place of the last primary press in its chain: 2 for the second press of a double click.
    pub fn press_count(&self) -> u32 {
        self.count
    }

    /// `resp` got the click of the second press of a chain: a double click. A frame that ends
    /// the first click and starts the second press is no double click yet.
    pub fn double(&self, resp: &Response) -> bool {
        resp.clicked() && self.second_released
    }
}

/// The primary press on `resp` in this frame. Menus and popups act on the press, not on the
/// release, so a press held a little long still counts.
pub fn pressed(resp: &Response) -> bool {
    resp.is_pointer_button_down_on() && resp.ctx.input(|i| i.pointer.primary_pressed())
}

/// egui's own count of the frame's primary click, for the input log only.
pub fn egui_click_kind(ctx: &Context) -> &'static str {
    ctx.input(|i| {
        let p = &i.pointer;
        let b = PointerButton::Primary;
        if p.button_triple_clicked(b) {
            "triple"
        } else if p.button_double_clicked(b) {
            "double"
        } else if p.button_clicked(b) {
            "single"
        } else if p.primary_released() {
            "release, no click"
        } else {
            ""
        }
    })
}

/// egui's own double click on `resp`, for the input log only.
pub fn egui_double(resp: &Response) -> bool {
    resp.double_clicked()
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("read dir").flatten() {
            let path = entry.path();
            if path.is_dir() {
                rust_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    /// Every widget counts double clicks with `Clicks`. egui's own count may appear only here.
    #[test]
    fn no_egui_double_clicks() {
        let app = Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut dirs = vec![app.join("src")];
        for crate_dir in std::fs::read_dir(app.join("../crates")).expect("crates dir").flatten() {
            dirs.push(crate_dir.path().join("src"));
        }
        let helper = app.join("src/clicks.rs");
        let mut files = Vec::new();
        for dir in dirs.iter().filter(|d| d.is_dir()) {
            rust_files(dir, &mut files);
        }
        assert!(files.len() > 20, "the scan found the sources");
        let mut found = Vec::new();
        for file in files.iter().filter(|f| **f != helper) {
            let text = std::fs::read_to_string(file).expect("read source");
            for (n, line) in text.lines().enumerate() {
                if line.contains("double_clicked(") || line.contains("triple_clicked(") {
                    found.push(format!("{}:{}: {}", file.display(), n + 1, line.trim()));
                }
            }
        }
        assert!(found.is_empty(), "use crate::clicks::Clicks instead of egui's double/triple clicks:\n{}", found.join("\n"));
    }
}
