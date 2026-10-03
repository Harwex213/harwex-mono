//! Headless snapshots of the glyphs the terminal draws itself (block elements, sextants, the
//! Claude Code logo and spinner). References live in `tests/snapshots/`.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use egui::{FontData, FontDefinitions, FontFamily, Vec2};
use egui_kittest::{Harness, SnapshotError, SnapshotOptions};
use ide_term::{SpawnOptions, Terminal, TerminalView};

/// Pixels that may differ before a snapshot fails (anti-aliasing noise between GPU runs).
const MAX_DIFF_PIXELS: i32 = 64;

/// The app's monospace stack: JetBrains Mono, then Inter, then egui's own fonts.
fn install_app_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    let add = |fonts: &mut FontDefinitions, name: &str, bytes: &'static [u8]| {
        fonts
            .font_data
            .insert(name.to_string(), Arc::new(FontData::from_static(bytes)));
    };
    add(
        &mut fonts,
        "Inter",
        include_bytes!("../../../app/assets/fonts/Inter-Regular.ttf"),
    );
    add(
        &mut fonts,
        "JetBrains Mono",
        include_bytes!("../../../app/assets/fonts/JetBrainsMono-Regular.ttf"),
    );
    let mono = fonts.families.entry(FontFamily::Monospace).or_default();
    mono.insert(0, "JetBrains Mono".into());
    mono.insert(1, "Inter".into());
    ctx.set_fonts(fonts);
}

/// Shows `bytes` in a terminal of `size` points and compares the frame with `name`.png.
fn snapshot_bytes(name: &str, size: Vec2, ppp: f32, bytes: &[u8]) {
    let file = std::env::temp_dir().join(format!("ide-term-glyphs-{name}-{}", std::process::id()));
    std::fs::write(&file, bytes).unwrap();
    let mut harness = Harness::builder()
        .with_size(size)
        .with_pixels_per_point(ppp)
        .wgpu()
        .build_ui_state(
            |ui, term: &mut Option<Terminal>| {
                if let Some(term) = term {
                    TerminalView::new(term).font_size(13.0).show(ui);
                }
            },
            None,
        );
    install_app_fonts(&harness.ctx);
    // The script waits for a line, so the bytes land after the view has sized the grid.
    let mut options = SpawnOptions::new(&std::env::temp_dir());
    options.command = Some(vec![
        "/bin/sh".into(),
        "-c".into(),
        "stty -echo; read x; cat \"$1\"; read y".into(),
        "sh".into(),
        file.to_string_lossy().into_owned(),
    ]);
    *harness.state_mut() = Some(Terminal::spawn_with(options, harness.ctx.clone()).unwrap());
    harness.run_steps(3);
    harness.state().as_ref().unwrap().write(b"\n".to_vec());
    let marker = "END";
    let start = Instant::now();
    loop {
        harness.run_steps(1);
        let text = harness.state().as_ref().unwrap().screen_text();
        if text.contains(marker) {
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "screen was:\n{text}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    harness.run_steps(2);
    let _ = std::fs::remove_file(&file);

    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/snapshots");
    let options = SnapshotOptions::new().output_path(&dir);
    match harness.try_snapshot_options(name, &options) {
        Ok(()) => {}
        Err(SnapshotError::Diff { diff, .. }) if diff <= MAX_DIFF_PIXELS => {
            let _ = std::fs::remove_file(dir.join(format!("{name}.diff.png")));
        }
        Err(e) => panic!("{e}"),
    }
    let _ = std::fs::remove_file(dir.join(format!("{name}.new.png")));
}

const ORANGE: &str = "\x1b[38;2;215;119;87m";
const RESET: &str = "\x1b[0m";

/// The Claude Code banner (the classic logo and the current one), its spinner, and every
/// procedurally drawn range.
fn banner() -> String {
    let mut s = String::new();
    // Claude Code 2.0 banner.
    s += &format!("{ORANGE} ▐▛███▜▌{RESET}   \x1b[1mClaude Code\x1b[0m v2.1.288\r\n");
    s += &format!("{ORANGE}▝▜█████▛▘{RESET}  Opus 5.5 · Claude Max\r\n");
    s += &format!("{ORANGE}  ▘▘ ▝▝{RESET}    ~/Projects/harwex-mono\r\n\r\n");
    // The current banner as Claude Code 2.1.288 paints it (`Bge` in its bundle): the eyes and
    // the body sit on a black background, so the eyes are the black quadrant a glyph leaves out.
    let eyes = "\x1b[38;2;215;119;87;48;2;0;0;0m";
    s += &format!("{ORANGE} ▐{eyes}▛███▛█{RESET}   \x1b[1mClaude Code\x1b[0m v2.1.288\r\n");
    s += &format!("{ORANGE}▝▜{eyes}█████{RESET}{ORANGE}█▀{RESET}  Opus 5.5 · Claude Max\r\n");
    s += &format!("{ORANGE} ▝▝   ▝▝ {RESET}  ~/Projects/harwex-mono\r\n\r\n");
    // Spinner frames, then a spinner line as Claude Code draws it.
    s += &format!(
        "{ORANGE}· ✢ ✳ ✶ ✻ ✽ *{RESET}   {ORANGE}✻{RESET} Thinking… (esc to interrupt)\r\n"
    );
    s += "⏺ Read(src/main.rs)\r\n  ⎿  Read 42 lines\r\n\r\n";
    // Every block element, packed and spaced.
    let blocks: String = (0x2580..=0x259F).filter_map(char::from_u32).collect();
    let spaced: String = blocks.chars().flat_map(|c| [c, ' ']).collect();
    s += &format!("{blocks}  {spaced}\r\n");
    // Rows of full blocks and shades must touch with no seam.
    for _ in 0..2 {
        s += &format!("{ORANGE}██████{RESET} ░░░░ ▒▒▒▒ ▓▓▓▓ \x1b[44m▀▀▄▄▌▐\x1b[0m ┃┃│ ╋━━┿\r\n");
    }
    // Sextants (Symbols for Legacy Computing).
    let sextants: String = (0x1FB00..=0x1FB3B).filter_map(char::from_u32).collect();
    s += &format!("{sextants}\r\n");
    s += "END";
    s
}

#[test]
fn claude_code_banner() {
    snapshot_bytes(
        "claude_code_banner",
        Vec2::new(720.0, 360.0),
        1.0,
        banner().as_bytes(),
    );
}

#[test]
fn claude_code_banner_retina() {
    snapshot_bytes(
        "claude_code_banner_2x",
        Vec2::new(720.0, 360.0),
        2.0,
        banner().as_bytes(),
    );
}
