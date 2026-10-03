//! Window chrome: where the macOS window buttons (close, minimize, zoom) sit in our title bar,
//! and what a double click on the empty title bar does.
//!
//! The layout math is pure, so headless tests cover it. `macos.rs` moves the native buttons to
//! it every frame in which macOS has put them back at its own default.

use egui::{pos2, vec2, Rect, Vec2};

use crate::theme;

#[cfg(target_os = "macos")]
mod macos;

/// A standard macOS window button frame, in points (macOS 26). The macOS code passes the real
/// size; the egui side and the tests use this one.
pub const BUTTON_SIZE: Vec2 = vec2(14.0, 14.0);

/// The title bar in window points, measured from the window's top-left corner.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TitleBarLayout {
    pub title_h: f32,
    /// Close, minimize, zoom. `None` when no buttons sit in the bar (full screen, Linux).
    pub buttons: Option<[Rect; 3]>,
    /// Where the title bar content (project widget, Settings, branch) starts.
    pub content_x: f32,
}

/// The buttons sit vertically centered at IDEA's left inset and spacing; the content starts a
/// gap after the zoom button. In native full screen macOS hides the buttons, so the content
/// starts at the left edge.
pub fn title_bar_layout(native_buttons: bool, fullscreen: bool, button: Vec2) -> TitleBarLayout {
    let s = &theme::T.space;
    if !native_buttons || fullscreen {
        return TitleBarLayout { title_h: s.title_h, buttons: None, content_x: s.title_pad };
    }
    let top = ((s.title_h - button.y) / 2.0).round();
    let at = |i: usize| Rect::from_min_size(pos2(s.lights_inset + i as f32 * s.lights_pitch, top), button);
    let buttons = [at(0), at(1), at(2)];
    TitleBarLayout { title_h: s.title_h, buttons: Some(buttons), content_x: buttons[2].max.x + s.lights_gap }
}

/// The title bar layout of this frame: native buttons on macOS, none in full screen.
pub fn current(ctx: &egui::Context) -> TitleBarLayout {
    let fullscreen = ctx.input(|i| i.viewport().fullscreen.unwrap_or(false));
    title_bar_layout(cfg!(target_os = "macos"), fullscreen, BUTTON_SIZE)
}

/// What a double click on the empty title bar does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DoubleClick {
    Zoom,
    Minimize,
    Nothing,
}

/// Maps the macOS setting "Double-click a window's title bar to" (`AppleActionOnDoubleClick`,
/// with the older `AppleMiniaturizeOnDoubleClick` as fallback) to an action. "Fill" has no
/// viewport command, so it zooms like "Maximize".
pub fn double_click_action(action: Option<&str>, miniaturize: bool) -> DoubleClick {
    match action {
        Some("Minimize") => DoubleClick::Minimize,
        Some("None") => DoubleClick::Nothing,
        Some(_) => DoubleClick::Zoom,
        None if miniaturize => DoubleClick::Minimize,
        None => DoubleClick::Zoom,
    }
}

/// The user's double-click setting. Zoom on other platforms.
pub fn system_double_click() -> DoubleClick {
    #[cfg(target_os = "macos")]
    {
        let (action, miniaturize) = macos::double_click_defaults();
        double_click_action(action.as_deref(), miniaturize)
    }
    #[cfg(not(target_os = "macos"))]
    DoubleClick::Zoom
}

/// The macOS default double-click interval. Tests run with it, so they see the same click
/// timing as a default Mac.
pub const DEFAULT_DOUBLE_CLICK_INTERVAL: f64 = 0.5;

/// The system double-click interval in seconds, for egui's double-click and the click chains
/// of the editor and the Project tree. egui's own default (0.3 s) is shorter than the macOS
/// default (0.5 s).
pub fn system_double_click_interval() -> Option<f64> {
    #[cfg(target_os = "macos")]
    {
        Some(macos::double_click_interval()).filter(|s| s.is_finite() && *s > 0.0)
    }
    #[cfg(not(target_os = "macos"))]
    None
}

/// The `--test-chrome` check: the button frames after the window settles, then again after a
/// resize, which makes macOS lay the buttons out anew.
#[derive(Default)]
pub struct ChromeCheck {
    stable_frames: u32,
    phase: u32,
}

/// Puts the native buttons where the layout wants them. Called once per frame. A frame that had
/// to move them asks for one more frame, because macOS may lay them out again after a resize.
pub fn sync(ctx: &egui::Context, frame: &eframe::Frame, check: Option<&mut ChromeCheck>) {
    #[cfg(target_os = "macos")]
    {
        let Some(window) = macos::window(frame) else { return };
        let fullscreen = window.fullscreen();
        let layout = title_bar_layout(true, fullscreen, window.button_size().unwrap_or(BUTTON_SIZE));
        let moved = window.apply(&layout);
        if moved {
            ctx.request_repaint();
        }
        if let Some(check) = check {
            run_check(ctx, &window, &layout, moved, check);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (ctx, frame, check);
    }
}

#[cfg(target_os = "macos")]
fn run_check(ctx: &egui::Context, window: &macos::Window, layout: &TitleBarLayout, moved: bool, check: &mut ChromeCheck) {
    check.stable_frames = if moved { 0 } else { check.stable_frames + 1 };
    ctx.request_repaint_after(std::time::Duration::from_millis(50));
    if check.stable_frames < 5 {
        return;
    }
    check.stable_frames = 0;
    let label = if check.phase == 0 { "settled" } else { "after resize" };
    let size = window.size();
    eprintln!("[chrome] {label}: window {} size {:.0}x{:.0} fullscreen {}", window.number(), size.x, size.y, window.fullscreen());
    let expected = layout.buttons.unwrap_or([Rect::NOTHING; 3]);
    let mut ok = layout.buttons.is_some();
    for (i, name) in ["close", "minimize", "zoom"].iter().enumerate() {
        let got = window.button_frame(i);
        let matches = got.is_some_and(|g| (g.min - expected[i].min).length() < 0.5 && (g.size() - expected[i].size()).length() < 0.5);
        ok &= matches;
        let got = got.map_or("missing".to_string(), |g| format!("x={} y={} w={} h={}", g.min.x, g.min.y, g.width(), g.height()));
        let e = expected[i];
        eprintln!("[chrome]   {name}: got {got}; layout x={} y={} w={} h={}", e.min.x, e.min.y, e.width(), e.height());
    }
    eprintln!("[chrome]   title_h={} content_x={}", layout.title_h, layout.content_x);
    if !ok {
        eprintln!("[chrome] FAIL: the button frames do not match the layout");
        std::process::exit(1);
    }
    check.phase += 1;
    match check.phase {
        1 => ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(vec2(1100.0, 720.0))),
        _ => {
            eprintln!("[chrome] ok");
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windowed_buttons_are_centered_at_idea_inset() {
        let l = title_bar_layout(true, false, BUTTON_SIZE);
        assert_eq!(l.title_h, 40.0);
        let b = l.buttons.expect("buttons in windowed mode");
        assert_eq!(b[0], Rect::from_min_size(pos2(12.0, 13.0), BUTTON_SIZE));
        assert_eq!(b[1].min, pos2(32.0, 13.0));
        assert_eq!(b[2].min, pos2(52.0, 13.0));
        // Vertically centered in the bar.
        assert_eq!(b[0].center().y, l.title_h / 2.0);
        assert_eq!(l.content_x, 78.0);
    }

    #[test]
    fn odd_button_height_lands_on_whole_points() {
        let l = title_bar_layout(true, false, vec2(14.0, 16.0));
        assert_eq!(l.buttons.unwrap()[0].min.y, 12.0);
        let l = title_bar_layout(true, false, vec2(14.0, 15.0));
        let b = l.buttons.unwrap();
        assert_eq!(b[0].min.y, 13.0);
        assert_eq!(l.content_x, 78.0);
    }

    #[test]
    fn full_screen_and_other_platforms_start_at_the_edge() {
        for l in [title_bar_layout(true, true, BUTTON_SIZE), title_bar_layout(false, false, BUTTON_SIZE)] {
            assert_eq!(l.buttons, None);
            assert_eq!(l.content_x, 10.0);
            assert_eq!(l.title_h, 40.0);
        }
    }

    #[test]
    fn double_click_follows_the_system_setting() {
        assert_eq!(double_click_action(Some("Maximize"), false), DoubleClick::Zoom);
        assert_eq!(double_click_action(Some("Fill"), false), DoubleClick::Zoom);
        assert_eq!(double_click_action(Some("Minimize"), false), DoubleClick::Minimize);
        assert_eq!(double_click_action(Some("None"), true), DoubleClick::Nothing);
        assert_eq!(double_click_action(None, true), DoubleClick::Minimize);
        assert_eq!(double_click_action(None, false), DoubleClick::Zoom);
    }
}
