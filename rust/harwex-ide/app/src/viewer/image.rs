//! The image viewer tab and the image diff's two panes.
//!
//! An image opens fitted to the view (never above 100 %). Cmd+= / Cmd+- and Cmd+wheel (or a
//! pinch) zoom, a drag or the wheel pans a zoomed image, "1:1" shows it at its own size. A
//! checkerboard shows through transparent pixels.

use std::any::Any;
use std::path::{Path, PathBuf};

use egui::{pos2, vec2, Color32, CursorIcon, Id, Key, Modifiers, Rect, Sense, TextureHandle, TextureOptions, Ui, Vec2};

use super::{human_size, Decoded};
use crate::icons::{self, Icon};
use crate::state::{AppState, TabEnv};
use crate::tabs::CustomTab;
use crate::theme;

/// The image viewer's toolbar row.
pub const TOOLBAR_H: f32 = 30.0;
const ZOOM_STEP: f32 = 1.25;
const MIN_ZOOM: f32 = 0.02;
const MAX_ZOOM: f32 = 32.0;
/// The side of one checkerboard square, in points.
const CHECKER: f32 = 8.0;

/// A picture on its way to the screen: decoded pixels until the first frame uploads them.
pub enum Pic {
    Decoded(Box<Decoded>),
    Ready(Ready),
    Failed(String),
}

pub struct Ready {
    pub tex: TextureHandle,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub format: String,
}

impl Ready {
    /// "64×48 PNG (2.1 KB)", IDEA's image info.
    pub fn info(&self) -> String {
        format!("{}×{} {} ({})", self.width, self.height, self.format, human_size(self.bytes))
    }

    fn size(&self) -> Vec2 {
        vec2(self.width.max(1) as f32, self.height.max(1) as f32)
    }
}

impl Pic {
    pub fn from_result(r: Result<Decoded, String>) -> Pic {
        match r {
            Ok(d) => Pic::Decoded(Box::new(d)),
            Err(e) => Pic::Failed(e),
        }
    }

    /// The texture, uploaded on the first call. `name` names it in egui's texture list.
    pub fn ready(&mut self, ctx: &egui::Context, name: &str) -> Option<&Ready> {
        if let Pic::Decoded(d) = self {
            let d = std::mem::replace(&mut **d, Decoded { pixels: egui::ColorImage::default(), width: 0, height: 0, bytes: 0, format: String::new() });
            // Smooth when shrunk, square pixels when zoomed in, like IDEA.
            let opts = TextureOptions { magnification: egui::TextureFilter::Nearest, minification: egui::TextureFilter::Linear, ..TextureOptions::default() };
            let tex = ctx.load_texture(name, d.pixels, opts);
            *self = Pic::Ready(Ready { tex, width: d.width, height: d.height, bytes: d.bytes, format: d.format });
        }
        match self {
            Pic::Ready(r) => Some(r),
            _ => None,
        }
    }
}

/// Zoom and pan of one image view; the image diff shares one between its panes.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ImageView {
    /// Points per image pixel. `None` fits the image into the view, at most 1:1.
    pub zoom: Option<f32>,
    /// The image center's offset from the view center, in points.
    pub pan: Vec2,
}

impl ImageView {
    fn fit(view: Vec2, img: Vec2) -> f32 {
        (view.x / img.x).min(view.y / img.y).min(1.0)
    }

    /// The zoom that a view of `view` points shows an `img`-pixel image at.
    pub fn scale(&self, view: Vec2, img: Vec2) -> f32 {
        self.zoom.unwrap_or_else(|| Self::fit(view, img))
    }

    /// Zooms by `factor` around `anchor` (a point relative to the view center).
    fn zoom_by(&mut self, factor: f32, anchor: Vec2, view: Vec2, img: Vec2) {
        let old = self.scale(view, img);
        let new = (old * factor).clamp(MIN_ZOOM, MAX_ZOOM);
        self.pan = anchor - (anchor - self.pan) * (new / old);
        self.zoom = Some(new);
    }

    fn clamp(&mut self, view: Vec2, img: Vec2) {
        let size = img * self.scale(view, img);
        let lim = ((size - view) / 2.0).max(Vec2::ZERO);
        self.pan = self.pan.clamp(-lim, lim);
    }

    /// Cmd+= / Cmd+- around the view center. Returns true when a key acted.
    fn keys(&mut self, ui: &Ui, view: Vec2, img: Vec2) -> bool {
        let (zin, zout) = ui.input_mut(|i| {
            let zin = i.consume_key(Modifiers::COMMAND, Key::Equals) || i.consume_key(Modifiers::COMMAND, Key::Plus);
            (zin, i.consume_key(Modifiers::COMMAND, Key::Minus))
        });
        if zin {
            self.zoom_by(ZOOM_STEP, Vec2::ZERO, view, img);
        }
        if zout {
            self.zoom_by(1.0 / ZOOM_STEP, Vec2::ZERO, view, img);
        }
        zin || zout
    }

    /// The zoom in percent, as the info line shows it.
    pub fn percent(&self, view: Vec2, img: Vec2) -> u32 {
        (self.scale(view, img) * 100.0).round() as u32
    }
}

/// Where the image of `img` pixels lands in `rect` under `view`.
pub fn image_rect(view: &ImageView, rect: Rect, img: Vec2) -> Rect {
    let size = img * view.scale(rect.size(), img);
    Rect::from_center_size(rect.center() + view.pan, size)
}

/// The shared 2×2 checkerboard texture, repeated by its UVs.
fn checker(ctx: &egui::Context) -> TextureHandle {
    let id = Id::new("viewer-checker");
    if let Some(t) = ctx.data(|d| d.get_temp::<TextureHandle>(id)) {
        return t;
    }
    let t = &theme::T;
    let img = egui::ColorImage { size: [2, 2], pixels: vec![t.checker_light, t.checker_dark, t.checker_dark, t.checker_light] };
    let opts = TextureOptions { magnification: egui::TextureFilter::Nearest, minification: egui::TextureFilter::Nearest, wrap_mode: egui::TextureWrapMode::Repeat, ..TextureOptions::default() };
    let tex = ctx.load_texture("viewer-checker", img, opts);
    ctx.data_mut(|d| d.insert_temp(id, tex.clone()));
    tex
}

/// Draws `pic` into `rect` under `view` and handles zoom and pan. `id` is the view's widget id;
/// `label` its accessibility name.
pub fn show_pic(ui: &mut Ui, rect: Rect, id: Id, label: &str, pic: &Ready, view: &mut ImageView) -> egui::Response {
    let resp = ui.interact(rect, id, Sense::click_and_drag());
    crate::util::label_widget(&resp, egui::WidgetType::Image, label);
    if resp.is_pointer_button_down_on() && !resp.has_focus() {
        resp.request_focus();
    }
    let img = pic.size();
    let focused = ui.memory(|m| m.focused());
    if focused.is_none() || focused == Some(id) {
        view.keys(ui, rect.size(), img);
    }
    if resp.hovered() {
        let (zoom, scroll, pointer) = ui.input(|i| (i.zoom_delta(), i.smooth_scroll_delta, i.pointer.hover_pos()));
        if zoom != 1.0 {
            let anchor = pointer.map_or(Vec2::ZERO, |p| p - rect.center());
            view.zoom_by(zoom, anchor, rect.size(), img);
        } else if scroll != Vec2::ZERO {
            view.pan += scroll;
        }
    }
    if resp.dragged() {
        view.pan += resp.drag_delta();
        ui.ctx().set_cursor_icon(CursorIcon::Grabbing);
    }
    view.clamp(rect.size(), img);

    let painter = ui.painter_at(rect);
    let at = image_rect(view, rect, img);
    let shown = at.intersect(rect);
    if shown.is_positive() {
        // The squares stay put on screen while the image pans, like IDEA's.
        let uv = Rect::from_min_max(((shown.min - rect.min) / (2.0 * CHECKER)).to_pos2(), ((shown.max - rect.min) / (2.0 * CHECKER)).to_pos2());
        painter.image(checker(ui.ctx()).id(), shown, uv, theme::T.image_tint);
        painter.image(pic.tex.id(), at, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), theme::T.image_tint);
    }
    resp
}

/// A small toolbar button: an icon or a short text, with an accessibility label.
pub fn tool_button(ui: &mut Ui, label: &str, icon: Option<Icon>, text: &str) -> egui::Response {
    let t = &theme::T;
    let galley = (!text.is_empty()).then(|| ui.painter().layout_no_wrap(text.to_string(), t.small_font(), t.text));
    let w = galley.as_ref().map_or(22.0, |g| g.size().x + 12.0);
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 22.0), Sense::click());
    crate::util::label_widget(&resp, egui::WidgetType::Button, label);
    if resp.hovered() {
        ui.painter().rect_filled(rect, t.radius.small, t.button_hover);
    }
    if let Some(i) = icon {
        icons::paint(ui.painter(), Rect::from_center_size(rect.center(), Vec2::splat(14.0)), i, t.icon);
    }
    if let Some(g) = galley {
        ui.painter().galley(rect.center() - g.size() / 2.0, g, t.text);
    }
    resp.on_hover_text(label)
}

/// The zoom buttons. Returns true when one acted.
fn zoom_buttons(ui: &mut Ui, view: &mut ImageView, viewport: Vec2, img: Vec2) -> bool {
    let mut acted = false;
    if tool_button(ui, "Zoom In", Some(Icon::Plus), "").clicked() {
        view.zoom_by(ZOOM_STEP, Vec2::ZERO, viewport, img);
        acted = true;
    }
    if tool_button(ui, "Zoom Out", Some(Icon::Minus), "").clicked() {
        view.zoom_by(1.0 / ZOOM_STEP, Vec2::ZERO, viewport, img);
        acted = true;
    }
    if tool_button(ui, "Actual Size", None, "1:1").clicked() {
        *view = ImageView { zoom: Some(1.0), pan: Vec2::ZERO };
        acted = true;
    }
    if tool_button(ui, "Fit to Window", None, "Fit").clicked() {
        *view = ImageView::default();
        acted = true;
    }
    acted
}

fn toolbar_rect(ui: &Ui) -> (Rect, Rect) {
    let full = ui.available_rect_before_wrap();
    let bar = Rect::from_min_size(full.min, vec2(full.width(), TOOLBAR_H));
    let body = Rect::from_min_max(pos2(full.min.x, bar.max.y), full.max);
    (bar, body)
}

fn status_text(ui: &mut Ui, text: &str, color: Color32) {
    ui.label(egui::RichText::new(text).font(theme::T.small_font()).color(color));
}

// ---------------------------------------------------------------------------------------------
// The image tab.

pub struct ImageTab {
    path: PathBuf,
    pic: Option<Pic>,
    view: ImageView,
    /// The body rect as drawn last frame, for the zoom buttons and tests.
    body: Option<Rect>,
}

/// The custom-tab key of the image tab for `path`.
pub fn key_for(path: &Path) -> String {
    format!("image:{}", path.display())
}

impl ImageTab {

    pub fn view(&self) -> ImageView {
        self.view
    }

    /// The image's info line ("64×48 PNG (2.1 KB)"), once decoded.
    pub fn info(&self) -> Option<String> {
        match &self.pic {
            Some(Pic::Ready(r)) => Some(r.info()),
            _ => None,
        }
    }

    pub fn is_loaded(&self) -> bool {
        matches!(self.pic, Some(Pic::Ready(_)) | Some(Pic::Failed(_)))
    }

    /// Where the image was drawn last frame.
    pub fn image_rect(&self) -> Option<Rect> {
        match (&self.pic, self.body) {
            (Some(Pic::Ready(r)), Some(b)) => Some(image_rect(&self.view, b, r.size())),
            _ => None,
        }
    }
}

/// Opens `path` in an image tab (or activates the open one) and decodes it on a worker.
pub fn open(state: &mut AppState, path: &Path) {
    let key = key_for(path);
    state.ws.search.touch(path);
    state.ws.tree.selected = Some(path.to_path_buf());
    if state.ws.tabs.custom_by_key(&key).is_some() {
        state.ws.tabs.open_custom(Box::new(ImageTab { path: path.to_path_buf(), pic: None, view: ImageView::default(), body: None }));
        return;
    }
    state.ws.tabs.open_custom(Box::new(ImageTab { path: path.to_path_buf(), pic: None, view: ImageView::default(), body: None }));
    crate::tabs::enforce_limit(state);
    reload(state, path);
}

/// Decodes the file again, e.g. after it changed on disk.
pub fn reload(state: &mut AppState, path: &Path) {
    let key = key_for(path);
    let file = path.to_path_buf();
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    state.jobs.spawn(
        format!("Loading {name}"),
        move || super::load(&file),
        move |state, res| {
            if let Some(tab) = state.ws.tabs.custom_mut::<ImageTab>(&key) {
                tab.pic = Some(Pic::from_result(res));
            }
        },
    );
}

impl CustomTab for ImageTab {
    fn key(&self) -> String {
        key_for(&self.path)
    }
    fn title(&self) -> String {
        self.path.file_name().map_or_else(|| self.path.display().to_string(), |n| n.to_string_lossy().into_owned())
    }
    fn tooltip(&self) -> String {
        self.path.display().to_string()
    }
    fn file_path(&self) -> Option<PathBuf> {
        Some(self.path.clone())
    }
    fn file_icon(&self) -> bool {
        true
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
    fn ui(&mut self, ui: &mut Ui, env: &mut TabEnv) {
        let t = &theme::T;
        let (bar, body) = toolbar_rect(ui);
        let name = self.title();
        let svg = self.path.extension().is_some_and(|e| e.eq_ignore_ascii_case("svg"));
        let pic = self.pic.as_mut().map(|p| (p.ready(ui.ctx(), &name).map(|r| (r.size(), r.info())), p));
        let mut bar_ui = ui.new_child(egui::UiBuilder::new().max_rect(bar.shrink2(vec2(8.0, 0.0))).layout(egui::Layout::left_to_right(egui::Align::Center)));
        if let Some((Some((img, info)), _)) = &pic {
            zoom_buttons(&mut bar_ui, &mut self.view, body.size(), *img);
            if svg && tool_button(&mut bar_ui, "Open as Text", None, "Text").clicked() {
                let path = self.path.clone();
                env.jobs.post(move |state| state.open_text_location(&path, None, false));
            }
            bar_ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                status_text(ui, &format!("{}%", self.view.percent(body.size(), *img)), t.text_dim);
                ui.add_space(8.0);
                status_text(ui, info, t.text_dim);
            });
        }
        ui.painter().hline(bar.x_range(), bar.max.y - 0.5, egui::Stroke::new(1.0_f32, t.border));
        self.body = Some(body);
        let id = crate::workspace::wid(("image-view", &self.path));
        match pic {
            None => {
                ui.put(body, egui::Spinner::new());
            }
            Some((_, Pic::Failed(e))) => {
                ui.put(body, egui::Label::new(egui::RichText::new(format!("Cannot show {name}: {e}")).color(t.error)));
            }
            Some((_, p)) => {
                if let Some(r) = p.ready(ui.ctx(), &name) {
                    show_pic(ui, body, id, &format!("Image {name}"), r, &mut self.view);
                }
            }
        }
        ui.allocate_rect(Rect::from_min_max(bar.min, body.max), Sense::hover());
    }
}

// ---------------------------------------------------------------------------------------------
// The image diff.

/// Both sides of a binary image diff, decoded on the diff's worker. The panes share one zoom
/// and pan, like IDEA's.
pub struct DiffImages {
    old: Option<Pic>,
    new: Option<Pic>,
    view: ImageView,
}

impl DiffImages {
    /// Decodes the sides that exist. Call it on a worker.
    pub fn decode(old: Option<&[u8]>, new: Option<&[u8]>) -> DiffImages {
        let side = |b: Option<&[u8]>| b.map(|b| Pic::from_result(super::decode(b, false)));
        DiffImages { old: side(old), new: side(new), view: ImageView::default() }
    }

    pub fn view(&self) -> ImageView {
        self.view
    }

    pub fn set_view(&mut self, v: ImageView) {
        self.view = v;
    }

    /// Draws the panes: both side by side, or one when the file was added or deleted.
    /// `titles` are the side headers (old, new).
    pub fn ui(&mut self, ui: &mut Ui, key: &str, titles: (String, String)) {
        let t = &theme::T;
        let (bar, body) = toolbar_rect(ui);
        let name = key.to_string();
        let mut sides: Vec<(&str, String, &mut Pic)> = Vec::new();
        if let Some(p) = self.old.as_mut() {
            sides.push(("old", titles.0, p));
        }
        if let Some(p) = self.new.as_mut() {
            sides.push(("new", titles.1, p));
        }
        if let [(side, title, _)] = sides.as_mut_slice() {
            title.push_str(if *side == "new" { "  (added)" } else { "  (deleted)" });
        }
        let n = sides.len().max(1) as f32;
        let pane_w = body.width() / n;
        // The zoom buttons act on the first ready side's size, so both stay in step.
        let first_img = sides.iter_mut().find_map(|(side, _, p)| p.ready(ui.ctx(), &format!("{name}:{side}")).map(|r| r.size()));
        let mut bar_ui = ui.new_child(egui::UiBuilder::new().max_rect(bar.shrink2(vec2(8.0, 0.0))).layout(egui::Layout::left_to_right(egui::Align::Center)));
        if let Some(img) = first_img {
            let pane = vec2(pane_w, body.height() - TOOLBAR_H * 2.0);
            zoom_buttons(&mut bar_ui, &mut self.view, pane, img);
            bar_ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| status_text(ui, &format!("{}%", self.view.percent(pane, img)), t.text_dim));
        }
        ui.painter().hline(bar.x_range(), bar.max.y - 0.5, egui::Stroke::new(1.0_f32, t.border));
        for (i, (side, title, pic)) in sides.into_iter().enumerate() {
            let pane = Rect::from_min_size(pos2(body.min.x + pane_w * i as f32, body.min.y), vec2(pane_w, body.height()));
            let head = Rect::from_min_size(pane.min, vec2(pane.width(), TOOLBAR_H));
            let foot = Rect::from_min_max(pos2(pane.min.x, pane.max.y - TOOLBAR_H), pane.max);
            let img_rect = Rect::from_min_max(pos2(pane.min.x, head.max.y), pos2(pane.max.x, foot.min.y));
            if i > 0 {
                ui.painter().vline(pane.min.x, pane.y_range(), egui::Stroke::new(1.0_f32, t.border));
            }
            let mut head_ui = ui.new_child(egui::UiBuilder::new().max_rect(head.shrink2(vec2(10.0, 0.0))).layout(egui::Layout::left_to_right(egui::Align::Center)));
            head_ui.add(egui::Label::new(egui::RichText::new(&title).font(t.small_font()).color(t.text)).truncate());
            let mut foot_ui = ui.new_child(egui::UiBuilder::new().max_rect(foot.shrink2(vec2(10.0, 0.0))).layout(egui::Layout::left_to_right(egui::Align::Center)));
            match pic {
                Pic::Failed(e) => status_text(&mut foot_ui, &format!("Cannot decode: {e}"), t.error),
                p => {
                    if let Some(r) = p.ready(ui.ctx(), &format!("{name}:{side}")) {
                        status_text(&mut foot_ui, &r.info(), t.text_dim);
                        let id = crate::workspace::wid(("image-diff", key, side));
                        show_pic(ui, img_rect, id, &format!("Image {side} {title}"), r, &mut self.view);
                    }
                }
            }
        }
        ui.allocate_rect(Rect::from_min_max(bar.min, body.max), Sense::hover());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_never_scales_up_and_zoom_keeps_the_anchor() {
        let view = vec2(400.0, 300.0);
        let mut v = ImageView::default();
        assert_eq!(v.scale(view, vec2(100.0, 50.0)), 1.0, "a small image shows 1:1");
        assert_eq!(v.scale(view, vec2(800.0, 300.0)), 0.5);
        // The image point under the anchor stays under it.
        let img = vec2(800.0, 600.0);
        v.zoom = Some(1.0);
        let anchor = vec2(100.0, -50.0);
        let before = (anchor - v.pan) / 1.0;
        v.zoom_by(2.0, anchor, view, img);
        let after = (anchor - v.pan) / 2.0;
        assert!((before - after).length() < 1e-3);
        v.clamp(view, img);
        assert!(v.pan.x.abs() <= (1600.0 - 400.0) / 2.0);
        let mut small = ImageView { zoom: Some(1.0), pan: vec2(50.0, 50.0) };
        small.clamp(view, vec2(10.0, 10.0));
        assert_eq!(small.pan, Vec2::ZERO, "an image smaller than the view stays centered");
    }
}
