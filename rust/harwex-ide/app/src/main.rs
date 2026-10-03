//! harwex-ide: a native IDE shell. `harwex-ide [folder]` opens a folder. Without one it opens
//! the current directory when started from a terminal; from Spotlight or the Dock (cwd `/`) it
//! reopens the last folder or shows "Open Folder" (see `launch::startup_folder`).
//!
//! `HARWEX_IDE_BACKGROUND=1` (implied by any hidden `--test-*` flag) opens the window without
//! activating the app: no Dock icon, no focus change, no switch to another Space. Agents that
//! launch the real window while the user works must use it.

use std::io::IsTerminal;
use std::time::Instant;

use harwex_ide::{launch, testhook, AppOptions, IdeApp};

fn main() -> eframe::Result {
    let start = Instant::now();
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let background = env_flag("HARWEX_IDE_BACKGROUND") || args.iter().any(|a| a.starts_with("--test-"));
    if background {
        // Children (a nested IDE started from the terminal, scripts) inherit the mode. The
        // process has no other threads yet, so changing the environment is safe here.
        std::env::set_var("HARWEX_IDE_BACKGROUND", "1");
    }
    let test = testhook::parse(&mut args);
    let tty = std::io::stdin().is_terminal() || std::io::stdout().is_terminal();
    let cwd = std::env::current_dir().ok();
    let cli_folder = launch::startup_folder(&args, cwd.as_deref(), tty);

    // The title bar is ours (theme: Islands Dark): the content runs under a transparent native
    // title bar, and macOS draws only the traffic lights over it (moved by `chrome::sync`).
    let mut viewport = egui::ViewportBuilder::default()
        .with_inner_size([1400.0, 900.0])
        .with_min_inner_size([640.0, 400.0])
        .with_title("harwex-ide")
        .with_fullsize_content_view(true)
        .with_titlebar_shown(false)
        .with_title_shown(false);
    if background {
        viewport = viewport.with_active(false).with_fullscreen(false).with_maximized(false);
    }
    let mut native = eframe::NativeOptions {
        viewport,
        // A restored window state could be fullscreen, which opens its own Space.
        persist_window: !background,
        ..Default::default()
    };
    if background {
        native.event_loop_builder = Some(Box::new(background_event_loop));
        // Agent and hook runs keep their own storage, so they never replace the user's last
        // folder or tool window layout in ~/Library/Application Support/harwex-ide.
        native.persistence_path = Some(std::env::temp_dir().join("harwex-ide-background.ron"));
    }
    let options = AppOptions { project: cli_folder, test, start, ..AppOptions::default() };
    eframe::run_native("harwex-ide", native, Box::new(move |cc| Ok(Box::new(IdeApp::create(&cc.egui_ctx, cc.storage, options)))))
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| !matches!(v.trim(), "" | "0" | "false" | "no" | "off"))
}

/// An accessory app never becomes the active app on its own, so macOS keeps the user's current
/// app focused and does not switch Spaces to the new window.
#[cfg(target_os = "macos")]
fn background_event_loop(builder: &mut eframe::EventLoopBuilder<eframe::UserEvent>) {
    use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
    builder.with_activation_policy(ActivationPolicy::Accessory).with_activate_ignoring_other_apps(false);
    eprintln!("[harwex-ide] background mode: activation policy Accessory, activate_ignoring_other_apps false, window inactive");
}

#[cfg(not(target_os = "macos"))]
fn background_event_loop(_builder: &mut eframe::EventLoopBuilder<eframe::UserEvent>) {
    eprintln!("[harwex-ide] background mode: window opens inactive");
}
