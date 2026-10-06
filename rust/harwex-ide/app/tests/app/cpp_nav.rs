//! C and C++ through clangd in a temp CMake-style project (`include/`, `src/`, and
//! `build/compile_commands.json` as CMake writes it): Cmd+B across files and back to the
//! definition, into `<vector>` (read-only), Type Definition, Implementation, Find Usages, hover,
//! Rename Symbol with its preview, a type error as a diagnostic, the fallback without a
//! database, the idle stop and a missing clangd. Skipped (with a printed reason) without the
//! pinned clangd; the tests never use a clangd from PATH or Xcode.

use std::path::{Path, PathBuf};

use crate::common::*;
use egui::{Key, Modifiers};
use harwex_ide::diagnostics::SourceId;
use harwex_ide::lang::LangId;
use ide_editor::ProblemSeverity;

const SUITE: &str = "cpp_nav";

const GEOMETRY_H: &str = "#pragma once\n#include <vector>\n\n/// A point on a plane.\nstruct Point {\n    int x;\n    int y;\n};\n\n/// Adds two numbers.\nint add(int a, int b);\n\nclass Shape {\npublic:\n    virtual ~Shape() = default;\n    virtual int area() const = 0;\n};\n\nclass Square : public Shape {\npublic:\n    explicit Square(int side) : side_(side) {}\n    int area() const override;\n\nprivate:\n    int side_;\n};\n";
const GEOMETRY_CPP: &str = "#include \"geometry.h\"\n\nint add(int a, int b) { return a + b; }\n\nint Square::area() const { return side_ * side_; }\n";
const MAIN_CPP: &str = "#include \"geometry.h\"\n\nint main() {\n    int total = add(1, 2);\n    Point p{1, 2};\n    std::vector<int> values;\n    Square sq(3);\n    total += add(p.x, sq.area());\n    return total + static_cast<int>(values.size());\n}\n";

/// The pinned clangd, or `None` after printing why the test is skipped.
fn pinned_clangd(test: &str) -> Option<PathBuf> {
    init();
    match clangd() {
        Ok(p) => Some(p),
        Err(why) => {
            eprintln!("skipping {test}: {why}");
            None
        }
    }
}

fn ide_toml(clangd: &Path, extra: &str) -> String {
    format!("[cpp]\nclangd = \"{}\"\n{extra}", clangd.display())
}

/// The CMake-style project: sources, headers and `build/compile_commands.json`.
fn cpp_project(dir: PathBuf, clangd: &Path, extra: &str) -> Repo {
    let r = Repo::init(dir);
    r.write(".gitignore", "build/\n.cache/\n");
    r.write("CMakeLists.txt", "cmake_minimum_required(VERSION 3.20)\nproject(geometry CXX)\nset(CMAKE_CXX_STANDARD 17)\nadd_executable(app src/main.cpp src/geometry.cpp)\ntarget_include_directories(app PRIVATE include)\n");
    r.write("include/geometry.h", GEOMETRY_H);
    r.write("src/geometry.cpp", GEOMETRY_CPP);
    r.write("src/main.cpp", MAIN_CPP);
    r.write(".harwex/ide.toml", &ide_toml(clangd, extra));
    let root = r.dir.display().to_string();
    let entry = |file: &str| format!("{{\"directory\": \"{root}/build\", \"file\": \"{root}/{file}\", \"arguments\": [\"c++\", \"-std=c++17\", \"-I{root}/include\", \"-c\", \"{root}/{file}\"]}}");
    r.write("build/compile_commands.json", &format!("[\n{},\n{}\n]\n", entry("src/main.cpp"), entry("src/geometry.cpp")));
    r.commit_all("C++ project");
    r
}

fn open_main(name: &str, extra: &str) -> Option<(Fixture, Repo, Ide)> {
    let clangd = pinned_clangd(name)?;
    let fx = Fixture::new(SUITE, name);
    let repo = cpp_project(fx.path("repo"), &clangd, extra);
    let mut ide = Ide::open(SUITE, &repo.dir);
    // clangd's first parse of `<vector>` and the first index take a few seconds cold.
    ide.set_wait_budget(std::time::Duration::from_secs(90));
    ide.open_file("src/main.cpp");
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

/// Waits until clangd has indexed the project, so the status bar is stable.
fn wait_ready(ide: &mut Ide) {
    ide.wait_until("clangd indexed", |ide| ide.state().ws.langs.status(LangId::Cpp, &active_file(ide)).is_some_and(|s| s.starts_with("clangd ") && !s.contains("indexing")));
    ide.settle();
}

/// Stops the servers before the fixture directory goes away.
fn finish(ide: Ide) {
    ide.state().ws.langs.shutdown();
}

#[test]
fn cmd_b_jumps_to_declaration_then_definition() {
    let Some((_fx, _repo, mut ide)) = open_main("cross_file", "") else { return };
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 1, "opening a .cpp file starts clangd");
    assert_eq!(ide.state().ws.langs.running(LangId::Rust), 0, "a C++ project never starts rust-analyzer");
    // `add` in `int total = add(1, 2);`: the declaration in the header.
    let p = ide.caret_pos(3, 17);
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "include/geometry.h");
    assert_eq!(ide.cursor(), (10, 4), "the caret lands on the declared name");
    assert!(!ide.state().ws.tabs.active_editor().expect("editor").read_only, "project headers stay editable");
    // Cmd+B on the declaration goes on to the definition, like IDEA.
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "src/geometry.cpp");
    assert_eq!(ide.cursor(), (2, 4));
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 1, "one clangd for the whole project");
    wait_ready(&mut ide);
    ide.assert_text("clangd 22.1.6");
    ide.snapshot("definition_add");

    // Back twice returns to the call; Type Definition of `p` is `struct Point`.
    ide.cmd(Key::OpenBracket);
    ide.cmd(Key::OpenBracket);
    wait_for_file(&mut ide, "src/main.cpp");
    let p = ide.caret_pos(4, 10);
    ide.click_at(p);
    ide.cmd_shift(Key::B);
    wait_for_file(&mut ide, "include/geometry.h");
    assert_eq!(ide.cursor(), (4, 7), "Type Definition of `p` is `struct Point`");

    // Go to Implementation on the pure virtual `Shape::area` lands on the override.
    let p = ide.caret_pos(15, 18);
    ide.click_at(p);
    ide.key_mods(Modifiers { alt: true, ..CMD }, Key::B);
    ide.wait_until("implementation", |ide| ide.cursor().0 != 15 || ide.state().ws.nav.popup.is_some());
    ide.settle();
    let line = ide.cursor().0;
    let path = active_path(&ide);
    assert!(path.ends_with("include/geometry.h") && line == 21 || path.ends_with("src/geometry.cpp") && line == 4, "landed on {path}:{line}");
    finish(ide);
}

#[test]
fn cmd_b_into_vector_opens_a_read_only_system_header() {
    let Some((_fx, _repo, mut ide)) = open_main("std_vector", "") else { return };
    // `vector` in `std::vector<int> values;`
    let p = ide.caret_pos(5, 11);
    ide.click_at(p);
    ide.cmd(Key::B);
    ide.wait_until("jump into the STL", |ide| !active_path(ide).ends_with("src/main.cpp"));
    ide.settle();
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    assert!(e.read_only, "system headers open read-only: {}", e.path.display());
    assert!(e.path.components().any(|c| c.as_os_str() == "c++"), "a libc++ header: {}", e.path.display());
    assert_eq!(e.lang, Some(LangId::Cpp), "the header is C++ even without an extension");
    let line = ide.cursor().0;
    assert!(ide.active_line(line).contains("vector"), "landed on {:?}", ide.active_line(line));
    // The header is served by the project's clangd; no server starts for the SDK.
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 1);
    wait_ready(&mut ide);
    ide.settle();
    finish(ide);
}

#[test]
fn find_usages_across_files() {
    let Some((_fx, _repo, mut ide)) = open_main("usages", "") else { return };
    let p = ide.char_pos(3, 17);
    ide.right_click_at(p);
    ide.settle();
    ide.click("Find Usages");
    ide.wait_for("usages", |s| s.ws.find_window.active_tab().is_some_and(|t| !t.searching && !t.items.is_empty()));
    ide.settle();
    let items = &ide.state().ws.find_window.active_tab().expect("usages tab").items;
    let count = |suffix: &str| items.iter().filter(|i| i.path.ends_with(suffix)).count();
    // Two calls, the declaration and the definition (the last two from the background index).
    assert_eq!((count("src/main.cpp"), count("include/geometry.h"), count("src/geometry.cpp")), (2, 1, 1), "{items:?}");
    wait_ready(&mut ide);
    ide.snapshot("usages_add");
    finish(ide);
}

#[test]
fn hover_shows_signature_and_docs() {
    let Some((_fx, _repo, mut ide)) = open_main("hover", "") else { return };
    let p = ide.char_pos(3, 17);
    ide.move_to(p);
    ide.wait_real(std::time::Duration::from_millis(650));
    ide.wait_for("hover info", |s| s.ws.nav.hover.info().is_some());
    ide.wait_until("hover tooltip", |ide| ide.shows_text("int add(int a, int b)"));
    ide.assert_text("Adds two numbers.");
    wait_ready(&mut ide);
    ide.snapshot_here("hover_add");
    finish(ide);
}

#[test]
fn rename_symbol_shows_a_preview_then_edits_every_file() {
    let Some((_fx, repo, mut ide)) = open_main("rename", "") else { return };
    let p = ide.caret_pos(3, 17);
    ide.click_at(p);
    ide.key_mods(Modifiers::SHIFT, Key::F6);
    ide.settle();
    assert!(ide.state().ws.nav.rename.is_some(), "Shift+F6 opens Rename Symbol");
    ide.assert_text("Rename Symbol");
    // The old name is selected, so typing replaces it.
    ide.type_text("sum");
    ide.key(Key::Enter);
    ide.wait_until("rename preview", |ide| ide.shows_text("Rename `add` to `sum`: 4 occurrences in 3 files"));
    wait_ready(&mut ide);
    ide.snapshot("rename_preview");
    assert!(repo.read("include/geometry.h").contains("int add(int a, int b);"), "nothing changes before Rename");
    ide.key(Key::Enter);
    ide.wait_until("files renamed", |_| repo.read("src/geometry.cpp").contains("int sum(int a, int b)"));
    ide.settle();
    assert!(ide.state().ws.nav.rename.is_none());
    assert!(repo.read("include/geometry.h").contains("int sum(int a, int b);"));
    let main = repo.read("src/main.cpp");
    assert!(main.contains("int total = sum(1, 2);") && main.contains("total += sum(p.x, sq.area());"), "{main}");
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    assert!(!e.doc.is_dirty(), "the open file is saved");
    assert!(ide.active_text().contains("sum(1, 2)"));
    finish(ide);
}

#[test]
fn type_error_becomes_a_diagnostic() {
    let Some((_fx, _repo, mut ide)) = open_main("diagnostic", "") else { return };
    ide.wait_for("clean file checked", |s| s.ws.tabs.active_editor().is_some_and(|e| e.problems.checked()));
    assert_eq!(ide.state().ws.tabs.active_editor().expect("editor").problems.count(ProblemSeverity::Error), 0);
    let p = ide.caret_pos(8, 0);
    ide.click_at(p);
    ide.type_text("    int bad = \"text\";\n");
    ide.wait_for("clangd error", |s| {
        s.ws.tabs.active_editor().is_some_and(|e| e.problems.current.iter().any(|p| p.source == SourceId::Clangd && p.severity == ProblemSeverity::Error))
    });
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    let err = e.problems.current.iter().find(|p| p.severity == ProblemSeverity::Error).expect("error");
    assert!(err.message.contains("annot initialize a variable of type 'int'"), "{}", err.message);
    assert_eq!(e.doc.char_to_position(err.start).line, 8, "the error sits on the typed line");
    assert!(err.origin().starts_with("clangd"), "{}", err.origin());
    wait_ready(&mut ide);
    ide.snapshot("type_error");
    finish(ide);
}

#[test]
fn without_a_database_clangd_falls_back_and_says_how_to_get_one() {
    let Some(clangd) = pinned_clangd("fallback") else { return };
    let fx = Fixture::new(SUITE, "fallback");
    let repo = Repo::init(fx.path("repo"));
    repo.write("src/util.h", "#pragma once\n\ninline int twice(int x) { return 2 * x; }\n");
    repo.write("src/main.cpp", "#include \"util.h\"\n\nint main() {\n    return twice(21);\n}\n");
    repo.write(".harwex/ide.toml", &ide_toml(&clangd, ""));
    repo.commit_all("no database");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.set_wait_budget(std::time::Duration::from_secs(90));
    ide.open_file("src/main.cpp");
    ide.wait_until("database hint", |ide| ide.shows_text("No compile_commands.json"));
    ide.assert_text("CMAKE_EXPORT_COMPILE_COMMANDS");
    let p = ide.caret_pos(3, 13);
    ide.click_at(p);
    ide.cmd(Key::B);
    wait_for_file(&mut ide, "src/util.h");
    assert_eq!(ide.cursor(), (2, 11));
    ide.assert_text("clangd 22.1.6");
    ide.snapshot("fallback_hint");
    finish(ide);
}

#[test]
fn idle_server_stops_after_the_last_file_closes() {
    let Some((_fx, _repo, mut ide)) = open_main("idle", "idle_timeout_secs = 0.5\n") else { return };
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 1);
    ide.wait_real(std::time::Duration::from_millis(1200));
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 1, "an open .cpp file keeps clangd running");
    ide.cmd(Key::W);
    ide.settle();
    ide.wait_until("idle stop", |ide| ide.state().ws.langs.running(LangId::Cpp) == 0);
    ide.open_file("include/geometry.h");
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 1, "a header starts it again");
    finish(ide);
}

#[test]
fn missing_clangd_says_how_to_install() {
    // Needs no clangd: the configured path is wrong on purpose.
    let fx = Fixture::new(SUITE, "missing");
    let repo = Repo::init(fx.path("repo"));
    repo.write("main.c", "int main(void) { return 0; }\n");
    repo.write(".harwex/ide.toml", "[cpp]\nclangd = \"/nonexistent/clangd\"\n");
    repo.commit_all("c");
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.open_file("main.c");
    ide.wait_until("missing toast", |ide| ide.shows_text("clangd not found"));
    ide.assert_text("[cpp]");
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 0);
    let path = active_file(&ide);
    assert_eq!(ide.state().ws.langs.status(LangId::Cpp, &path).as_deref(), Some("no clangd"));
}
