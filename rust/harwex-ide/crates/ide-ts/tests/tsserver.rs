//! End-to-end tests against a real tsserver in a throwaway project.

use std::path::{Path, PathBuf};
use std::time::Duration;

use ide_ts::{find_node, Location, TsService};

const TYPESCRIPT: &str = "/Users/aleh_kaportsau/Projects/harwex-mono/javascript/node_modules/typescript";

struct Project {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    main: PathBuf,
    main_text: String,
}

/// Returns `None` (and the test passes with a message) when node or typescript is missing,
/// so the suite still runs on a machine without a JS toolchain.
fn project() -> Option<Project> {
    if find_node().is_none() {
        eprintln!("skipping: node not found");
        return None;
    }
    if !Path::new(TYPESCRIPT).join("lib/tsserver.js").is_file() {
        eprintln!("skipping: {TYPESCRIPT} not found");
        return None;
    }
    let tmp = tempfile::tempdir().unwrap();
    // tsserver answers with real paths; /var is a symlink to /private/var on macOS.
    let root = tmp.path().canonicalize().unwrap();
    let write = |rel: &str, text: &str| {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    };
    std::fs::create_dir_all(root.join("node_modules")).unwrap();
    std::os::unix::fs::symlink(TYPESCRIPT, root.join("node_modules/typescript")).unwrap();
    write(
        "node_modules/fake-lib/package.json",
        r#"{"name":"fake-lib","version":"1.0.0","main":"index.js","types":"index.d.ts"}"#,
    );
    write(
        "node_modules/fake-lib/index.d.ts",
        "/** Says hello. */\nexport declare function greet(name: string): string;\nexport interface Options { loud: boolean }\n",
    );
    write(
        "node_modules/fake-lib/index.js",
        "\"use strict\";\nexports.greet = greet;\nfunction greet(name) {\n  return \"hi \" + name;\n}\n",
    );
    write(
        "tsconfig.json",
        r#"{"compilerOptions":{"strict":true,"module":"commonjs","target":"es2020"},"include":["src"]}"#,
    );
    write("src/util.ts", "export const answer = 42;\n");
    // Line 3 has astral chars before `greet`, so a wrong UTF-16 conversion shows up.
    let main_text = "import { greet, Options } from \"fake-lib\";\nimport { answer } from \"./util\";\nconst s = \"😀😀\"; greet(s);\nconst o: Options = { loud: true };\nconsole.log(answer, o);\n".to_string();
    write("src/main.ts", &main_text);
    let main = root.join("src/main.ts");
    Some(Project {
        _tmp: tmp,
        root,
        main,
        main_text,
    })
}

/// 0-based (line, char column) of the `nth` occurrence of `needle` in `text`.
fn pos(text: &str, needle: &str, nth: usize) -> (usize, usize) {
    let byte = text.match_indices(needle).nth(nth).expect("needle not found").0;
    let before = &text[..byte];
    let line = before.matches('\n').count();
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    (line, text[line_start..byte].chars().count())
}

fn service() -> TsService {
    let ts = TsService::new();
    // The first request loads the project and the lib files; a cold disk can be slow.
    ts.set_timeout(Duration::from_secs(30));
    ts
}

fn single(locs: Vec<Location>) -> Location {
    assert_eq!(locs.len(), 1, "expected one location, got {locs:?}");
    locs.into_iter().next().unwrap()
}

#[test]
fn definition_into_dependency_and_local_file() {
    let Some(p) = project() else { return };
    let ts = service();
    ts.open(&p.main, &p.main_text);

    // `greet(s)` on line 2, after two astral chars.
    let (line, column) = pos(&p.main_text, "greet(s)", 0);
    assert_eq!(line, 2);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("node_modules/fake-lib/index.d.ts"));
    assert_eq!((loc.line, loc.column), (1, "export declare function ".len()));

    let src = single(ts.source_definition(&p.main, line, column).unwrap());
    assert_eq!(src.path, p.root.join("node_modules/fake-lib/index.js"));

    let (line, column) = pos(&p.main_text, "answer", 1);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    // A local import lands on the declaration in util.ts, not on the import line.
    assert_eq!(loc.path, p.root.join("src/util.ts"));
    assert_eq!((loc.line, loc.column), (0, "export const ".len()));

    ts.shutdown();
}

#[test]
fn type_definition_references_and_quick_info() {
    let Some(p) = project() else { return };
    let ts = service();
    ts.open(&p.main, &p.main_text);

    let (line, column) = pos(&p.main_text, "o);", 0);
    let loc = single(ts.type_definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("node_modules/fake-lib/index.d.ts"));
    assert_eq!(loc.line, 2);

    let (line, column) = pos(&p.main_text, "greet(s)", 0);
    let refs = ts.references(&p.main, line, column).unwrap();
    let in_main: Vec<_> = refs.iter().filter(|r| r.location.path == p.main).collect();
    assert_eq!(in_main.len(), 2, "{refs:?}");
    let call = in_main.iter().find(|r| r.location.line == 2).unwrap();
    assert_eq!(call.location.column, column);
    assert_eq!(call.end_column, column + "greet".len());
    assert_eq!(call.line_text, "const s = \"😀😀\"; greet(s);");
    // TypeScript 5.x leaves `isDefinition` false here, so only the location is checked.
    assert!(refs.iter().any(|r| r.location.path.ends_with("index.d.ts") && r.location.line == 1), "{refs:#?}");

    let info = ts.quick_info(&p.main, line, column).unwrap().unwrap();
    assert_eq!(info.kind, "alias");
    assert!(info.display.contains("greet(name: string): string"), "{info:?}");
    assert!(info.documentation.contains("Says hello"), "{info:?}");
    assert_eq!((info.line, info.column), (line, column));
    assert_eq!(info.end_column, column + "greet".len());

    // The empty last line has no info; that is not an error.
    assert_eq!(ts.quick_info(&p.main, 5, 0).unwrap(), None);

    ts.shutdown();
}

#[test]
fn change_is_seen_and_restart_reopens_unsaved_text() {
    let Some(p) = project() else { return };
    let ts = service();
    ts.open(&p.main, &p.main_text);

    // Insert a line at the top that only exists in the editor, never on disk.
    let edited = format!("import {{ answer as other }} from \"./util\";\n{}", p.main_text);
    ts.change(&p.main, &edited);
    let (line, column) = pos(&edited, "other", 0);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));

    ts.kill_server_for(&p.main);
    // The first call after the crash restarts tsserver and re-opens the edited text; if it
    // re-read the disk instead, line 0 would be the fake-lib import.
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));

    ts.close(&p.main);
    ts.shutdown();
}

#[test]
fn works_from_many_threads() {
    let Some(p) = project() else { return };
    let ts = service();
    ts.open(&p.main, &p.main_text);
    let (line, column) = pos(&p.main_text, "greet(s)", 0);
    let handles: Vec<_> = (0..8)
        .map(|i| {
            let ts = ts.clone();
            let main = p.main.clone();
            std::thread::spawn(move || {
                if i % 2 == 0 {
                    ts.definition(&main, line, column).map(|l| l.len())
                } else {
                    ts.references(&main, line, column).map(|r| r.len())
                }
            })
        })
        .collect();
    for h in handles {
        assert!(h.join().unwrap().unwrap() > 0);
    }
    ts.shutdown();
}

#[test]
fn file_not_opened_by_editor_is_opened_from_disk() {
    let Some(p) = project() else { return };
    let ts = service();
    let (line, column) = pos(&p.main_text, "answer", 1);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));
    ts.shutdown();
}

#[test]
fn timeout_returns_error() {
    let Some(p) = project() else { return };
    let ts = TsService::new();
    // Too short for a cold project load, so this must fail fast instead of hanging.
    ts.set_timeout(Duration::from_millis(1));
    ts.open(&p.main, &p.main_text);
    let started = std::time::Instant::now();
    let result = ts.references(&p.main, 2, 0);
    assert!(matches!(result, Err(ide_ts::Error::Timeout { .. })), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(2));
    // The late response must not confuse the next request.
    ts.set_timeout(Duration::from_secs(30));
    let (line, column) = pos(&p.main_text, "answer", 1);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));
    ts.shutdown();
}
