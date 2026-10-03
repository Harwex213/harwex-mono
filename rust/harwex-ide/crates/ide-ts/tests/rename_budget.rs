//! File rename timings on a generated monorepo: 200 packages, each its own TypeScript project
//! (own `tsconfig.json`), and a `core` package whose `src/shapes.ts` 30 packages import. No
//! package except `core` is loaded before the rename. The preview (text pre-filter, opening one
//! file per candidate project, the edits request) has a budget on both backends, with a warm
//! server. `-- --nocapture` prints the numbers.

mod common;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use common::TsLink;
use ide_ts::{BackendKind, BackendPreference, TsService};

const PACKAGES: usize = 200;
const IMPORTERS: usize = 30;
const MODULES: usize = 5;

fn write(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

/// Returns the root and every code file, as the app's file index would list them.
fn generate(root: &Path) -> Vec<PathBuf> {
    let tsconfig = r#"{"compilerOptions":{"strict":true,"module":"commonjs","target":"es2020","moduleResolution":"node"},"include":["src"]}"#;
    write(root, "package.json", r#"{ "name": "rename-ws", "private": true, "workspaces": ["packages/*"] }"#);
    write(root, "packages/core/tsconfig.json", tsconfig);
    write(root, "packages/core/package.json", r#"{"name":"@ws/core","version":"1.0.0","main":"src/index.ts"}"#);
    write(root, "packages/core/src/shapes.ts", "export interface Shape {\n  w: number;\n  h: number;\n}\n\nexport function area(s: Shape): number {\n  return s.w * s.h;\n}\n");
    write(root, "packages/core/src/index.ts", "export * from \"./shapes\";\n");
    let mut files = vec![root.join("packages/core/src/shapes.ts"), root.join("packages/core/src/index.ts")];
    for p in 0..PACKAGES {
        let dir = format!("packages/pkg{p}");
        write(root, &format!("{dir}/tsconfig.json"), tsconfig);
        write(root, &format!("{dir}/package.json"), &format!(r#"{{"name":"@ws/pkg{p}","version":"1.0.0","main":"src/mod0.ts"}}"#));
        for m in 0..MODULES {
            let mut text = String::new();
            // The first module of the first IMPORTERS packages imports the shared file.
            if m == 0 && p < IMPORTERS {
                text.push_str("import { area, Shape } from \"../../core/src/shapes\";\n\n");
                text.push_str(&format!("export const size{p} = (s: Shape): number => area(s) + {p};\n"));
            }
            for k in 0..20 {
                text.push_str(&format!("export function f{p}_{m}_{k}(x: number): number {{\n  return x * {k} + {m};\n}}\n"));
            }
            let rel = format!("{dir}/src/mod{m}.ts");
            write(root, &rel, &text);
            files.push(root.join(rel));
        }
    }
    files
}

fn check_backend(preference: BackendPreference, kind: BackendKind) {
    if let Some(why) = common::missing(TsLink::NativeWithOld) {
        eprintln!("skipping: {why}");
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let files = generate(&root);
    std::fs::create_dir_all(root.join("node_modules/@typescript")).unwrap();
    std::os::unix::fs::symlink(common::ts7().unwrap(), root.join("node_modules/typescript")).unwrap();
    std::os::unix::fs::symlink(common::ts5().unwrap(), root.join("node_modules/@typescript/old")).unwrap();

    let ts = TsService::new();
    ts.set_timeout(Duration::from_secs(60));
    ts.set_backend_preference(preference);
    let shapes = root.join("packages/core/src/shapes.ts");
    assert_eq!(ts.backend(&shapes).unwrap().kind, kind);
    // Warm: the server runs and has the renamed file's own project loaded.
    let text = std::fs::read_to_string(&shapes).unwrap();
    ts.open(&shapes, &text);
    let warm = ts.quick_info(&shapes, 5, 17).unwrap();
    assert!(warm.is_some());

    let started = Instant::now();
    let candidates = ide_ts::import_candidates(&files, &shapes, &AtomicBool::new(false));
    let scan = started.elapsed();
    // The index.ts re-export of core plus the importers.
    assert_eq!(candidates.len(), IMPORTERS + 1, "{candidates:?}");
    let found = ts.edits_for_file_rename(&shapes, &root.join("packages/core/src/geometry.ts"), &candidates).unwrap();
    let preview = started.elapsed();
    ts.shutdown();

    assert_eq!(found.projects_loaded, IMPORTERS + 1, "core plus one project per importer");
    assert_eq!(found.edits.len(), IMPORTERS + 1, "every importer and core's index.ts change");
    for e in &found.edits {
        assert_eq!(e.edits.len(), 1, "{e:?}");
        assert!(e.edits[0].new_text.contains("geometry"), "{e:?}");
    }
    eprintln!(
        "{kind:?}: rename preview on {} files ({} projects): scan {scan:?} ({} candidates), whole preview {preview:?}, {} projects loaded, {} files changed",
        files.len(),
        PACKAGES + 1,
        candidates.len(),
        found.projects_loaded,
        found.edits.len()
    );
    assert!(scan < Duration::from_millis(500), "pre-filter took {scan:?}");
    let budget = match kind {
        BackendKind::NativeLsp => Duration::from_secs(2),
        BackendKind::TsServer => Duration::from_secs(8),
    };
    assert!(preview < budget, "rename preview took {preview:?}, budget {budget:?}");
}

#[test]
fn native_server_rename_preview_budget() {
    check_backend(BackendPreference::Native, BackendKind::NativeLsp);
}

#[test]
fn tsserver_rename_preview_budget() {
    check_backend(BackendPreference::TsServer, BackendKind::TsServer);
}
