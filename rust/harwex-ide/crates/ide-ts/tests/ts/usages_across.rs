//! Find Usages and Rename Symbol across workspace packages (task 121). Package A declares a
//! symbol in `src/common/services/store.ts`, re-exports it from `src/common/index.ts` (the
//! `./common` subpath of its `exports`) and from `src/index.ts` (its entry). B imports it from
//! `@ws/a/common`, C from `@ws/a`. D has an unrelated symbol of the same name. Every package is
//! its own TypeScript project without project references, so a server that has loaded only A
//! never sees B or C.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::common::{apply_edits, pos, TsLink};
use ide_ts::{BackendKind, BackendPreference, Loading, PackageGraph, ScanOptions, TsService};

struct Workspace {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    files: Vec<PathBuf>,
}

const STORE: &str = "export const rootStore = { size: 1 };\n\nexport function sizeOf(): number {\n  const local = rootStore.size;\n  return local;\n}\n";
const A_COMMON: &str = "export { rootStore, sizeOf } from \"./services/store\";\n";
const A_INDEX: &str = "export * from \"./common\";\n";
const B_USE: &str = "import { rootStore } from \"@ws/a/common\";\n\nexport const b = rootStore.size + 1;\n";
const C_USE: &str = "import { rootStore, sizeOf } from \"@ws/a\";\n\nexport const c = rootStore.size + sizeOf();\nconsole.log(rootStore);\n";
const D_LOCAL: &str = "export const rootStore = { size: 2 };\n";
const D_USE: &str = "import { rootStore } from \"./local\";\n\nexport const d = rootStore.size;\n";

fn generate(link: TsLink) -> Workspace {
    let tmp = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(tmp.path()).unwrap();
    let mut files = Vec::new();
    let mut write = |rel: &str, text: &str| {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, text).unwrap();
        if rel.ends_with(".ts") {
            files.push(p);
        }
    };
    let tsconfig = r#"{"compilerOptions":{"strict":true,"module":"esnext","target":"es2020","moduleResolution":"bundler"},"include":["src"]}"#;
    write("package.json", r#"{ "name": "usages-ws", "private": true, "workspaces": ["packages/*"] }"#);
    write("packages/a/package.json", r#"{"name":"@ws/a","version":"1.0.0","exports":{".":"./src/index.ts","./common":"./src/common/index.ts"}}"#);
    write("packages/a/src/common/services/store.ts", STORE);
    write("packages/a/src/common/index.ts", A_COMMON);
    write("packages/a/src/index.ts", A_INDEX);
    write("packages/b/src/use.ts", B_USE);
    write("packages/c/src/use.ts", C_USE);
    write("packages/d/src/local.ts", D_LOCAL);
    write("packages/d/src/use.ts", D_USE);
    for p in ["a", "b", "c", "d"] {
        write(&format!("packages/{p}/tsconfig.json"), tsconfig);
        // B and C list A, as a workspace that installs with yarn must.
        if p == "b" || p == "c" {
            write(&format!("packages/{p}/package.json"), &format!(r#"{{"name":"@ws/{p}","version":"1.0.0","dependencies":{{"@ws/a":"workspace:*"}}}}"#));
        } else if p == "d" {
            write(&format!("packages/{p}/package.json"), &format!(r#"{{"name":"@ws/{p}","version":"1.0.0"}}"#));
        }
    }
    std::fs::create_dir_all(root.join("node_modules/@ws")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/@typescript")).unwrap();
    for p in ["a", "b", "c", "d"] {
        crate::common::symlink_dir(format!("../../packages/{p}"), root.join(format!("node_modules/@ws/{p}"))).unwrap();
    }
    let ts7 = crate::common::ts7().unwrap();
    let ts5 = crate::common::ts5().unwrap();
    match link {
        TsLink::TsServer => crate::common::symlink_dir(ts5, root.join("node_modules/typescript")).unwrap(),
        _ => {
            crate::common::symlink_dir(ts7, root.join("node_modules/typescript")).unwrap();
            crate::common::symlink_dir(ts5, root.join("node_modules/@typescript/old")).unwrap();
        }
    }
    files.sort();
    Workspace { _tmp: tmp, root, files }
}

fn service(preference: BackendPreference) -> TsService {
    let ts = TsService::new();
    ts.set_timeout(Duration::from_secs(60));
    ts.set_backend_preference(preference);
    ts
}

fn candidates(ws: &Workspace, ts: &TsService, file: &Path, line: usize, column: usize) -> Vec<PathBuf> {
    let scope = ts.symbol_scope(file, line, column).unwrap().expect("a declaration");
    assert_eq!(scope.name, "rootStore");
    assert_eq!(scope.declarations, [ws.root.join("packages/a/src/common/services/store.ts")]);
    assert!(scope.exported);
    let options = ScanOptions { threads: 2, prepare_thread: &|| {}, cancelled: &|| false };
    let graph = PackageGraph::build(["", "packages/a/", "packages/b/", "packages/c/", "packages/d/"].map(|d| ws.root.join(format!("{d}package.json"))));
    let found = ide_ts::symbol_candidates(&ws.files, &scope, &graph, &options);
    assert_eq!(found.packages, Some(3), "A and the two packages that list it");
    found.files
}

/// Files of the references, relative to the workspace root.
fn files_of(root: &Path, paths: impl Iterator<Item = PathBuf>) -> Vec<String> {
    let mut v: Vec<String> = paths.map(|p| p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/")).collect();
    v.sort();
    v.dedup();
    v
}

fn check(link: TsLink, preference: BackendPreference, kind: BackendKind) {
    if let Some(why) = crate::common::missing(TsLink::NativeWithOld) {
        eprintln!("skipping: {why}");
        return;
    }
    let ws = generate(link);
    let root = &ws.root;
    let store = root.join("packages/a/src/common/services/store.ts");
    let (line, column) = pos(STORE, "rootStore", 0);

    let ts = service(preference);
    assert_eq!(ts.backend(&store).unwrap().kind, kind);
    ts.open(&store, STORE);
    // The trap: a plain request sees only the loaded project, A.
    let plain = ts.references(&store, line, column).unwrap();
    assert!(plain.iter().all(|r| r.location.path.starts_with(root.join("packages/a"))), "{plain:?}");

    let found = candidates(&ws, &ts, &store, line, column);
    assert_eq!(files_of(root, found.iter().cloned()), ["packages/a/src/common/index.ts", "packages/b/src/use.ts", "packages/c/src/use.ts"]);

    let progress: Mutex<Vec<(usize, usize)>> = Mutex::default();
    let report = |done: usize, total: usize| progress.lock().unwrap().push((done, total));
    let loading = Loading { cancelled: &|| false, progress: &report };
    let started = Instant::now();
    let refs = ts.references_across(&store, line, column, &found, &loading).unwrap();
    let cold = started.elapsed();
    let want = ["packages/a/src/common/index.ts", "packages/a/src/common/services/store.ts", "packages/b/src/use.ts", "packages/c/src/use.ts"];
    assert_eq!(files_of(root, refs.iter().map(|r| r.location.path.clone())), want, "{refs:?}");
    // C names it three times (import, two reads), B twice.
    let in_c = refs.iter().filter(|r| r.location.path.ends_with("packages/c/src/use.ts")).count();
    assert_eq!(in_c, 3, "{refs:?}");
    let steps = progress.lock().unwrap().clone();
    assert_eq!((steps.first(), steps.last()), (Some(&(0, 3)), Some(&(3, 3))), "B and C were loaded, A already was: {steps:?}");
    assert!(steps.windows(2).all(|w| w[0].0 <= w[1].0), "{steps:?}");
    assert!(refs.windows(2).all(|w| (&w[0].location.path, w[0].location.line) <= (&w[1].location.path, w[1].location.line)), "sorted");

    // Warm: the projects stay loaded.
    progress.lock().unwrap().clear();
    let started = Instant::now();
    let again = ts.references_across(&store, line, column, &found, &loading).unwrap();
    let warm = started.elapsed();
    assert_eq!(again.len(), refs.len());
    assert_eq!(*progress.lock().unwrap(), [(0, 3), (3, 3)], "asked once, nothing loaded");
    eprintln!("{kind:?}: usages across packages cold {cold:?}, warm {warm:?}");

    // Rename from the declaration edits A, B and C, not D.
    let edits = ts.rename_symbol(&store, line, column, "mainStore", &found, &Loading::none()).unwrap();
    assert_eq!(files_of(root, edits.iter().map(|e| e.path.clone())), want, "{edits:?}");
    let c_edit = edits.iter().find(|e| e.path.ends_with("packages/c/src/use.ts")).unwrap();
    let renamed = apply_edits(C_USE, &c_edit.edits);
    assert!(renamed.contains("import { mainStore, sizeOf } from \"@ws/a\";") && renamed.contains("console.log(mainStore);"), "{renamed}");
    ts.shutdown();

    // From the re-export, on a fresh server: the same packages.
    let ts = service(preference);
    let common = root.join("packages/a/src/common/index.ts");
    let (line, column) = pos(A_COMMON, "rootStore", 0);
    let found = candidates(&ws, &ts, &common, line, column);
    let refs = ts.references_across(&common, line, column, &found, &Loading::none()).unwrap();
    let files = files_of(root, refs.iter().map(|r| r.location.path.clone()));
    assert!(files.contains(&"packages/b/src/use.ts".to_string()) && files.contains(&"packages/c/src/use.ts".to_string()), "{files:?}");
    assert!(!files.iter().any(|f| f.starts_with("packages/d/")), "{files:?}");

    // A local declaration skips the pre-filter.
    let (line, column) = pos(STORE, "local", 0);
    let scope = ts.symbol_scope(&store, line, column).unwrap().expect("a declaration");
    assert!(!scope.exported, "{scope:?}");

    // A cancel before the first project ends the request with the cancel text.
    ts.shutdown();
    let ts = service(preference);
    let (line, column) = pos(STORE, "rootStore", 0);
    let cancelled = Loading { cancelled: &|| true, progress: &|_, _| {} };
    let err = ts.references_across(&store, line, column, &found, &cancelled).unwrap_err();
    assert!(err.to_string().contains(ide_lsp::CANCELLED), "{err}");
    ts.shutdown();
}

#[test]
fn tsserver_finds_usages_in_every_package() {
    check(TsLink::TsServer, BackendPreference::TsServer, BackendKind::TsServer);
}

#[test]
fn native_server_finds_usages_in_every_package() {
    check(TsLink::NativeWithOld, BackendPreference::Native, BackendKind::NativeLsp);
}
