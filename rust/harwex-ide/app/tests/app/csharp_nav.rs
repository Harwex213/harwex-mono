//! C# navigation through the Roslyn language server, on a solution of two projects (`App`
//! references `Lib`) and on a Unity-shaped project: Cmd+B across projects and into the BCL
//! (a read-only `[decompiled]` tab), Type Definition, Go to Implementation, Find Usages,
//! hover, Rename Symbol with its preview, a compiler error as a diagnostic, Unity detection,
//! the idle stop and a missing server. Runs on the pinned .NET SDK and Roslyn server from
//! `cargo xtask test-tools`; skipped (with a printed reason) without them.

use std::path::PathBuf;
use std::time::Duration;

use crate::common::*;
use egui::{Key, Modifiers};
use harwex_ide::diagnostics::SourceId;
use harwex_ide::lang::LangId;
use ide_editor::ProblemSeverity;

const SUITE: &str = "csharp_nav";

/// A cold solution load runs MSBuild and a restore; on a fresh machine (clean-check) the first
/// `dotnet` start also waits for macOS to check the new binaries.
const COLD: Duration = Duration::from_secs(150);

fn open_program(name: &str) -> Option<(Fixture, Repo, Ide)> {
    open_program_with(name, "")
}

/// `extra` goes into `.harwex/ide.toml` below the `[csharp]` tool paths.
fn open_program_with(name: &str, extra: &str) -> Option<(Fixture, Repo, Ide)> {
    if skip_without_roslyn(name) {
        return None;
    }
    let fx = Fixture::new(SUITE, name);
    let repo = csharp_solution(fx.path("repo"));
    if !extra.is_empty() {
        repo.write(".harwex/ide.toml", &format!("{}{extra}", csharp_ide_toml()));
    }
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.set_wait_budget(COLD);
    ide.open_file("App/Program.cs");
    Some((fx, repo, ide))
}

fn active_path(ide: &Ide) -> String {
    ide.state().ws.tabs.active_editor().map(|e| e.path.display().to_string()).unwrap_or_default()
}

fn active_file(ide: &Ide) -> PathBuf {
    ide.state().ws.tabs.active_editor().map(|e| e.path.clone()).unwrap_or_default()
}

fn wait_for_file(ide: &mut Ide, suffix: &str) {
    let s = suffix.to_string();
    ide.wait_until(&format!("jump to {suffix}"), move |ide| active_path(ide).ends_with(&s));
    ide.settle();
}

/// Waits until the server has loaded the solution, so the status bar is stable.
fn wait_ready(ide: &mut Ide, label: &str) {
    let want = label.to_string();
    ide.wait_until(&format!("C# server ready ({label})"), move |ide| ide.state().ws.langs.status(LangId::CSharp, &active_file(ide)).as_deref() == Some(want.as_str()));
    ide.settle();
}

/// The caret position of the first `needle` on `line` of the active editor.
fn pos_of(ide: &Ide, line: usize, needle: &str) -> egui::Pos2 {
    let text = ide.active_line(line);
    let byte = text.find(needle).unwrap_or_else(|| panic!("{needle:?} not on line {line}: {text:?}"));
    ide.caret_pos(line, text[..byte].chars().count() + 1)
}

/// Stops the servers before the fixture directory goes away.
fn finish(ide: Ide) {
    ide.state().ws.langs.shutdown();
}

#[test]
fn cmd_b_jumps_across_projects() {
    let Some((_fx, _repo, mut ide)) = open_program("cross_project") else { return };
    assert_eq!(ide.state().ws.langs.running(LangId::CSharp), 1, "opening a .cs file starts the C# server");
    assert_eq!(ide.state().ws.langs.running(LangId::TypeScript), 0);
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 0);
    let p = pos_of(&ide, 9, "Greeter");
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "Lib/Greeter.cs");
    assert_eq!(ide.cursor(), (3, 13), "the caret lands on the class name");
    assert!(!ide.state().ws.tabs.active_editor().expect("editor").read_only, "project files stay editable");
    wait_ready(&mut ide, "Roslyn");
    ide.assert_text("Roslyn");
    ide.snapshot("cross_project_greeter");

    // Back returns to the call; Type Definition of `shape` is the interface.
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "App/Program.cs");
    let p = pos_of(&ide, 12, "shape");
    ide.click_at(p);
    ide.cmd_shift(Key::B);
    wait_for_file(&mut ide, "Lib/Shapes.cs");
    assert_eq!(ide.cursor(), (2, 17), "Type Definition of `shape` is `IShape`");

    // Go to Implementation of `Area` offers both shapes.
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "App/Program.cs");
    let p = pos_of(&ide, 13, "Area");
    ide.click_at(p);
    ide.key_mods(Modifiers { alt: true, ..CMD }, Key::B);
    ide.wait_until("implementation chooser", |ide| ide.state().ws.nav.popup.is_some());
    ide.settle();
    let items: Vec<(String, usize)> = ide.state().ws.nav.popup.as_ref().expect("popup").items.iter().map(|t| (t.location.path.display().to_string(), t.location.line)).collect();
    assert_eq!(items.len(), 2, "{items:?}");
    assert!(items[0].1 < items[1].1, "sorted by place: {items:?}");
    assert!(items.iter().all(|(p, _)| p.ends_with("Lib/Shapes.cs")), "{items:?}");
    ide.assert_text("Choose implementation of Area");
    ide.snapshot("implementations_area");
    ide.key(Key::Enter);
    wait_for_file(&mut ide, "Lib/Shapes.cs");
    assert_eq!(ide.state().ws.langs.running(LangId::CSharp), 1, "one server for the whole solution");

    // Budget (rule 9): a warm Go to Declaration answers well under half a second.
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "App/Program.cs");
    let p = pos_of(&ide, 11, "Hello");
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "Lib/Greeter.cs");
    let ms = ide.state().ws.nav.last_ms.expect("latency");
    assert!(ms < 500.0, "warm Go to Declaration took {ms:.1} ms");
    finish(ide);
}

#[test]
fn status_bar_shows_the_solution_load() {
    if skip_without_roslyn("loading") {
        return;
    }
    let fx = Fixture::new(SUITE, "loading");
    let repo = csharp_solution(fx.path("repo"));
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.set_wait_budget(COLD);
    // `open_file` would settle, and the first diagnostics request waits out the load.
    ide.open_file_running("App/Program.cs");
    ide.wait_until("loading label", |ide| ide.shows_text("Roslyn: loading solution…"));
    let label = ide.state().ws.langs.status(LangId::CSharp, &active_file(&ide));
    assert_eq!(label.as_deref(), Some("Roslyn: loading solution…"));
    wait_ready(&mut ide, "Roslyn");
    ide.assert_text("Roslyn");
    finish(ide);
}

#[test]
fn cmd_b_on_a_bcl_type_opens_decompiled_source_read_only() {
    let Some((_fx, repo, mut ide)) = open_program("bcl_type") else { return };
    let p = pos_of(&ide, 10, "List");
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "/List.cs");
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    assert!(e.read_only, "decompiled sources open read-only");
    assert_eq!(e.virtual_kind.as_deref(), Some("decompiled"));
    assert!(!e.path.starts_with(&repo.dir), "never written into the project: {}", e.path.display());
    let line = ide.cursor().0;
    assert!(ide.active_line(line).contains("List"), "landed on {:?}", ide.active_line(line));
    assert!(ide.active_text().contains("public class List<T>"), "decompiled text");
    ide.assert_text("[decompiled] List.cs");
    assert_eq!(ide.state().ws.langs.running(LangId::CSharp), 1, "the decompiled file is served by the same server");
    assert_eq!(ide.state().ws.tabs.active_editor().expect("editor").doc.language(), ide_editor::Language::CSharp, "highlighted as C#");
    // No snapshot: the decompiler's header names the reference assembly's path on this
    // machine, and its length sets the horizontal scrollbar.

    // Navigation goes on from inside the decompiled file.
    let text = ide.active_text();
    let (line, _) = text.lines().enumerate().find(|(_, l)| l.contains("IList<T>")).expect("IList<T> in List.cs");
    let p = pos_of(&ide, line, "IList<T>");
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "/IList.cs");
    assert!(ide.state().ws.tabs.active_editor().expect("editor").read_only);
    ide.assert_text("[decompiled] IList.cs");
    finish(ide);
}

#[test]
fn find_usages_across_projects() {
    let Some((_fx, _repo, mut ide)) = open_program("usages") else { return };
    let p = pos_of(&ide, 11, "Hello");
    ide.right_click_at(p);
    ide.settle();
    ide.click("Find Usages");
    ide.wait_for("usages", |s| s.ws.find_window.active_tab().is_some_and(|t| !t.searching && !t.items.is_empty()));
    ide.settle();
    let items = &ide.state().ws.find_window.active_tab().expect("usages tab").items;
    let in_app = items.iter().filter(|i| i.path.ends_with("App/Program.cs")).count();
    let in_lib: Vec<_> = items.iter().filter(|i| i.path.ends_with("Lib/Greeter.cs")).collect();
    assert_eq!((in_app, in_lib.len()), (2, 1), "{items:?}");
    assert_eq!(in_lib[0].kind, Some(harwex_ide::find_window::UsageKind::Declaration));
    ide.assert_text("Declarations group");
    wait_ready(&mut ide, "Roslyn");
    ide.snapshot("usages_hello");
    finish(ide);
}

#[test]
fn hover_shows_signature_and_docs() {
    let Some((_fx, _repo, mut ide)) = open_program("hover") else { return };
    wait_ready(&mut ide, "Roslyn");
    let p = pos_of(&ide, 11, "Hello");
    ide.move_to(p);
    ide.wait_real(Duration::from_millis(650));
    ide.wait_for("hover info", |s| s.ws.nav.hover.info().is_some());
    ide.wait_until("hover tooltip", |ide| ide.shows_text("string Greeter.Hello(string name)"));
    ide.assert_text("Says hello to someone.");
    ide.snapshot_here("hover_hello");
    finish(ide);
}

#[test]
fn rename_symbol_shows_a_preview_then_edits_both_projects() {
    let Some((_fx, repo, mut ide)) = open_program("rename") else { return };
    wait_ready(&mut ide, "Roslyn");
    let p = pos_of(&ide, 11, "Hello");
    ide.click_at(p);
    ide.key_mods(Modifiers::SHIFT, Key::F6);
    ide.settle();
    assert!(ide.state().ws.nav.rename.is_some(), "Shift+F6 opens Rename Symbol");
    ide.type_text("Greet");
    ide.key(Key::Enter);
    ide.wait_until("rename preview", |ide| ide.shows_text("Rename `Hello` to `Greet`: 3 occurrences in 2 files"));
    ide.snapshot("rename_preview");
    assert!(repo.read("Lib/Greeter.cs").contains("public string Hello("), "nothing changes before Rename");
    ide.key(Key::Enter);
    ide.wait_until("files renamed", |_| repo.read("Lib/Greeter.cs").contains("public string Greet("));
    ide.settle();
    assert!(ide.state().ws.nav.rename.is_none());
    let program = repo.read("App/Program.cs");
    assert!(program.contains("greeter.Greet(\"world\")") && program.contains("greeter.Greet(\"again\")"), "{program}");
    assert!(!ide.state().ws.tabs.active_editor().expect("editor").doc.is_dirty(), "the open file is saved");
    finish(ide);
}

#[test]
fn compiler_error_becomes_a_diagnostic() {
    let Some((_fx, _repo, mut ide)) = open_program("diagnostic") else { return };
    ide.wait_for("clean file checked", |s| s.ws.tabs.active_editor().is_some_and(|e| e.problems.checked()));
    let errors = ide.state().ws.tabs.active_editor().expect("editor").problems.count(ProblemSeverity::Error);
    assert_eq!(errors, 0, "the fixture compiles: types from Lib resolve once the solution is loaded");
    // At the end of line 13; Enter keeps the indent.
    let end = ide.active_line(13).chars().count();
    let p = ide.caret_pos(13, end);
    ide.click_at(p);
    ide.key(Key::End);
    ide.type_text("\nint broken = \"text\";");
    ide.wait_for("CS0029", |s| {
        s.ws.tabs.active_editor().is_some_and(|e| e.problems.current.iter().any(|p| p.source == SourceId::CSharp && p.severity == ProblemSeverity::Error))
    });
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    let err = e.problems.current.iter().find(|p| p.severity == ProblemSeverity::Error).expect("error");
    assert!(err.message.contains("Cannot implicitly convert type 'string' to 'int'"), "{}", err.message);
    assert_eq!(e.doc.char_to_position(err.start).line, 14, "the error sits on the typed line");
    assert_eq!(err.origin(), "csharp(CS0029)");
    wait_ready(&mut ide, "Roslyn");
    ide.snapshot("compiler_error");
    finish(ide);
}

#[test]
fn unity_project_is_detected_and_navigates() {
    if skip_without_roslyn("unity") {
        return;
    }
    let fx = Fixture::new(SUITE, "unity");
    let repo = unity_project(&fx.dir, true);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.set_wait_budget(COLD);
    ide.open_file("Assets/Scripts/Player.cs");
    let p = pos_of(&ide, 9, "Spawner");
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "Assets/Scripts/Spawner.cs");
    assert_eq!(ide.cursor(), (2, 13));
    wait_ready(&mut ide, "Roslyn (Unity)");
    ide.assert_text("Roslyn (Unity)");
    ide.snapshot("unity_spawner");

    // `MonoBehaviour` lives in the referenced UnityEngine.dll: a decompiled, read-only tab.
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "Assets/Scripts/Player.cs");
    let p = pos_of(&ide, 2, "MonoBehaviour");
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "/MonoBehaviour.cs");
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    assert!(e.read_only);
    assert!(ide.active_text().contains("class MonoBehaviour : Behaviour"), "{}", ide.active_text());
    // No snapshot here: the decompiler's log at the end of the file names paths of this machine.
    ide.assert_text("[decompiled] MonoBehaviour.cs");
    finish(ide);
}

#[test]
fn unity_project_without_solution_says_how_to_generate_it() {
    if skip_without_roslyn("unity_no_sln") {
        return;
    }
    let fx = Fixture::new(SUITE, "unity_no_sln");
    let repo = unity_project(&fx.dir, false);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("Assets/Scripts/Player.cs");
    ide.wait_until("unity toast", |ide| ide.shows_text("Unity project files are missing"));
    ide.assert_text("Regenerate project files");
    assert_eq!(ide.state().ws.langs.running(LangId::CSharp), 0, "no solution, no server");
    ide.snapshot("unity_no_solution");
}

#[test]
fn idle_server_stops_after_the_last_file_closes() {
    let Some((_fx, _repo, mut ide)) = open_program_with("idle", "idle_timeout_secs = 0.5\n") else { return };
    assert_eq!(ide.state().ws.langs.running(LangId::CSharp), 1);
    ide.wait_real(Duration::from_millis(1200));
    assert_eq!(ide.state().ws.langs.running(LangId::CSharp), 1, "an open .cs file keeps the server running");
    ide.cmd(Key::W);
    ide.settle();
    ide.wait_until("idle stop", |ide| ide.state().ws.langs.running(LangId::CSharp) == 0);
    ide.open_file("Lib/Greeter.cs");
    assert_eq!(ide.state().ws.langs.running(LangId::CSharp), 1, "a C# file starts a fresh server");
    finish(ide);
}

#[test]
fn missing_server_says_how_to_install() {
    // Needs no tools: the configured path is wrong on purpose.
    let fx = Fixture::new(SUITE, "missing");
    let repo = Repo::init(fx.path("repo"));
    repo.write("Shop.sln", "");
    repo.write("App/App.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");
    repo.write("App/Program.cs", "class Program { }\n");
    repo.write(".harwex/ide.toml", "[csharp]\nserver = \"/nonexistent/roslyn\"\n");
    repo.commit_all("missing");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("App/Program.cs");
    ide.wait_until("missing toast", |ide| ide.shows_text("C# language server not found"));
    ide.assert_text("dotnet tool install --global roslyn-language-server");
    assert_eq!(ide.state().ws.langs.running(LangId::CSharp), 0);
    let path = active_file(&ide);
    assert_eq!(ide.state().ws.langs.status(LangId::CSharp, &path).as_deref(), Some("no Roslyn"));
    ide.snapshot("missing_server");
}
