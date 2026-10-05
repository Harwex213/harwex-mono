//! End-to-end tests against a real tsserver in a throwaway project.

const LINK: crate::common::TsLink = TsLink::TsServer;

use std::time::Duration;

use crate::common::{pos, service, single, TsLink};
use ide_ts::TsService;

fn project() -> Option<crate::common::Project> {
    crate::common::project(TsLink::TsServer)
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

#[test]
fn file_rename_updates_imports() {
    crate::common::check_file_rename(crate::common::TsLink::TsServer);
}

#[test]
fn diagnostics_of_unsaved_text() {
    let Some(p) = crate::common::project(LINK) else { return };
    let ts = service();
    // An unsaved edit: a type error after two astral chars, and an unused local.
    let text = format!("{}\nconst bad: number = \"😀\" + \"x\";\nfunction f() {{ const unused = 1; }}\nf();\n", p.main_text);
    ts.open(&p.main, &text);
    let d = ts.diagnostics(&p.main).unwrap();
    let errors: Vec<_> = d.iter().filter(|d| d.severity == ide_ts::Severity::Error).collect();
    assert_eq!(errors.len(), 1, "{d:#?}");
    let (line, column) = pos(&text, "bad", 0);
    assert_eq!((errors[0].line, errors[0].column, errors[0].end_column), (line, column, column + 3), "{d:#?}");
    assert_eq!(errors[0].code.as_deref(), Some("2322"));
    assert!(errors[0].message.contains("not assignable"), "{}", errors[0].message);
    let unused: Vec<_> = d.iter().filter(|d| d.unnecessary).collect();
    assert!(unused.iter().any(|u| u.column == pos(&text, "unused", 0).1), "{d:#?}");
    // Fixed in the buffer: the next request sees it.
    ts.change(&p.main, &p.main_text);
    assert!(ts.diagnostics(&p.main).unwrap().iter().all(|d| d.severity != ide_ts::Severity::Error));
    ts.shutdown();
}
