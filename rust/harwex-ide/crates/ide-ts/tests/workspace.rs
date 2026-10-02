//! Navigation timings on a generated yarn-style workspace: many packages linked into
//! `node_modules/@ws/*`, each importing the previous one, and a dependency with `.d.ts` types
//! and `.js` code. Both backends run on the same tree. The budgets are loose on purpose: they
//! catch a broken setup (a project that never loads, a request that scans everything twice),
//! not small regressions. `-- --nocapture` prints the numbers.

mod common;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use common::{pos, single, TsLink};
use ide_ts::{BackendKind, BackendPreference, TsService};

const PACKAGES: usize = 40;
const MODULES: usize = 30;
const LIB_FUNCTIONS: usize = 200;

struct Workspace {
    _tmp: tempfile::TempDir,
    root: PathBuf,
}

fn write(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

fn generate() -> Workspace {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    write(&root, "package.json", r#"{ "name": "big-ws", "private": true, "workspaces": ["packages/*"] }"#);
    write(
        &root,
        "tsconfig.json",
        r#"{"compilerOptions":{"strict":true,"module":"commonjs","target":"es2020","moduleResolution":"node"},"include":["packages/*/src"]}"#,
    );

    let mut dts = String::from("/** Used by every module. */\nexport declare const shared: number;\n");
    let mut js = String::from("\"use strict\";\nObject.defineProperty(exports, \"__esModule\", { value: true });\nexports.shared = 1;\n");
    for i in 0..LIB_FUNCTIONS {
        dts.push_str(&format!("/** Library function {i}. */\nexport declare function libFn{i}(x: number): number;\n"));
        js.push_str(&format!("function libFn{i}(x) {{\n  return x + {i};\n}}\nexports.libFn{i} = libFn{i};\n"));
    }
    write(&root, "node_modules/big-lib/package.json", r#"{"name":"big-lib","version":"1.0.0","main":"index.js","types":"index.d.ts"}"#);
    write(&root, "node_modules/big-lib/index.d.ts", &dts);
    write(&root, "node_modules/big-lib/index.js", &js);

    std::fs::create_dir_all(root.join("node_modules/@ws")).unwrap();
    for p in 0..PACKAGES {
        let dir = format!("packages/pkg{p}");
        write(&root, &format!("{dir}/package.json"), &format!(r#"{{"name":"@ws/pkg{p}","version":"1.0.0","main":"src/index.ts","types":"src/index.ts"}}"#));
        let mut index = format!("export function helper{p}(x: number): number {{\n  return x * {p};\n}}\n");
        for m in 0..MODULES {
            index.push_str(&format!("export * from \"./mod{m}\";\n"));
            let lib = (p * MODULES + m) % LIB_FUNCTIONS;
            let mut text = format!("import {{ libFn{lib}, shared }} from \"big-lib\";\n");
            if p > 0 {
                text.push_str(&format!("import {{ helper{prev} }} from \"@ws/pkg{prev}\";\n", prev = p - 1));
            } else {
                text.push_str("const helper_root = (x: number): number => x;\n");
            }
            let call = if p > 0 { format!("helper{}", p - 1) } else { "helper_root".into() };
            text.push_str(&format!(
                "\nexport interface Shape{p}_{m} {{\n  id: number;\n  name: string;\n}}\n\nexport function fn{p}_{m}(x: number): number {{\n  const s: Shape{p}_{m} = {{ id: x, name: \"m{m}\" }};\n  return libFn{lib}(s.id) + {call}(x) + shared;\n}}\n"
            ));
            for k in 0..10 {
                text.push_str(&format!("export const value{p}_{m}_{k} = fn{p}_{m}({k});\n"));
            }
            write(&root, &format!("{dir}/src/mod{m}.ts"), &text);
        }
        write(&root, &format!("{dir}/src/index.ts"), &index);
        std::os::unix::fs::symlink(format!("../../{dir}"), root.join(format!("node_modules/@ws/pkg{p}"))).unwrap();
    }
    Workspace { _tmp: tmp, root }
}

fn timed<T>(f: impl FnOnce() -> T) -> (T, Duration) {
    let t = Instant::now();
    let out = f();
    (out, t.elapsed())
}

fn check_backend(preference: BackendPreference, kind: BackendKind) {
    if let Some(why) = common::missing(TsLink::NativeWithOld) {
        eprintln!("skipping: {why}");
        return;
    }
    let (ws, generated) = timed(generate);
    let root = &ws.root;
    std::os::unix::fs::symlink(common::ts7().unwrap(), root.join("node_modules/typescript")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/@typescript")).unwrap();
    std::os::unix::fs::symlink(common::ts5().unwrap(), root.join("node_modules/@typescript/old")).unwrap();

    let ts = TsService::new();
    ts.set_timeout(Duration::from_secs(60));
    ts.set_backend_preference(preference);
    let last = PACKAGES - 1;
    let file = root.join(format!("packages/pkg{last}/src/mod0.ts"));
    let text = std::fs::read_to_string(&file).unwrap();
    assert_eq!(ts.backend(&file).unwrap().kind, kind);
    ts.open(&file, &text);

    // Across the workspace link: the server answers with the package's real path.
    let (line, column) = pos(&text, &format!("helper{}(x)", last - 1), 0);
    let (cold, cold_time) = timed(|| ts.definition(&file, line, column).unwrap());
    assert_eq!(single(cold).path, root.join(format!("packages/pkg{}/src/index.ts", last - 1)));

    let mut warm_total = Duration::ZERO;
    for _ in 0..20 {
        let (locs, t) = timed(|| ts.definition(&file, line, column).unwrap());
        assert_eq!(locs.len(), 1);
        warm_total += t;
    }
    let warm = warm_total / 20;

    let lib = (last * MODULES) % LIB_FUNCTIONS;
    let (line, column) = pos(&text, &format!("libFn{lib}(s.id)"), 0);
    let (dts, dts_time) = timed(|| single(ts.definition(&file, line, column).unwrap()));
    assert_eq!(dts.path, root.join("node_modules/big-lib/index.d.ts"));
    let (src, src_time) = timed(|| single(ts.source_definition(&file, line, column).unwrap()));
    assert_eq!(src.path, root.join("node_modules/big-lib/index.js"));
    let (info, info_time) = timed(|| ts.quick_info(&file, line, column).unwrap());
    assert!(info.is_some_and(|i| i.display.contains(&format!("libFn{lib}"))));

    let (line, column) = pos(&text, "shared;", 0);
    let (refs, refs_time) = timed(|| ts.references(&file, line, column).unwrap());
    // Each module imports and uses `shared`, plus the declaration.
    assert!(refs.len() > PACKAGES * MODULES, "{} references", refs.len());
    ts.shutdown();

    eprintln!(
        "{kind:?} on {} files: generate {generated:?}, cold definition {cold_time:?}, warm definition {warm:?} (avg of 20), \
         .d.ts definition {dts_time:?}, source definition {src_time:?}, quick info {info_time:?}, references ({}) {refs_time:?}",
        PACKAGES * (MODULES + 1),
        refs.len()
    );
    assert!(cold_time < Duration::from_secs(15), "cold definition took {cold_time:?}");
    assert!(warm < Duration::from_millis(50), "warm definition took {warm:?}");
    assert!(src_time < Duration::from_secs(3), "source definition took {src_time:?}");
    assert!(refs_time < Duration::from_secs(5), "references took {refs_time:?}");
}

#[test]
fn native_server_timings_on_generated_workspace() {
    check_backend(BackendPreference::Native, BackendKind::NativeLsp);
}

#[test]
fn tsserver_timings_on_generated_workspace() {
    check_backend(BackendPreference::TsServer, BackendKind::TsServer);
}
