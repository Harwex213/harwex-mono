use super::*;

fn demo() -> (tempfile::TempDir, Workspace) {
    let tmp = tempfile::tempdir().expect("tempdir");
    fixture::write_demo(tmp.path()).expect("fixture");
    let ws = discover(tmp.path(), &Options::default()).expect("discover");
    (tmp, ws)
}

fn names(ws: &Workspace) -> Vec<&str> {
    ws.packages.iter().map(|p| p.name.as_str()).collect()
}

#[test]
fn finds_workspace_packages_from_globs() {
    let (_tmp, ws) = demo();
    assert_eq!(names(&ws), ["@fx/config", "@fx/core", "@fx/legacy", "@fx/ui", "@fx/utils", "@fx/web", "@fx/scratch"]);
    assert_eq!(ws.node_linker.as_deref(), Some("node-modules"));
}

#[test]
fn skips_installed_built_and_declaration_files() {
    let (_tmp, ws) = demo();
    let ui = &ws.packages[ws.package_by_name("@fx/ui").unwrap()];
    let files: Vec<&str> = ui.files.iter().map(|f| f.rel_path.as_str()).collect();
    assert_eq!(files, ["src/Button.tsx", "src/Panel.tsx", "src/index.ts"]);
    let core = &ws.packages[ws.package_by_name("@fx/core").unwrap()];
    assert!(core.files.iter().all(|f| !f.rel_path.ends_with(".d.ts")));
    assert_eq!(ws.file_count(), 13);
}

#[test]
fn internal_deps_come_from_all_dependency_fields() {
    let (_tmp, ws) = demo();
    let id = |n: &str| ws.package_by_name(n).unwrap();
    let has = |a: &str, b: &str, kind: DepKind| ws.deps.contains(&Dep { from: id(a), to: id(b), kind });
    assert!(has("@fx/web", "@fx/ui", DepKind::Prod));
    assert!(has("@fx/web", "@fx/config", DepKind::Dev));
    assert!(has("@fx/config", "@fx/utils", DepKind::Peer));
    assert!(has("@fx/core", "@fx/utils", DepKind::Prod));
    // External packages (react) are not edges.
    assert_eq!(ws.deps.len(), 6);
}

#[test]
fn preview_is_cut_and_counts_all_lines() {
    let (_tmp, ws) = demo();
    let core = &ws.packages[ws.package_by_name("@fx/core").unwrap()];
    let table = core.files.iter().find(|f| f.rel_path == "src/table.ts").unwrap();
    assert_eq!(table.lines, 63, "exact count in a small repo");
    let p = read_preview(&table.path, Options::default().preview_lines);
    assert_eq!(p.lines.len(), Options::default().preview_lines);
    assert_eq!(p.total_lines, 63);
}

#[test]
fn generated_dirs_are_skipped_in_any_case() {
    let tmp = tempfile::tempdir().unwrap();
    let w = |rel: &str| {
        let p = tmp.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "export {};\n").unwrap();
    };
    w("src/a.ts");
    w("src/Generated/b.ts");
    w("src/Build/c.ts");
    w("src/.cache/d.ts");
    w("target/e.ts");
    std::fs::write(tmp.path().join("package.json"), r#"{ "name": "solo" }"#).unwrap();
    let ws = discover(tmp.path(), &Options::default()).unwrap();
    let files: Vec<&str> = ws.packages[0].files.iter().map(|f| f.rel_path.as_str()).collect();
    assert_eq!(files, ["src/a.ts"]);
}

#[test]
fn root_is_found_from_inside_and_from_above() {
    let tmp = tempfile::tempdir().unwrap();
    let mono = tmp.path().join("repo/javascript");
    fixture::write_demo(&mono).unwrap();
    let mono = mono.canonicalize().unwrap();
    assert_eq!(find_root(&mono.join("packages/ui/src")), mono);
    assert_eq!(find_root(&tmp.path().join("repo")), mono);
    assert_eq!(find_root(&mono), mono);
    // A smaller workspace next to it loses.
    let small = tmp.path().join("repo/artifacts");
    std::fs::create_dir_all(small.join("packages/one")).unwrap();
    std::fs::write(small.join("package.json"), r#"{ "workspaces": ["packages/*"] }"#).unwrap();
    assert_eq!(find_root(&tmp.path().join("repo")), mono);
    let plain = tmp.path().join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    assert_eq!(find_root(&plain), plain.canonicalize().unwrap());
}

#[test]
fn progress_counts_source_files() {
    let tmp = tempfile::tempdir().unwrap();
    fixture::write_demo(tmp.path()).unwrap();
    let progress = Arc::new(AtomicUsize::new(0));
    let ws = discover(tmp.path(), &Options { progress: Some(progress.clone()), ..Options::default() }).unwrap();
    // Files outside every package (none here) are counted too, so at least the cards.
    assert!(progress.load(Ordering::Relaxed) >= ws.file_count());
}

#[test]
fn nested_package_owns_its_files() {
    let tmp = tempfile::tempdir().unwrap();
    let w = |rel: &str, s: &str| {
        let p = tmp.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    };
    w("package.json", r#"{ "workspaces": ["packages/**/*", "!packages/skip"] }"#);
    w("packages/outer/package.json", r#"{ "name": "outer" }"#);
    w("packages/outer/a.ts", "export {};\n");
    w("packages/outer/inner/package.json", r#"{ "name": "inner" }"#);
    w("packages/outer/inner/b.ts", "export {};\n");
    w("packages/skip/package.json", r#"{ "name": "skip" }"#);
    let ws = discover(tmp.path(), &Options::default()).unwrap();
    assert_eq!(names(&ws), ["outer", "inner"]);
    assert_eq!(ws.packages[0].files.iter().map(|f| f.rel_path.as_str()).collect::<Vec<_>>(), ["a.ts"]);
    assert_eq!(ws.packages[1].files.iter().map(|f| f.rel_path.as_str()).collect::<Vec<_>>(), ["b.ts"]);
}

#[test]
fn root_without_workspaces_is_one_package() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("package.json"), r#"{ "name": "solo" }"#).unwrap();
    std::fs::write(tmp.path().join("x.ts"), "let a = 1;\n").unwrap();
    let ws = discover(tmp.path(), &Options::default()).unwrap();
    assert_eq!(names(&ws), ["solo"]);
    assert_eq!(ws.packages[0].files[0].rel_path, "x.ts");
}

#[test]
fn tabs_expand_and_long_lines_are_cut() {
    assert_eq!(clean_line("\tx\ty"), "    x   y");
    assert_eq!(clean_line(&"a".repeat(500)).chars().count(), MAX_LINE_CHARS + 1);
}
