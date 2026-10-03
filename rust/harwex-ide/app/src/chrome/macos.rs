//! The native window buttons. macOS lays them out again (back at its default spot, near the
//! top of a 28 pt title bar) on resize, on key-window changes, after full screen and on theme
//! changes, so `apply` runs every frame and writes only when a frame differs.
//!
//! The buttons live in a private view tree: button -> `NSTitlebarView` -> `NSTitlebarContainerView`
//! -> the window's frame view. The container is stretched to our title bar height, so the
//! buttons are not clipped, and every rect goes through window coordinates, so flipped views
//! do not matter.

use egui::{pos2, vec2, Rect, Vec2};
use objc2::rc::Retained;
use objc2_app_kit::{NSButton, NSEvent, NSView, NSWindow, NSWindowButton, NSWindowStyleMask};
use objc2_foundation::{ns_string, NSPoint, NSRect, NSSize, NSUserDefaults};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

use super::TitleBarLayout;

const KINDS: [NSWindowButton; 3] = [NSWindowButton::NSWindowCloseButton, NSWindowButton::NSWindowMiniaturizeButton, NSWindowButton::NSWindowZoomButton];

pub struct Window {
    ns: Retained<NSWindow>,
}

/// The eframe window. `None` in headless tests, which have no window handle.
pub fn window(frame: &eframe::Frame) -> Option<Window> {
    let RawWindowHandle::AppKit(h) = frame.window_handle().ok()?.as_raw() else { return None };
    // SAFETY: winit hands out its live NSView, and eframe calls `update` on the main thread
    // while the window exists.
    let view: &NSView = unsafe { h.ns_view.cast::<NSView>().as_ref() };
    Some(Window { ns: view.window()? })
}

/// `AppleActionOnDoubleClick` and `AppleMiniaturizeOnDoubleClick` from the global domain.
pub fn double_click_defaults() -> (Option<String>, bool) {
    // SAFETY: plain reads of the user's defaults; NSUserDefaults is thread safe.
    unsafe {
        let d = NSUserDefaults::standardUserDefaults();
        let action = d.stringForKey(ns_string!("AppleActionOnDoubleClick")).map(|s| s.to_string());
        (action, d.boolForKey(ns_string!("AppleMiniaturizeOnDoubleClick")))
    }
}

/// The system double-click interval in seconds (System Settings > Mouse > Double-click speed).
pub fn double_click_interval() -> f64 {
    // SAFETY: a class getter that reads the user's defaults.
    unsafe { NSEvent::doubleClickInterval() }
}

impl Window {
    pub fn fullscreen(&self) -> bool {
        self.ns.styleMask().contains(NSWindowStyleMask::FullScreen)
    }

    /// The window number, for `screencapture -l`.
    pub fn number(&self) -> isize {
        // SAFETY: a plain getter on the main thread.
        unsafe { self.ns.windowNumber() }
    }

    pub fn size(&self) -> Vec2 {
        let s = self.ns.frame().size;
        vec2(s.width as f32, s.height as f32)
    }

    fn button(&self, i: usize) -> Option<Retained<NSButton>> {
        self.ns.standardWindowButton(KINDS[i])
    }

    pub fn button_size(&self) -> Option<Vec2> {
        let s = self.button(0)?.frame().size;
        Some(vec2(s.width as f32, s.height as f32))
    }

    /// A button's frame in window points from the top-left corner.
    pub fn button_frame(&self, i: usize) -> Option<Rect> {
        let b = self.button(i)?;
        let r = b.convertRect_toView(b.bounds(), None);
        let h = self.ns.frame().size.height;
        let top = h - (r.origin.y + r.size.height);
        Some(Rect::from_min_size(pos2(r.origin.x as f32, top as f32), vec2(r.size.width as f32, r.size.height as f32)))
    }

    /// A rect in window points from the top-left corner, in AppKit window coordinates.
    fn to_window(&self, r: Rect) -> NSRect {
        let h = self.ns.frame().size.height;
        NSRect::new(NSPoint::new(r.min.x as f64, h - r.max.y as f64), NSSize::new(r.width() as f64, r.height() as f64))
    }

    /// Moves the title bar views and the buttons to `layout`. Returns true when something moved.
    pub fn apply(&self, layout: &TitleBarLayout) -> bool {
        let Some(want) = layout.buttons else { return false };
        if self.fullscreen() {
            return false;
        }
        let Some(close) = self.button(0) else { return false };
        // SAFETY: AppKit views, used on the main thread while the window exists.
        unsafe {
            let Some(titlebar) = close.superview() else { return false };
            let Some(container) = titlebar.superview() else { return false };
            let Some(frame_view) = container.superview() else { return false };
            let width = self.ns.frame().size.width as f32;
            let bar = Rect::from_min_size(pos2(0.0, 0.0), vec2(width, layout.title_h));
            let mut moved = set_frame(&container, frame_view.convertRect_fromView(self.to_window(bar), None));
            moved |= set_frame(&titlebar, container.bounds());
            for (i, rect) in want.iter().enumerate() {
                let Some(b) = self.button(i) else { continue };
                let Some(parent) = b.superview() else { continue };
                let target = parent.convertRect_fromView(self.to_window(*rect), None);
                if differs(b.frame().origin, target.origin) {
                    b.setFrameOrigin(target.origin);
                    moved = true;
                }
            }
            moved
        }
    }
}

/// Sets a view's frame when it is off by half a point or more.
unsafe fn set_frame(view: &NSView, frame: NSRect) -> bool {
    let now = view.frame();
    if differs(now.origin, frame.origin) || differs(NSPoint::new(now.size.width, now.size.height), NSPoint::new(frame.size.width, frame.size.height)) {
        view.setFrame(frame);
        return true;
    }
    false
}

fn differs(a: NSPoint, b: NSPoint) -> bool {
    (a.x - b.x).abs() >= 0.5 || (a.y - b.y).abs() >= 0.5
}
