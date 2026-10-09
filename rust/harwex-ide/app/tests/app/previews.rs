//! Previews (task 095): images open in the image viewer, Markdown has Editor / Split / Preview
//! modes, and the diff of an image shows both pictures. The images are generated fixtures.

use crate::common::*;
use egui::{Event, Key, Modifiers, MouseWheelUnit, Vec2};
use harwex_ide::viewer::image::ImageTab;
use harwex_ide::viewer::markdown::Mode;

const SUITE: &str = "previews";

/// A `w`×`h` PNG: an opaque gradient on the left half, a soft disc on transparency on the right,
/// so the checkerboard shows. `hue` shifts the colors for a second version.
fn png(w: u32, h: u32, hue: u8) -> Vec<u8> {
    let img = image::RgbaImage::from_fn(w, h, |x, y| {
        if x < w / 2 {
            image::Rgba([(x * 255 / w) as u8 ^ hue, (y * 255 / h) as u8, 200u8.wrapping_sub(hue), 255])
        } else {
            let (cx, cy) = (w as f32 * 0.75, h as f32 / 2.0);
            let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            let a = (255.0 * (1.0 - d / (h as f32 / 2.5))).clamp(0.0, 255.0) as u8;
            image::Rgba([60, 200u8.wrapping_add(hue), 90, a])
        }
    });
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).expect("encode png");
    out
}

const SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="2" y="2" width="28" height="28" rx="6" fill="#3574F0"/><circle cx="16" cy="16" r="7" fill="#FFFFFF"/></svg>
"##;

fn write_bytes(repo: &Repo, rel: &str, bytes: &[u8]) {
    let path = repo.dir.join(rel);
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    std::fs::write(path, bytes).expect("write");
}

fn image_repo(fx: &Fixture) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    write_bytes(&repo, "img/pic.png", &png(64, 48, 0));
    repo.write("img/logo.svg", SVG);
    repo.commit_all("Add images");
    repo
}

/// Opens `rel` as the tree would and waits for the decoded image.
fn open_image(ide: &mut Ide, rel: &str) -> String {
    let path = std::fs::canonicalize(ide.root().join(rel)).expect("file exists");
    ide.state_mut().open_location(&path, None, true);
    let key = format!("image:{}", path.display());
    ide.wait_until("image decoded", |ide| ide.state().is_idle() && ide.state().ws.tabs.custom_by_key(&key).is_some());
    ide.settle();
    key
}

fn image_tab<'a>(ide: &'a mut Ide, key: &str) -> &'a mut ImageTab {
    ide.state_mut().ws.tabs.custom_mut::<ImageTab>(key).expect("image tab")
}

#[test]
fn an_image_opens_in_the_viewer_and_zooms() {
    let fx = Fixture::new(SUITE, "image");
    let repo = image_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let key = open_image(&mut ide, "img/pic.png");
    assert_eq!(ide.active_title().as_deref(), Some("pic.png"));
    assert!(ide.state().ws.tabs.active_editor().is_none(), "no text editor for a PNG");
    assert_eq!(image_tab(&mut ide, &key).info().as_deref(), Some("64×48 PNG (".to_string() + &harwex_ide::viewer::human_size(std::fs::metadata(repo.dir.join("img/pic.png")).expect("png").len()) + ")").as_deref());
    assert!(ide.has("Image pic.png"));
    // A small image fits at 1:1, centered in the view.
    assert_eq!(image_tab(&mut ide, &key).view().zoom, None);
    let r = image_tab(&mut ide, &key).image_rect().expect("drawn");
    assert_eq!(r.size(), Vec2::new(64.0, 48.0));
    ide.snapshot("image_fit");

    ide.key_mods(Modifiers::COMMAND, Key::Equals);
    ide.key_mods(Modifiers::COMMAND, Key::Equals);
    assert_eq!(image_tab(&mut ide, &key).view().zoom, Some(1.5625));
    ide.key_mods(Modifiers::COMMAND, Key::Minus);
    assert_eq!(image_tab(&mut ide, &key).view().zoom, Some(1.25));
    // Cmd+wheel zooms around the pointer.
    let center = image_tab(&mut ide, &key).image_rect().expect("drawn").center();
    ide.move_to(center);
    ide.harness.input_mut().events.push(Event::MouseWheel { unit: MouseWheelUnit::Point, delta: Vec2::new(0.0, 40.0), modifiers: Modifiers::COMMAND });
    ide.steps(2);
    let z = image_tab(&mut ide, &key).view().zoom.expect("zoomed");
    assert!(z > 1.25, "Cmd+wheel zoomed in: {z}");
    for _ in 0..12 {
        ide.click("Zoom In");
    }
    let r = image_tab(&mut ide, &key).image_rect().expect("drawn");
    assert!(r.width() > 64.0 * 8.0, "zoomed far in: {r:?}");
    ide.snapshot("image_zoomed");
    ide.click("Actual Size");
    assert_eq!(image_tab(&mut ide, &key).view().zoom, Some(1.0));
    ide.click("Fit to Window");
    assert_eq!(image_tab(&mut ide, &key).view().zoom, None);

    // A change on disk decodes the file again.
    write_bytes(&repo, "img/pic.png", &png(80, 40, 30));
    let path = std::fs::canonicalize(repo.dir.join("img/pic.png")).expect("png");
    ide.state_mut().on_fs_batch(harwex_ide::watcher::FsBatch { paths: std::iter::once(path).collect(), structure_changed: false, git_changed: false });
    ide.settle();
    assert!(image_tab(&mut ide, &key).info().is_some_and(|i| i.starts_with("80×40 PNG")));

    // Opening it again activates the same tab.
    ide.open_file("README.md");
    open_image(&mut ide, "img/pic.png");
    assert_eq!(ide.tab_titles().iter().filter(|t| *t == "pic.png").count(), 1);
}

#[test]
fn an_svg_renders_and_opens_as_text() {
    let fx = Fixture::new(SUITE, "svg");
    let repo = image_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let key = open_image(&mut ide, "img/logo.svg");
    assert_eq!(image_tab(&mut ide, &key).info().as_deref(), Some(format!("32×32 SVG ({} B)", SVG.len()).as_str()));
    ide.snapshot("svg");
    ide.click("Open as Text");
    ide.wait_for("svg text tab", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path.ends_with("img/logo.svg")));
    assert!(ide.active_text().starts_with("<svg"));
    // With a text tab open, the tree opens the text again.
    ide.open_file("README.md");
    let path = std::fs::canonicalize(ide.root().join("img/logo.svg")).expect("svg");
    ide.state_mut().open_location(&path, None, true);
    ide.settle();
    assert!(ide.state().ws.tabs.active_editor().is_some_and(|e| e.path == path));
}

const DOC: &str = "# Preview Title\n\nSome **bold**, *italic*, ~~gone~~ and `inline code` text with a [web link](https://example.com/docs) and a [file link](other.md).\n\n## Lists\n\n- first item\n- second item\n  - nested item\n- [x] done task\n- [ ] open task\n\n1. one\n2. two\n\n> A quote that the preview draws dim, with a bar.\n\n```rust\nfn main() {\n    println!(\"hi\");\n}\n```\n\n| Name | Size |\n|:-----|-----:|\n| pic.png | 64×48 |\n| logo.svg | 32×32 |\n\n---\n\n![a picture](img/pic.png) ![remote](https://example.com/x.png)\n";

fn md_repo(fx: &Fixture) -> Repo {
    let repo = image_repo(fx);
    repo.write("doc.md", DOC);
    repo.write("other.md", "# Other\n");
    let long: String = (0..60).map(|i| format!("## Section {i}\n\nParagraph {i} with some words in it.\n\n")).collect();
    repo.write("long.md", &long);
    repo.commit_all("Add docs");
    repo
}

fn mode(ide: &Ide) -> Mode {
    ide.state().ws.tabs.active_editor().and_then(|e| e.markdown.as_ref()).expect("markdown tab").mode
}

#[test]
fn markdown_has_editor_split_and_preview_modes() {
    let fx = Fixture::new(SUITE, "markdown");
    let repo = md_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("doc.md");
    assert_eq!(mode(&ide), Mode::Editor);
    assert!(ide.has("Show Editor and Preview"));
    assert!(!ide.labels().iter().any(|l| l.starts_with("Markdown preview")));

    ide.click("Show Editor and Preview");
    ide.settle();
    assert_eq!(mode(&ide), Mode::Split);
    assert!(ide.has("Markdown preview doc.md"));
    assert!(ide.has("Editor doc.md"), "the editor stays");
    assert!(ide.has("Image a picture"));
    assert!(ide.has("Image remote"), "a remote image shows its alt text");
    ide.snapshot("markdown_split");

    ide.click("Show Preview Only");
    ide.settle();
    assert_eq!(mode(&ide), Mode::Preview);
    assert!(!ide.has("Editor doc.md"));
    ide.snapshot("markdown_preview");

    // A web link goes to the browser, a file link opens the file.
    ide.click("Link web link");
    ide.settle();
    assert!(ide.state().platform.calls().iter().any(|c| c == "open-url https://example.com/docs"), "{:?}", ide.state().platform.calls());
    ide.click("Link file link");
    ide.wait_for("other.md", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path.ends_with("other.md")));
    assert_eq!(mode(&ide), Mode::Editor, "each Markdown tab has its own mode");
    ide.open_file("doc.md");
    assert_eq!(mode(&ide), Mode::Preview);
    ide.click("Show Editor Only");
    assert_eq!(mode(&ide), Mode::Editor);
    assert!(ide.has("Editor doc.md"));
}

#[test]
fn split_mode_scrolls_both_sides_together() {
    let fx = Fixture::new(SUITE, "sync");
    let repo = md_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("long.md");
    ide.click("Show Editor and Preview");
    ide.settle();
    let offset = |ide: &Ide| ide.state().ws.tabs.active_editor().and_then(|e| e.markdown.as_ref()).expect("markdown").offset();
    assert_eq!(offset(&ide), 0.0);

    // The editor scrolls to section 20 (line 80): the preview follows.
    ide.state_mut().ws.tabs.active_editor_mut().expect("editor").view.restore_view(ide_editor::ViewState { line: 80, column: 0, offset: 0.0, x: 0.0 });
    ide.settle();
    let o = offset(&ide);
    assert!(o > 500.0, "the preview followed the editor: {o}");

    // The wheel over the preview moves the editor.
    let p = ide.rect("Markdown preview long.md").center();
    ide.move_to(p);
    ide.harness.input_mut().events.push(Event::MouseWheel { unit: MouseWheelUnit::Point, delta: Vec2::new(0.0, -600.0), modifiers: Modifiers::NONE });
    ide.settle();
    let top = |ide: &Ide| {
        let e = ide.state().ws.tabs.active_editor().expect("editor");
        e.view.view_state(&e.doc).expect("drawn").line
    };
    assert!(top(&ide) > 85, "the editor followed the preview: line {}", top(&ide));
    ide.snapshot("split_synced");
}

/// Opens the worktree diff of `rel` and waits for its pictures.
fn open_diff(ide: &mut Ide, rel: &str) {
    let path = ide.root().join(rel);
    harwex_ide::git::diff::open_worktree_diff(ide.state_mut(), &path);
    let key = format!("diff:wt:{rel}");
    ide.wait_until("diff model", |ide| ide.state().is_idle() && ide.state().ws.tabs.custom_by_key(&key).is_some());
    ide.settle();
}

fn image_labels(ide: &Ide) -> Vec<String> {
    ide.labels().into_iter().filter(|l| l.starts_with("Image ")).collect()
}

#[test]
fn an_image_diff_shows_both_pictures() {
    let fx = Fixture::new(SUITE, "diff");
    let repo = image_repo(&fx);
    write_bytes(&repo, "img/gone.png", &png(16, 16, 0));
    repo.commit_all("Add gone.png");
    write_bytes(&repo, "img/pic.png", &png(80, 40, 90));
    std::fs::remove_file(repo.dir.join("img/gone.png")).expect("rm");
    write_bytes(&repo, "img/added.png", &png(24, 24, 120));
    repo.git(&["add", "img/added.png"]);
    let mut ide = Ide::open(SUITE, &repo.dir);

    open_diff(&mut ide, "img/pic.png");
    let labels = image_labels(&ide);
    assert_eq!(labels.len(), 2, "{labels:?}");
    assert!(labels[0].starts_with("Image old HEAD"), "{labels:?}");
    assert!(labels[1].starts_with("Image new Working tree"), "{labels:?}");
    assert!(ide.shows_text("64×48 PNG"), "HEAD");
    assert!(ide.shows_text("80×40 PNG"), "working tree");
    ide.snapshot("diff_modified");
    // One zoom for both panes.
    ide.click("Zoom In");
    ide.settle();

    open_diff(&mut ide, "img/added.png");
    let labels = image_labels(&ide);
    assert_eq!(labels.len(), 1, "{labels:?}");
    assert!(labels[0].starts_with("Image new"), "{labels:?}");
    ide.snapshot("diff_added");

    open_diff(&mut ide, "img/gone.png");
    let labels = image_labels(&ide);
    assert_eq!(labels.len(), 1, "{labels:?}");
    assert!(labels[0].starts_with("Image old"), "{labels:?}");
}

#[test]
fn an_image_with_a_position_opens_as_text() {
    // Find in Files and navigation pass a position: they never land in the viewer.
    let fx = Fixture::new(SUITE, "position");
    let repo = image_repo(&fx);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let path = std::fs::canonicalize(repo.dir.join("img/logo.svg")).expect("svg");
    ide.state_mut().open_location(&path, Some(ide_editor::Position::new(0, 0)), true);
    ide.wait_for("text tab", |s| s.ws.tabs.active_editor().is_some_and(|e| e.path == path));
}
