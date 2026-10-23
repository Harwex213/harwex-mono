//! Find Usages scoped by the package graph and streamed while projects load (task 123).
//!
//! `@ws/utils` exports `MAX_RETRIES`; all 20 packages `p01`..`p20` list utils, and only `p01`,
//! `p02` and `p03` use the constant. `@ws/narrow` exports `formatPrice`; only `@ws/app1` lists
//! narrow. `@ws/shop` lists neither and declares its own `MAX_RETRIES` and `formatPrice` in
//! files with the same stems, so the text test alone would pick its files. Every package is its
//! own TypeScript project.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use crate::common::{pos, TsLink};
use ide_ts::{BackendPreference, Loading, PackageGraph, Reference, ScanOptions, Stream, SymbolCandidates, TsService};

const CONSTANTS: &str = "export const MAX_RETRIES = 3;\nexport const OTHER = 1;\n";
const PRICE: &str = "export function formatPrice(n: number): string {\n  return n.toFixed(2);\n}\n";
const USERS: usize = 3;
const PACKAGES: usize = 20;

struct Workspace {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    files: Vec<PathBuf>,
}

fn generate(link: TsLink) -> Workspace {
    let tmp = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(tmp.path()).unwrap();
    let mut files = Vec::new();
    let mut write = |rel: &str, text: &str| {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, text).unwrap();
        files.push(p);
    };
    let tsconfig = r#"{"compilerOptions":{"strict":true,"module":"esnext","target":"es2020","moduleResolution":"bundler"},"include":["src"]}"#;
    let manifest = |name: &str, deps: &[&str]| {
        let deps: Vec<String> = deps.iter().map(|d| format!(r#""@ws/{d}":"workspace:*""#)).collect();
        format!(r#"{{"name":"@ws/{name}","version":"1.0.0","exports":{{".":"./src/index.ts"}},"dependencies":{{{}}}}}"#, deps.join(","))
    };
    write("package.json", r#"{ "name": "scoped-ws", "private": true, "workspaces": ["packages/*"] }"#);
    let mut names: Vec<String> = vec!["utils".into(), "narrow".into(), "app1".into(), "shop".into()];
    write("packages/utils/package.json", &manifest("utils", &[]));
    write("packages/utils/src/constants.ts", CONSTANTS);
    write("packages/utils/src/index.ts", "export * from \"./constants\";\n");
    write("packages/narrow/package.json", &manifest("narrow", &[]));
    write("packages/narrow/src/price.ts", PRICE);
    write("packages/narrow/src/index.ts", "export { formatPrice } from \"./price\";\n");
    write("packages/app1/package.json", &manifest("app1", &["narrow", "utils"]));
    write("packages/app1/src/index.ts", "import { formatPrice } from \"@ws/narrow\";\n\nexport const label = formatPrice(1);\n");
    write("packages/shop/package.json", &manifest("shop", &[]));
    write("packages/shop/src/constants.ts", "export const MAX_RETRIES = 9;\n");
    write("packages/shop/src/price.ts", "export const formatPrice = (n: number) => `${n}`;\n");
    write("packages/shop/src/index.ts", "import { MAX_RETRIES } from \"./constants\";\nimport { formatPrice } from \"./price\";\n\nexport const shop = formatPrice(MAX_RETRIES);\n");
    for i in 1..=PACKAGES {
        let name = format!("p{i:02}");
        write(&format!("packages/{name}/package.json"), &manifest(&name, &["utils"]));
        let body = if i <= USERS {
            "import { MAX_RETRIES } from \"@ws/utils\";\n\nexport const retries = MAX_RETRIES + 1;\n"
        } else {
            "import { OTHER } from \"@ws/utils\";\n\nexport const other = OTHER;\n"
        };
        write(&format!("packages/{name}/src/index.ts"), body);
        names.push(name);
    }
    std::fs::create_dir_all(root.join("node_modules/@ws")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/@typescript")).unwrap();
    for n in &names {
        write(&format!("packages/{n}/tsconfig.json"), tsconfig);
        crate::common::symlink_dir(format!("../../packages/{n}"), root.join(format!("node_modules/@ws/{n}"))).unwrap();
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

fn rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

fn candidates(ws: &Workspace, ts: &TsService, file: &Path, line: usize, column: usize, graph: &PackageGraph) -> SymbolCandidates {
    let scope = ts.symbol_scope(file, line, column).unwrap().expect("a declaration");
    assert!(scope.exported, "{scope:?}");
    let options = ScanOptions { threads: 2, prepare_thread: &|| {}, cancelled: &|| false };
    ide_ts::symbol_candidates(&ws.files, &scope, graph, &options)
}

/// The batches, the progress steps and the end of a streamed search.
type Streamed = (Vec<Vec<Reference>>, Vec<(usize, usize)>, Result<(), String>);

/// Streams the usages; `cancel_after` sets the cancel flag once that many batches arrived.
fn stream(ts: &TsService, file: &Path, line: usize, column: usize, candidates: &[PathBuf], cancel_after: Option<usize>) -> Streamed {
    let batches: Mutex<Vec<Vec<Reference>>> = Mutex::default();
    let progress: Mutex<Vec<(usize, usize)>> = Mutex::default();
    let cancel = AtomicBool::new(false);
    let found = |batch: Vec<Reference>| {
        let mut b = batches.lock().unwrap();
        b.push(batch);
        if cancel_after.is_some_and(|n| b.len() >= n) {
            cancel.store(true, Ordering::Relaxed);
        }
    };
    let report = |done: usize, total: usize| progress.lock().unwrap().push((done, total));
    let cancelled = || cancel.load(Ordering::Relaxed);
    let loading = Loading { cancelled: &cancelled, progress: &report };
    let result = ts.references_streaming(file, line, column, candidates, &loading, &Stream { found: &found, loaded_asked: false }).map_err(|e| e.to_string());
    (batches.into_inner().unwrap(), progress.into_inner().unwrap(), result)
}

fn check(link: TsLink, preference: BackendPreference) {
    if let Some(why) = crate::common::missing(TsLink::NativeWithOld) {
        eprintln!("skipping: {why}");
        return;
    }
    let ws = generate(link);
    let root = &ws.root;
    let graph = PackageGraph::from_files(&ws.files);
    assert_eq!(graph.len(), PACKAGES + 4);
    let service = || {
        let ts = TsService::new();
        ts.set_timeout(Duration::from_secs(60));
        ts.set_backend_preference(preference);
        ts
    };

    // A narrow package: one dependent reads it; shop's own `formatPrice` is not read at all.
    let ts = service();
    let price = root.join("packages/narrow/src/price.ts");
    ts.open(&price, PRICE);
    let (line, column) = pos(PRICE, "formatPrice", 0);
    let unscoped = candidates(&ws, &ts, &price, line, column, &PackageGraph::default());
    assert!(unscoped.files.iter().any(|f| f.starts_with(root.join("packages/shop"))), "the text test alone picks shop: {:?}", unscoped.files);
    let narrow = candidates(&ws, &ts, &price, line, column, &graph);
    assert_eq!(narrow.files.iter().map(|f| rel(root, f)).collect::<Vec<_>>(), ["packages/app1/src/index.ts", "packages/narrow/src/index.ts"]);
    assert_eq!(narrow.packages, Some(2), "narrow and app1");
    assert!(narrow.scanned < unscoped.scanned, "{} < {}", narrow.scanned, unscoped.scanned);
    let refs = ts.references_across(&price, line, column, &narrow.files, &Loading::none()).unwrap();
    let mut files: Vec<String> = refs.iter().map(|r| rel(root, &r.location.path)).collect();
    files.dedup();
    assert_eq!(files, ["packages/app1/src/index.ts", "packages/narrow/src/index.ts", "packages/narrow/src/price.ts"], "{refs:?}");
    ts.shutdown();

    // A constant of the utils package every package lists: 3 of 20 use it.
    let ts = service();
    let constants = root.join("packages/utils/src/constants.ts");
    ts.open(&constants, CONSTANTS);
    let (line, column) = pos(CONSTANTS, "MAX_RETRIES", 0);
    let utils = candidates(&ws, &ts, &constants, line, column, &graph);
    let want: Vec<String> = (1..=USERS).map(|i| format!("packages/p{i:02}/src/index.ts")).collect();
    assert_eq!(utils.files.iter().map(|f| rel(root, f)).collect::<Vec<_>>(), want);
    assert_eq!(utils.packages, Some(PACKAGES + 2), "utils, app1 and the 20 packages; not narrow or shop");

    let (batches, progress, result) = stream(&ts, &constants, line, column, &utils.files, None);
    result.unwrap();
    assert!(batches.len() >= 2, "the loaded project first, then at least the last load: {batches:?}");
    assert!(batches[0].iter().all(|r| r.location.path.starts_with(root.join("packages/utils"))), "first the declaring package: {:?}", batches[0]);
    let all: Vec<&Reference> = batches.iter().flatten().collect();
    let mut locations: Vec<_> = all.iter().map(|r| r.location.clone()).collect();
    locations.sort_by(|a, b| (&a.path, a.line, a.column).cmp(&(&b.path, b.line, b.column)));
    let n = locations.len();
    locations.dedup();
    assert_eq!(locations.len(), n, "no usage is delivered twice");
    let mut files: Vec<String> = locations.iter().map(|l| rel(root, &l.path)).collect();
    files.dedup();
    let mut expected = want.clone();
    expected.push("packages/utils/src/constants.ts".into());
    assert_eq!(files, expected);
    for b in &batches {
        assert!(b.windows(2).all(|w| (&w[0].location.path, w[0].location.line, w[0].location.column) <= (&w[1].location.path, w[1].location.line, w[1].location.column)), "each batch is sorted");
    }
    assert_eq!(progress.first(), Some(&(0, USERS + 1)), "{progress:?}");
    assert_eq!(progress.last(), Some(&(USERS + 1, USERS + 1)), "{progress:?}");
    assert!(progress.windows(2).all(|w| w[0].0 <= w[1].0), "{progress:?}");
    eprintln!("{preference:?}: {} batches, progress {progress:?}", batches.len());
    ts.shutdown();

    // Cancel after the first batch: the call ends with the cancel error, the batch stays.
    let ts = service();
    ts.open(&constants, CONSTANTS);
    let (batches, _, result) = stream(&ts, &constants, line, column, &utils.files, Some(1));
    let err = result.unwrap_err();
    assert!(err.contains(ide_lsp::CANCELLED), "{err}");
    assert_eq!(batches.len(), 1);
    assert!(batches[0].iter().any(|r| r.location.path == constants), "{:?}", batches[0]);
    ts.shutdown();
}

#[test]
fn tsserver_scopes_and_streams_usages() {
    check(TsLink::TsServer, BackendPreference::TsServer);
}

#[test]
fn native_server_scopes_and_streams_usages() {
    check(TsLink::NativeWithOld, BackendPreference::Native);
}
