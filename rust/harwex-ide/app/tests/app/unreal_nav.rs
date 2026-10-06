//! Unreal Engine projects (task 085) on a synthetic fixture: a `Game.uproject` with
//! `Source/Game/…`, and a fake engine tree (`UE_5.4/Engine/…`) with a few headers and a fake
//! `Build.sh` that writes `compile_commands.json` like UnrealBuildTool's
//! `-mode=GenerateClangDatabase`. No real Unreal or Epic tool runs. Covered: detection and the
//! banner, the confirmation, the generate action (a worker, Stop kills the fake UBT, then clangd
//! restarts with the database), Cmd+B from a game class into an engine header (read-only) and
//! the missing `.generated.h` hint. Tests that start clangd skip without the pinned one.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::common::*;
use egui::Key;
use harwex_ide::lang::{HoverInfo, LangId, LanguageServer, Location, Reference};
use harwex_ide::nav::NavKind;
use harwex_ide::lang::unreal::UnrealProject;
use harwex_ide::unreal::{active_project, status_label, ACTION, BUSY_TITLE, CHOICE_TITLE};

const SUITE: &str = "unreal_nav";

const CORE_MINIMAL_H: &str = "#pragma once\n\n// UHT markers expand to nothing for the compiler.\n#define UCLASS(...)\n#define UPROPERTY(...)\n#define GENERATED_BODY()\n\nusing int32 = int;\n";
const ACTOR_H: &str = "#pragma once\n#include \"CoreMinimal.h\"\n\n/// The base class of every placed object.\nclass AActor {\npublic:\n    virtual ~AActor() = default;\n    virtual void BeginPlay();\n};\n";
const ACTOR_CPP: &str = "#include \"GameFramework/Actor.h\"\n\nvoid AActor::BeginPlay() {}\n";
const MY_ACTOR_H: &str = "#pragma once\n#include \"CoreMinimal.h\"\n#include \"GameFramework/Actor.h\"\n#include \"MyActor.generated.h\"\n\nUCLASS()\nclass AMyActor : public AActor {\n    GENERATED_BODY()\npublic:\n    UPROPERTY()\n    int32 Health = 100;\n};\n";
const MY_ACTOR_CPP: &str = "#include \"MyActor.h\"\n\nvoid Touch(AMyActor& a) {\n    a.BeginPlay();\n}\n";

struct Unreal {
    _fx: Fixture,
    repo: Repo,
    engine: PathBuf,
    /// The fake UBT writes its pid and its child's pid here.
    pids: PathBuf,
}

/// The fake `Build.sh`: prints like UBT, waits while `<fx>/<engine>.slow` exists (for Stop),
/// and writes the database into `-OutputDir`: every `.cpp` under the project's `Source` (from
/// `-project=`) plus one engine file, with this engine's include paths.
fn build_sh(fx: &Fixture, engine: &Path) -> String {
    let tag = engine.file_name().expect("engine folder").to_string_lossy().into_owned();
    r#"#!/bin/sh
# A fake UnrealBuildTool for the tests.
echo "$$" > '@PIDS@'
echo "Running UnrealBuildTool $*"
out=''
proj=''
for a in "$@"; do case "$a" in -OutputDir=*) out="${a#-OutputDir=}";; -project=*) proj="${a#-project=}";; esac; done
dir=$(dirname "$proj")
name=$(basename "$proj" .uproject)
echo 'Creating target...'
if [ -f '@SLOW@' ]; then sleep 60 & echo "$!" >> '@PIDS@'; wait; fi
echo 'Writing database...'
inc="-I@CORE@ -I@CLASSES@ -I$dir/Intermediate/Build/Mac/UnrealEditor/Inc/$name/UHT"
sep=' '
{
  echo '['
  for f in $(find "$dir/Source" -name '*.cpp' | sort) '@ENGINE_CPP@'; do
    printf '%s{"file": "%s", "command": "c++ -std=c++17 %s -c %s", "directory": "@EDIR@"}\n' "$sep" "$f" "$inc" "$f"
    sep=','
  done
  echo ']'
} > "$out/compile_commands.json"
echo "ClangDatabase written to $out/compile_commands.json"
"#
    .replace("@PIDS@", &fx.path(&format!("{tag}.pids")).display().to_string())
    .replace("@SLOW@", &fx.path(&format!("{tag}.slow")).display().to_string())
    .replace("@CORE@", &engine.join("Engine/Source/Runtime/Core/Public").display().to_string())
    .replace("@CLASSES@", &engine.join("Engine/Source/Runtime/Engine/Classes").display().to_string())
    .replace("@ENGINE_CPP@", &engine.join("Engine/Source/Runtime/Engine/Private/Actor.cpp").display().to_string())
    .replace("@EDIR@", &engine.join("Engine/Source").display().to_string())
}

/// A fake engine `<fx>/<folder>` with `Build.version`, a few headers and the fake `Build.sh`.
fn fake_engine(fx: &Fixture, folder: &str, version: (u32, u32, u32)) -> PathBuf {
    let engine = fx.path(folder);
    write(&engine, "Engine/Build/Build.version", &format!("{{\"MajorVersion\": {}, \"MinorVersion\": {}, \"PatchVersion\": {}, \"Changelist\": 0}}\n", version.0, version.1, version.2));
    write(&engine, "Engine/Source/Runtime/Core/Public/CoreMinimal.h", CORE_MINIMAL_H);
    write(&engine, "Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h", ACTOR_H);
    write(&engine, "Engine/Source/Runtime/Engine/Private/Actor.cpp", ACTOR_CPP);
    for platform in ["Mac", "Linux"] {
        let rel = format!("Engine/Build/BatchFiles/{platform}/Build.sh");
        write(&engine, &rel, &build_sh(fx, &engine));
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(engine.join(&rel), std::fs::Permissions::from_mode(0o755)).expect("chmod Build.sh");
    }
    engine
}

/// A game in `<repo>/<dir>`: `<uproject>.uproject`, its targets and `Source/<module>/…`.
/// `generated`: UHT's headers exist (the project was built).
fn game(repo: &Repo, dir: &str, uproject: &str, module: &str, association: &str, generated: bool) {
    let at = |rel: &str| if dir.is_empty() { rel.to_string() } else { format!("{dir}/{rel}") };
    repo.write(&at(&format!("{uproject}.uproject")), &format!("{{\n\t\"FileVersion\": 3,\n\t\"EngineAssociation\": \"{association}\",\n\t\"Modules\": [{{\"Name\": \"{module}\", \"Type\": \"Runtime\"}}]\n}}\n"));
    repo.write(&at(&format!("Source/{uproject}.Target.cs")), "// TargetType.Game\n");
    repo.write(&at(&format!("Source/{uproject}Editor.Target.cs")), "// TargetType.Editor\n");
    repo.write(&at(&format!("Source/{module}/MyActor.h")), MY_ACTOR_H);
    repo.write(&at(&format!("Source/{module}/MyActor.cpp")), MY_ACTOR_CPP);
    repo.write(&at(&format!("Source/{module}/{module}.cpp")), "#include \"CoreMinimal.h\"\n");
    if generated {
        repo.write(&at(&format!("Intermediate/Build/Mac/UnrealEditor/Inc/{module}/UHT/MyActor.generated.h")), "#pragma once\n");
    }
}

/// The project and the fake engine. `generated`: UHT's headers exist (the project was built).
fn unreal_project(name: &str, toml_extra: &str, generated: bool) -> Unreal {
    init();
    let fx = Fixture::new(SUITE, name);
    let engine = fake_engine(&fx, "UE_5.4", (5, 4, 4));
    let repo = Repo::init(fx.path("Game"));
    repo.write(".gitignore", "Intermediate/\nSaved/\n");
    game(&repo, "", "Game", "Game", "5.4", generated);
    repo.write(".harwex/ide.toml", &format!("[unreal]\nengine = \"{}\"\n{toml_extra}", engine.display()));
    repo.commit_all("Unreal project");
    Unreal { pids: fx.path("UE_5.4.pids"), _fx: fx, repo, engine }
}

/// `[cpp] clangd` with the pinned clangd, or `None` after printing why the test is skipped.
fn clangd_toml(test: &str) -> Option<String> {
    init();
    match clangd() {
        Ok(p) => Some(format!("[cpp]\nclangd = \"{}\"\n", p.display())),
        Err(why) => {
            eprintln!("skipping {test}: {why}");
            None
        }
    }
}

/// Waits until the active file's project is detected and returns it.
fn detected(ide: &mut Ide, name: &str) -> UnrealProject {
    ide.wait_for("Unreal project detected", |s| active_project(s).is_some_and(|p| p.name == name));
    active_project(ide.state()).cloned().expect("project")
}

fn active_path(ide: &Ide) -> String {
    ide.state().ws.tabs.active_editor().map(|e| e.path.display().to_string()).unwrap_or_default()
}

fn alive(pid: &str) -> bool {
    std::process::Command::new("kill").args(["-0", pid.trim()]).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
}

#[test]
fn detects_the_project_and_asks_before_generating() {
    // Highlighting only: no language server, so no clangd hint covers the banner.
    let u = unreal_project("detect", "", true);
    u.repo.write(".harwex/ide.toml", &format!("languages = [\"ts\"]\n[unreal]\nengine = \"{}\"\n", u.engine.display()));
    let mut ide = Ide::open(SUITE, &u.repo.dir);
    // The banner shows only while a C/C++ file of the project is active.
    ide.open_file("Game.uproject");
    ide.settle();
    ide.assert_no_text(ACTION);
    assert!(ide.state().ws.unreal.projects.is_empty(), "nothing is detected before a C/C++ file opens");
    ide.open_file("Source/Game/MyActor.cpp");
    {
        let p = detected(&mut ide, "Game");
        assert_eq!((p.name.as_str(), p.association.as_str(), p.has_db), ("Game", "5.4", false));
        let engine = p.engine.as_ref().expect("engine");
        assert_eq!(engine.root, u.engine);
        assert_eq!(engine.version.as_deref(), Some("5.4.4"));
        assert_eq!(p.target.as_deref(), Ok("GameEditor"));
    }
    ide.settle();
    ide.assert_text("Game: no compile database for clangd yet (Unreal Engine 5.4.4).");
    ide.assert_text("Game · UE 5.4");
    ide.snapshot("banner");

    ide.click(ACTION);
    ide.settle();
    ide.assert_text(&format!("{ACTION}?"));
    ide.assert_text("-mode=GenerateClangDatabase");
    ide.assert_text("It keeps only this project's files; clangd indexes engine files when you open them.");
    ide.snapshot("confirm");
    ide.click("Cancel");
    ide.settle();
    assert!(ide.state().ws.unreal.confirm.is_none() && ide.state().ws.unreal.runs.is_empty());
    assert!(!u.pids.exists(), "nothing runs without the confirmation");
    ide.click("Not now");
    ide.settle();
    ide.assert_no_text(ACTION);
}

#[test]
fn generate_then_cmd_b_into_an_engine_header() {
    let Some(cpp) = clangd_toml("generate") else { return };
    let u = unreal_project("generate", &cpp, true);
    let mut ide = Ide::open(SUITE, &u.repo.dir);
    ide.set_wait_budget(std::time::Duration::from_secs(90));
    ide.open_file("Source/Game/MyActor.h");
    detected(&mut ide, "Game");
    ide.wait_for("Unreal database hint", |s| s.notifications.log().iter().any(|n| n.title == "No compile_commands.json" && n.body.contains(&format!("\"{ACTION}\" above the editor"))));
    ide.dismiss_toasts();
    ide.click(ACTION);
    ide.settle();
    ide.click("Generate");
    ide.wait_for("database generated", |s| s.ws.unreal.runs.is_empty() && active_project(s).is_some_and(|p| p.has_db));
    ide.settle();
    // UBT's full database stays in ubt/; clangd's keeps the game files only.
    let full = u.repo.read(".harwex/unreal/ubt/compile_commands.json");
    assert!(full.contains("Private/Actor.cpp"), "{full}");
    let db = u.repo.read(".harwex/unreal/compile_commands.json");
    assert!(db.contains("MyActor.cpp") && db.contains("Game.cpp") && !db.contains("Private/Actor.cpp"), "{db}");
    assert!(u.repo.git(&["status", "--porcelain"]).is_empty(), "the database is ignored by git");
    ide.assert_text("compile_commands.json generated");
    ide.assert_no_text(ACTION);

    // `AActor` in `class AMyActor : public AActor {`: clangd now has the engine include paths.
    let p = ide.caret_pos(6, 26);
    ide.click_at(p);
    ide.cmd(Key::B);
    ide.wait_until("jump into the engine", |ide| active_path(ide).ends_with("Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h"));
    ide.settle();
    assert_eq!(ide.cursor(), (4, 6), "the caret lands on `AActor`");
    let e = ide.state().ws.tabs.active_editor().expect("editor");
    assert!(e.read_only, "engine headers open read-only");
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 1, "the engine header stays on the project's clangd");
    ide.state().ws.langs.shutdown();
}

#[test]
fn stop_kills_unrealbuildtool() {
    let u = unreal_project("stop", "", true);
    u.repo.write(".harwex/ide.toml", &format!("languages = [\"ts\"]\n[unreal]\nengine = \"{}\"\n", u.engine.display()));
    std::fs::write(u._fx.path("UE_5.4.slow"), "").expect("slow marker");
    let mut ide = Ide::open(SUITE, &u.repo.dir);
    ide.open_file("Source/Game/MyActor.cpp");
    detected(&mut ide, "Game");
    ide.click(ACTION);
    ide.settle();
    ide.click("Generate");
    ide.wait_until("UBT waits", |ide| std::fs::read_to_string(&u.pids).is_ok_and(|t| t.lines().count() == 2) && ide.shows_text("Creating target..."));
    assert!(ide.state().jobs.running().iter().any(|j| j.label == ACTION), "a labelled job with the status bar ×");
    ide.snapshot_running("running");
    ide.click("Stop");
    ide.wait_for("UBT stopped", |s| s.ws.unreal.runs.is_empty());
    ide.settle();
    ide.assert_text(&format!("Cancelled: {ACTION}"));
    let pids = std::fs::read_to_string(&u.pids).expect("pids");
    for pid in pids.lines() {
        assert!(!alive(pid), "process {pid} of the fake UBT still runs");
    }
    assert!(!u.repo.dir.join(".harwex/unreal/compile_commands.json").exists());
    assert!(!active_project(ide.state()).expect("project").has_db);
    ide.assert_text(ACTION);
}

#[test]
fn missing_generated_header_says_to_build_once() {
    let Some(cpp) = clangd_toml("uht_hint") else { return };
    let u = unreal_project("uht_hint", &cpp, false);
    let mut ide = Ide::open(SUITE, &u.repo.dir);
    ide.set_wait_budget(std::time::Duration::from_secs(90));
    ide.open_file("Source/Game/MyActor.h");
    ide.wait_until("UHT hint", |ide| ide.shows_text("Build the project once so Unreal Header Tool generates the headers"));
    ide.assert_text("MyActor.generated.h does not exist yet");
    // One hint per project.
    ide.dismiss_toasts();
    ide.open_file("Source/Game/MyActor.cpp");
    ide.settle();
    let hints = ide.state().notifications.log().iter().filter(|n| n.title.starts_with("Build the project once")).count();
    assert_eq!(hints, 1);
    ide.state().ws.langs.shutdown();
}

/// Task 086: one opened folder with `Sub/Game1` (UE 5.4), `Sub/Game2` (UE 5.8 through
/// `[unreal.projects."Sub/Game2"]`) and `Pair` with two `.uproject` files.
struct Multi {
    fx: Fixture,
    repo: Repo,
    ue54: PathBuf,
    ue58: PathBuf,
}

fn multi_toml(m: &Multi, extra: &str) -> String {
    format!(
        "[unreal]\nengine = \"{}\"\n[unreal.projects.\"Sub/Game2\"]\nengine = \"{}\"\ntarget = \"Game2\"\n{extra}",
        m.ue54.display(),
        m.ue58.display()
    )
}

fn multi_project(name: &str, toml_top: &str) -> Multi {
    init();
    let fx = Fixture::new(SUITE, name);
    let ue54 = fake_engine(&fx, "UE_5.4", (5, 4, 4));
    let ue58 = fake_engine(&fx, "UE_5.8", (5, 8, 0));
    let repo = Repo::init(fx.path("Multi"));
    repo.write(".gitignore", "Intermediate/\nSaved/\n");
    game(&repo, "Sub/Game1", "Game1", "Game1", "5.4", true);
    game(&repo, "Sub/Game2", "Game2", "Game2", "5.8", true);
    game(&repo, "Pair", "Pair", "Pair", "5.4", true);
    game(&repo, "Pair", "Alpha", "Alpha", "5.4", true);
    let m = Multi { fx, repo, ue54, ue58 };
    m.repo.write(".harwex/ide.toml", &format!("{toml_top}{}", multi_toml(&m, "")));
    m.repo.commit_all("Unreal projects");
    m
}

/// A C/C++ server that records `restart_root` and full restarts, and answers nothing.
#[derive(Default)]
struct Recorder {
    restarted_roots: Mutex<Vec<PathBuf>>,
    full_restarts: Mutex<usize>,
}

impl LanguageServer for Recorder {
    fn open(&self, _path: &Path, _text: &str) {}
    fn change(&self, _path: &Path, _text: &str) {}
    fn close(&self, _path: &Path) {}
    fn locations(&self, _kind: NavKind, _path: &Path, _line: usize, _column: usize) -> Result<Vec<Location>, String> {
        Ok(Vec::new())
    }
    fn references(&self, _path: &Path, _line: usize, _column: usize) -> Result<Vec<Reference>, String> {
        Ok(Vec::new())
    }
    fn hover(&self, _path: &Path, _line: usize, _column: usize) -> Result<Option<HoverInfo>, String> {
        Ok(None)
    }
    fn status(&self, _path: &Path) -> Option<String> {
        None
    }
    fn stop_idle(&self, _idle: Duration) -> Vec<String> {
        Vec::new()
    }
    fn running(&self) -> usize {
        0
    }
    fn take_notice(&self) -> Option<(String, String)> {
        None
    }
    fn shutdown(&self) {}
    fn restart(&self) {
        *self.full_restarts.lock().unwrap() += 1;
    }
    fn restart_root(&self, dir: &Path, _docs: &[(PathBuf, String)]) {
        self.restarted_roots.lock().unwrap().push(dir.to_path_buf());
    }
}

fn hints(ide: &Ide, title: &str) -> usize {
    ide.state().notifications.log().iter().filter(|n| n.title == title).count()
}

#[test]
fn several_projects_each_with_its_own_engine() {
    let m = multi_project("multi", "languages = [\"ts\"]\n");
    let mut ide = Ide::open(SUITE, &m.repo.dir);
    let recorder = Arc::new(Recorder::default());
    ide.state_mut().ws.langs.set_server(LangId::Cpp, recorder.clone());

    // Each project is detected from its own file, with its own engine.
    ide.open_file("Sub/Game1/Source/Game1/MyActor.cpp");
    let g1 = detected(&mut ide, "Game1");
    assert_eq!(g1.root, m.repo.dir.join("Sub/Game1"));
    assert_eq!(g1.engine.as_ref().map(|e| (e.root.clone(), e.version.clone())), Ok((m.ue54.clone(), Some("5.4.4".into()))));
    assert_eq!(g1.target.as_deref(), Ok("Game1Editor"));
    ide.settle();
    ide.assert_text("Game1: no compile database for clangd yet (Unreal Engine 5.4.4).");
    assert_eq!(status_label(ide.state()).as_deref(), Some("Game1 · UE 5.4"));
    ide.open_file("Sub/Game2/Source/Game2/MyActor.cpp");
    let g2 = detected(&mut ide, "Game2");
    // `[unreal.projects."Sub/Game2"]` overrides the engine and the target.
    assert_eq!(g2.engine.as_ref().map(|e| (e.root.clone(), e.version.clone())), Ok((m.ue58.clone(), Some("5.8.0".into()))));
    assert_eq!(g2.target.as_deref(), Ok("Game2"));
    ide.settle();
    ide.assert_text("Game2: no compile database for clangd yet (Unreal Engine 5.8.0).");
    ide.assert_text("Game2 · UE 5.8");
    ide.snapshot("two_projects");
    // Only the projects of opened files: nothing scans the tree up front.
    assert_eq!(ide.state().ws.unreal.projects.len(), 2);

    // Generating for Game2 writes only its database and restarts only its clangd.
    ide.click(ACTION);
    ide.settle();
    ide.assert_text("UnrealBuildTool runs this command for Game2. It can take several minutes:");
    ide.assert_text(&format!("-OutputDir={}", m.repo.dir.join("Sub/Game2/.harwex/unreal/ubt").display()));
    ide.click("Generate");
    ide.wait_for("Game2 generated", |s| s.ws.unreal.runs.is_empty() && active_project(s).is_some_and(|p| p.name == "Game2" && p.has_db));
    ide.settle();
    let db = m.repo.read("Sub/Game2/.harwex/unreal/compile_commands.json");
    assert!(db.contains("Game2/Source/Game2/MyActor.cpp") && !db.contains("Game1") && !db.contains("Private/Actor.cpp"), "{db}");
    assert!(db.contains(&m.ue58.join("Engine/Source/Runtime/Engine/Classes").display().to_string()), "Game2's own engine: {db}");
    assert!(!m.repo.dir.join("Sub/Game1/.harwex").exists(), "Game1 is untouched");
    assert!(!m.repo.dir.join(".harwex/unreal").exists(), "nothing at the opened folder");
    assert_eq!(*recorder.restarted_roots.lock().unwrap(), vec![m.repo.dir.join("Sub/Game2")]);
    assert_eq!(*recorder.full_restarts.lock().unwrap(), 0);
    ide.assert_no_text(ACTION);
    // Game1 still has no database, so its banner is back with its file.
    ide.open_file("Sub/Game1/Source/Game1/MyActor.cpp");
    ide.settle();
    ide.assert_text("Game1: no compile database for clangd yet (Unreal Engine 5.4.4).");
    assert!(!ide.state().ws.unreal.projects[&m.repo.dir.join("Sub/Game1")].has_db);

    // Two `.uproject` files: the one named like the folder, with one hint.
    ide.dismiss_toasts();
    ide.open_file("Pair/Source/Pair/MyActor.cpp");
    let pair = detected(&mut ide, "Pair");
    assert_eq!(pair.uprojects, ["Alpha.uproject", "Pair.uproject"]);
    ide.settle();
    let hint = ide.state().notifications.log().iter().find(|n| n.title == CHOICE_TITLE).map(|n| n.body.clone()).expect("choice hint");
    assert!(hint.contains("The IDE uses Pair.uproject: it is named like the folder.") && hint.contains("under [unreal] in .harwex/ide.toml"), "{hint}");
    // `uproject` in ide.toml picks the other one; the hint does not come back.
    m.repo.write(".harwex/ide.toml", &format!("languages = [\"ts\"]\n{}[unreal.projects.\"Pair\"]\nuproject = \"Alpha.uproject\"\n", multi_toml(&m, "")));
    let config = harwex_ide::lang::config::IdeConfig::load(&m.repo.dir);
    assert!(config.warnings.is_empty(), "{:?}", config.warnings);
    ide.state_mut().apply_ide_config(config);
    let alpha = detected(&mut ide, "Alpha");
    assert_eq!((alpha.root.as_path(), alpha.target.as_deref()), (m.repo.dir.join("Pair").as_path(), Ok("AlphaEditor")));
    ide.settle();
    assert_eq!(hints(&ide, CHOICE_TITLE), 1, "the hint shows once");
    // The other projects were detected again with the new settings and kept.
    assert!(ide.state().ws.unreal.projects[&m.repo.dir.join("Sub/Game2")].has_db);

    // A new `.uproject` (the watcher's batch) turns its folder into a project.
    m.repo.write("Sub/Game3/Source/Game3/A.cpp", "int a;\n");
    ide.open_file("Sub/Game3/Source/Game3/A.cpp");
    let file = m.repo.dir.join("Sub/Game3/Source/Game3/A.cpp");
    ide.wait_for("Game3 folder looked up", |s| s.ws.unreal.looked_up(&file));
    assert!(active_project(ide.state()).is_none() && status_label(ide.state()).is_none());
    m.repo.write("Sub/Game3/Game3.uproject", "{\"EngineAssociation\": \"5.4\"}\n");
    let batch = harwex_ide::watcher::FsBatch { paths: [m.repo.dir.join("Sub/Game3/Game3.uproject")].into_iter().collect(), structure_changed: true, git_changed: false };
    ide.state_mut().on_fs_batch(batch);
    detected(&mut ide, "Game3");
    ide.settle();
    assert!(!m.fx.path("UE_5.4.pids").exists(), "UE 5.4 never ran");
}

#[test]
fn one_run_per_engine() {
    let m = multi_project("one_run_per_engine", "languages = [\"ts\"]\n");
    std::fs::write(m.fx.path("UE_5.4.slow"), "").expect("slow marker");
    let mut ide = Ide::open(SUITE, &m.repo.dir);
    ide.open_file("Sub/Game1/Source/Game1/MyActor.cpp");
    detected(&mut ide, "Game1");
    ide.settle();
    ide.click(ACTION);
    ide.settle();
    ide.click("Generate");
    let pids = m.fx.path("UE_5.4.pids");
    ide.wait_until("UBT waits", |ide| std::fs::read_to_string(&pids).is_ok_and(|t| t.lines().count() == 2) && ide.shows_text("Creating target..."));
    // Pair uses the same engine: refused while Game1's run holds it.
    ide.open_file_running("Pair/Source/Pair/MyActor.cpp");
    ide.wait_for("Pair detected", |s| active_project(s).is_some_and(|p| p.name == "Pair"));
    ide.wait_until("Pair banner", |ide| ide.shows_text("Pair: no compile database for clangd yet (Unreal Engine 5.4.4)."));
    ide.click(ACTION);
    ide.steps(3);
    assert!(ide.state().ws.unreal.confirm.is_none(), "no confirmation while the engine is busy");
    let busy = ide.state().notifications.log().iter().find(|n| n.title == BUSY_TITLE).map(|n| n.body.clone()).expect("busy message");
    assert!(busy.contains("database of Game1 with the same engine"), "{busy}");
    // Game2 has another engine: it may run at the same time.
    ide.open_file_running("Sub/Game2/Source/Game2/MyActor.cpp");
    ide.wait_until("Game2 banner", |ide| ide.shows_text("Game2: no compile database for clangd yet (Unreal Engine 5.8.0)."));
    ide.click(ACTION);
    ide.steps(3);
    ide.click("Generate");
    ide.wait_for("Game2 generated", |s| !s.ws.unreal.is_running(&s.ws.project.as_ref().unwrap().root.join("Sub/Game2")) && active_project(s).is_some_and(|p| p.has_db));
    assert!(ide.state().ws.unreal.is_running(&m.repo.dir.join("Sub/Game1")), "Game1 still runs");
    // Stop Game1 from its banner.
    ide.open_file_running("Sub/Game1/Source/Game1/MyActor.cpp");
    ide.wait_until("Game1 running banner", |ide| ide.shows_text("Game1: UnrealBuildTool is writing compile_commands.json: Creating target..."));
    ide.click("Stop");
    ide.wait_for("UBT stopped", |s| s.ws.unreal.runs.is_empty());
    ide.settle();
    for pid in std::fs::read_to_string(&pids).expect("pids").lines() {
        assert!(!alive(pid), "process {pid} of the fake UBT still runs");
    }
    assert!(!m.repo.dir.join("Sub/Game1/.harwex/unreal/compile_commands.json").exists());
}

#[test]
fn cmd_b_goes_into_each_projects_engine() {
    let Some(cpp) = clangd_toml("multi_clangd") else { return };
    let m = multi_project("multi_clangd", "");
    m.repo.write(".harwex/ide.toml", &multi_toml(&m, &cpp));
    let mut ide = Ide::open(SUITE, &m.repo.dir);
    ide.set_wait_budget(Duration::from_secs(90));
    let cpp_pids = |ide: &Ide| ide.state().ws.langs.bridge(LangId::Cpp).server().pids();
    for g in ["Game1", "Game2"] {
        ide.open_file(&format!("Sub/{g}/Source/{g}/MyActor.h"));
        detected(&mut ide, g);
        ide.dismiss_toasts();
        ide.click(ACTION);
        ide.settle();
        ide.click("Generate");
        ide.wait_for("database generated", |s| s.ws.unreal.runs.is_empty() && active_project(s).is_some_and(|p| p.has_db));
        ide.settle();
        ide.wait_until("clangd runs", |ide| !cpp_pids(ide).is_empty());
    }
    // Two clangd: one per project.
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 2);
    let status = ide.state().ws.tabs.active_editor().and_then(|e| ide.state().ws.langs.status(LangId::Cpp, &e.path)).unwrap_or_default();
    ide.assert_text(&format!("{status} · Game2 · UE 5.8"));

    // Generating Game2 again restarts only Game2's clangd.
    let before = cpp_pids(&ide);
    ide.open_file("Sub/Game1/Source/Game1/MyActor.h");
    ide.settle();
    ide.open_file("Sub/Game2/Source/Game2/MyActor.h");
    ide.settle();
    std::fs::remove_file(m.repo.dir.join("Sub/Game2/.harwex/unreal/compile_commands.json")).expect("remove database");
    ide.state_mut().apply_ide_config(harwex_ide::lang::config::IdeConfig::load(&m.repo.dir));
    ide.wait_until("Game2 banner again", |ide| ide.shows_text(ACTION));
    ide.dismiss_toasts();
    ide.click(ACTION);
    ide.settle();
    ide.click("Generate");
    ide.wait_for("database generated", |s| s.ws.unreal.runs.is_empty() && active_project(s).is_some_and(|p| p.has_db));
    ide.settle();
    ide.wait_until("both clangd run", |ide| cpp_pids(ide).len() == 2);
    let after = cpp_pids(&ide);
    assert_eq!(before.iter().filter(|p| after.contains(p)).count(), 1, "one clangd kept its process: {before:?} -> {after:?}");

    // Cmd+B on `AActor` lands in each project's own engine, read-only.
    for (g, engine) in [("Game2", &m.ue58), ("Game1", &m.ue54)] {
        ide.open_file(&format!("Sub/{g}/Source/{g}/MyActor.h"));
        ide.settle();
        let p = ide.caret_pos(6, 26);
        ide.click_at(p);
        ide.cmd(Key::B);
        let want = engine.join("Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h");
        ide.wait_until("jump into the engine", |ide| Path::new(&active_path(ide)) == want);
        ide.settle();
        assert_eq!(ide.cursor(), (4, 6), "the caret lands on `AActor`");
        assert!(ide.state().ws.tabs.active_editor().expect("editor").read_only, "engine headers open read-only");
    }
    assert_eq!(ide.state().ws.langs.running(LangId::Cpp), 2, "engine headers stay on the projects' clangd");
    ide.state().ws.langs.shutdown();
}
