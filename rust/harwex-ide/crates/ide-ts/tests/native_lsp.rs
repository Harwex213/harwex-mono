//! End-to-end tests against the real native TypeScript 7 server (`tsc --lsp --stdio`) in a
//! throwaway project. The install comes from `cargo xtask test-tools` (or `HARWEX_TEST_TS7`)
//! through a symlink; the suite skips with a message when it is missing.

mod common;

use std::time::{Duration, Instant};

use common::{pos, service, single, TsLink};
use ide_ts::{BackendKind, BackendPreference, TsService};

#[test]
fn backend_is_native_lsp() {
    let Some(p) = common::project(TsLink::Native) else { return };
    let ts = service();
    let info = ts.backend(&p.main).unwrap();
    assert_eq!(info.kind, BackendKind::NativeLsp);
    assert!(info.version.starts_with('7'), "{info:?}");
    assert!(info.program.ends_with(format!("{}/lib/tsc", common::ts7_platform())), "{info:?}");
    assert_eq!(info.project_root.as_deref(), Some(p.root.as_path()));
    assert_eq!(info.tsserver_fallback, None);
    assert!(info.label().starts_with("TS 7"), "{}", info.label());
}

#[test]
fn definition_into_dependency_and_local_file() {
    let Some(p) = common::project(TsLink::Native) else { return };
    let ts = service();
    ts.open(&p.main, &p.main_text);

    // `greet(s)` on line 2, after two astral chars.
    let (line, column) = pos(&p.main_text, "greet(s)", 0);
    assert_eq!(line, 2);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("node_modules/fake-lib/index.d.ts"));
    assert_eq!((loc.line, loc.column), (1, "export declare function ".len()));

    // TypeScript 7 answers `custom/textDocument/sourceDefinition` itself.
    let src = single(ts.source_definition(&p.main, line, column).unwrap());
    assert_eq!(src.path, p.root.join("node_modules/fake-lib/index.js"));

    let (line, column) = pos(&p.main_text, "answer", 1);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));
    assert_eq!((loc.line, loc.column), (0, "export const ".len()));

    ts.shutdown();
}

#[test]
fn type_definition_references_and_quick_info() {
    let Some(p) = common::project(TsLink::Native) else { return };
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
    let decl = refs
        .iter()
        .find(|r| r.location.path.ends_with("index.d.ts") && r.location.line == 1)
        .unwrap_or_else(|| panic!("{refs:#?}"));
    assert!(decl.is_definition, "{decl:?}");

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
fn writes_are_marked_in_the_requested_file() {
    let Some(p) = common::project(TsLink::Native) else { return };
    let ts = service();
    let text = "let n = 1;\nn = 2;\nconsole.log(n);\n";
    let file = p.root.join("src/write.ts");
    std::fs::write(&file, text).unwrap();
    ts.open(&file, text);
    let refs = ts.references(&file, 2, "console.log(".len()).unwrap();
    let lines: Vec<(usize, bool)> = refs.iter().map(|r| (r.location.line, r.is_write)).collect();
    assert!(lines.contains(&(1, true)), "{refs:#?}");
    assert!(lines.contains(&(2, false)), "{refs:#?}");
    ts.shutdown();
}

#[test]
fn change_is_seen_and_restart_reopens_unsaved_text() {
    let Some(p) = common::project(TsLink::Native) else { return };
    let ts = service();
    ts.open(&p.main, &p.main_text);

    // Insert a line at the top that only exists in the editor, never on disk.
    let edited = format!("import {{ answer as other }} from \"./util\";\n{}", p.main_text);
    ts.change(&p.main, &edited);
    let (line, column) = pos(&edited, "other", 0);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));

    ts.kill_server_for(&p.main);
    // The first call after the crash restarts the server and re-opens the edited text.
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));

    // A second edit after the restart applies on top of the re-opened text.
    let edited2 = format!("\n{edited}");
    ts.change(&p.main, &edited2);
    let loc = single(ts.definition(&p.main, line + 1, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));

    ts.close(&p.main);
    ts.shutdown();
}

#[test]
fn works_from_many_threads() {
    let Some(p) = common::project(TsLink::Native) else { return };
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
    let Some(p) = common::project(TsLink::Native) else { return };
    let ts = service();
    let (line, column) = pos(&p.main_text, "answer", 1);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));
    ts.shutdown();
}

#[test]
fn timeout_returns_error_and_next_request_works() {
    let Some(p) = common::project(TsLink::Native) else { return };
    let ts = TsService::new();
    ts.open(&p.main, &p.main_text);
    // The native server is fast, so a zero timeout is the only one that reliably expires.
    ts.set_timeout(Duration::ZERO);
    let started = Instant::now();
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

#[test]
fn old_tsserver_is_the_fallback_and_can_be_preferred() {
    let Some(p) = common::project(TsLink::NativeWithOld) else { return };
    let ts = service();
    let info = ts.backend(&p.main).unwrap();
    assert_eq!(info.kind, BackendKind::NativeLsp);
    let old = p.root.join("node_modules/@typescript/old/lib/tsserver.js");
    assert_eq!(info.tsserver_fallback.as_deref(), Some(old.as_path()));

    let classic = service();
    classic.set_backend_preference(BackendPreference::TsServer);
    let info = classic.backend(&p.main).unwrap();
    assert_eq!(info.kind, BackendKind::TsServer);
    // `@typescript/old` links the pinned TypeScript 5 install.
    assert!(!info.version.starts_with('7'), "{info:?}");
    assert_eq!(info.program, old);

    // Both backends land on the same spots.
    let (line, column) = pos(&p.main_text, "greet(s)", 0);
    for svc in [&ts, &classic] {
        svc.open(&p.main, &p.main_text);
        let loc = single(svc.definition(&p.main, line, column).unwrap());
        assert_eq!(loc.path, p.root.join("node_modules/fake-lib/index.d.ts"));
        assert_eq!((loc.line, loc.column), (1, "export declare function ".len()));
        let src = single(svc.source_definition(&p.main, line, column).unwrap());
        assert_eq!(src.path, p.root.join("node_modules/fake-lib/index.js"));
        svc.shutdown();
    }
}
