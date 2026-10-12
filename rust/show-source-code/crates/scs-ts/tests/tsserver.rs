//! Runs the real tsserver on the demo monorepo. Needs node and a `typescript` package: set
//! `SCS_TYPESCRIPT_DIR`, or the test uses harwex-mono's `javascript/node_modules/typescript`.
//! Without them the test prints why and passes.

use std::path::{Path, PathBuf};

fn typescript_dir() -> Option<PathBuf> {
    let dir = std::env::var_os("SCS_TYPESCRIPT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../javascript/node_modules/typescript"));
    dir.join("lib/tsserver.js").is_file().then(|| dir.canonicalize().unwrap())
}

#[test]
fn resolves_cross_package_imports_to_files() {
    let (Some(ts), Some(_)) = (typescript_dir(), scs_ts::find_node()) else {
        eprintln!("skipped: node or typescript not found");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    scs_workspace::fixture::write_demo(&root).unwrap();
    std::os::unix::fs::symlink(&ts, root.join("node_modules/typescript")).unwrap();

    let mut r = scs_ts::Resolver::start(&root).expect("tsserver starts");
    let keep = |s: &str| scs_ts::package_of(s).is_some_and(|p| p.starts_with("@fx/"));
    let main = root.join("packages/web/src/main.tsx");
    let imports = r.resolve_file(&main, &keep).unwrap();
    let got: Vec<(&str, Option<PathBuf>)> = imports.iter().map(|i| (i.specifier.as_str(), i.target.clone())).collect();
    assert_eq!(
        got,
        [("@fx/ui", Some(root.join("packages/ui/src/index.ts"))), ("@fx/core", Some(root.join("packages/core/src/index.ts")))]
    );
}
