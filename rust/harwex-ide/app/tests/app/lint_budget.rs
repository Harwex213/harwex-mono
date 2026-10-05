//! ESLint and oxlint on a generated monorepo of 200 packages: cold start to the first
//! diagnostics, a cold lint in a second package, warm per-file lint after an edit, and the
//! memory of the linter processes. Once without type-aware rules and once with them
//! (typescript-eslint `projectService`, oxlint `oxlint-tsgolint`). The sources run directly,
//! without the UI, the way the lint queue calls them.
//!
//! `cargo test -p harwex-ide --test app lint_budget:: -- --nocapture` prints the table. Budgets are
//! in `docs/timings.md`. Skipped (with a printed reason) without ESLint or oxlint from
//! `cargo xtask test-tools`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::common::*;
use harwex_ide::diagnostics::eslint::EslintSource;
use harwex_ide::diagnostics::oxlint::OxlintSource;
use harwex_ide::diagnostics::{strategy, LintSource, LintTarget};
use harwex_ide::lang::config::{DiagnosticsConfig, OxlintConfig};
use harwex_ide::memory::{ProcessSource, RealSource};

const SUITE: &str = "lint_budget";
const PACKAGES: usize = 200;
/// Packages `p000`..`p009` are shared libraries; every other package imports two of them.
const LIBS: usize = 10;
const FILES: usize = 5;
/// Packages linted after the first one, for the memory of many loaded projects.
const MORE: usize = 20;
const WARM_RUNS: usize = 15;

/// Warm per-file lint after an edit, median.
const WARM_BUDGET: Duration = Duration::from_millis(300);
const WARM_TYPED_BUDGET: Duration = Duration::from_millis(1000);
/// The first diagnostics in a generated package, including the process start.
const COLD_BUDGET: Duration = Duration::from_secs(20);

fn pkg(i: usize) -> String {
    format!("p{i:03}")
}

/// One source file: exported functions and a class, imports from its package and two
/// libraries, and four problems every linter here reports: a floating promise (type-aware),
/// `==`, `debugger` and an unused variable.
fn source(i: usize, f: usize) -> String {
    let mut s = String::new();
    if i >= LIBS {
        let (a, b) = (i % LIBS, (i * 7 + f) % LIBS);
        s.push_str(&format!("import {{ lib{a}Value, Lib{a} }} from \"../../{}/src/index\";\n", pkg(a)));
        s.push_str(&format!("import {{ lib{b}Async }} from \"../../{}/src/index\";\n", pkg(b)));
    }
    if f > 0 {
        s.push_str("import { local } from \"./index\";\n");
    }
    s.push('\n');
    for n in 0..12 {
        s.push_str(&format!(
            "export function fn{f}_{n}(input: number, label: string): string {{\n  const doubled = input * 2 + {n};\n  if (doubled > 100) {{\n    return `${{label}}:${{doubled}}`;\n  }}\n  return label.repeat(Math.max(1, doubled % 3));\n}}\n\n"
        ));
    }
    s.push_str(&format!(
        "export class Store{f} {{\n  private items = new Map<string, number>();\n  add(key: string, n: number): void {{\n    this.items.set(key, (this.items.get(key) ?? 0) + n);\n  }}\n  total(): number {{\n    let t = 0;\n    for (const v of this.items.values()) {{\n      t += v;\n    }}\n    return t;\n  }}\n}}\n\n"
    ));
    if i < LIBS && f == 0 {
        s.push_str(&format!("export const lib{i}Value = {i};\nexport class Lib{i} {{\n  value = {i};\n}}\nexport async function lib{i}Async(): Promise<number> {{\n  return {i};\n}}\nexport function local(): number {{\n  return {i};\n}}\n"));
    } else if f == 0 {
        s.push_str("export function local(): number {\n  return 1;\n}\n");
    }
    s.push_str("export async function run(flag: number): Promise<void> {\n");
    if i >= LIBS {
        let b = (i * 7 + f) % LIBS;
        s.push_str(&format!("  lib{b}Async();\n"));
    } else {
        s.push_str("  Promise.resolve(flag);\n");
    }
    s.push_str("  const unused = flag;\n  if (flag == 2) {\n    debugger;\n  }\n}\n");
    s
}

const SHARED_PLAIN: &str = "import js from \"@eslint/js\";\nimport tseslint from \"typescript-eslint\";\n\nexport function config(dir) {\n  return [\n    { ignores: [\"eslint.config.mjs\"] },\n    js.configs.recommended,\n    ...tseslint.configs.recommended,\n    { rules: { eqeqeq: \"error\", \"no-debugger\": \"error\" } },\n  ];\n}\n";

const SHARED_TYPED: &str = "import js from \"@eslint/js\";\nimport tseslint from \"typescript-eslint\";\n\nexport function config(dir) {\n  return [\n    { ignores: [\"eslint.config.mjs\"] },\n    js.configs.recommended,\n    ...tseslint.configs.recommendedTypeChecked,\n    { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: dir } } },\n    { rules: { eqeqeq: \"error\", \"no-debugger\": \"error\" } },\n  ];\n}\n";

/// The monorepo: 200 packages, each with its own `eslint.config.mjs` built from a shared
/// root module, its own `tsconfig.json`, and one root `.oxlintrc.json`.
fn generate(root: &Path, typed: bool) {
    write(root, "package.json", "{ \"name\": \"mono\", \"private\": true, \"workspaces\": [\"packages/*\"] }\n");
    write(root, "eslint.shared.mjs", if typed { SHARED_TYPED } else { SHARED_PLAIN });
    let typed_rule = if typed { ", \"typescript/no-floating-promises\": \"error\"" } else { "" };
    write(
        root,
        ".oxlintrc.json",
        &format!("{{\n  \"plugins\": [\"typescript\"],\n  \"rules\": {{ \"eqeqeq\": \"error\", \"no-debugger\": \"error\", \"no-unused-vars\": \"error\"{typed_rule} }}\n}}\n"),
    );
    let tsconfig = "{\n  \"compilerOptions\": { \"strict\": true, \"module\": \"commonjs\", \"target\": \"es2020\", \"lib\": [\"es2020\"], \"skipLibCheck\": true },\n  \"include\": [\"src\"]\n}\n";
    for i in 0..PACKAGES {
        let p = format!("packages/{}", pkg(i));
        write(root, &format!("{p}/package.json"), &format!("{{ \"name\": \"{}\", \"private\": true }}\n", pkg(i)));
        write(root, &format!("{p}/tsconfig.json"), tsconfig);
        write(root, &format!("{p}/eslint.config.mjs"), "import { config } from \"../../eslint.shared.mjs\";\n\nexport default config(import.meta.dirname);\n");
        for f in 0..FILES {
            let name = if f == 0 { "index".to_string() } else { format!("f{f}") };
            write(root, &format!("{p}/src/{name}.ts"), &source(i, f));
        }
    }
    link_eslint(root);
    std::os::unix::fs::symlink(oxlint().expect("oxlint"), root.join("node_modules/oxlint")).expect("oxlint link");
}

/// Memory of every process below this test process (the linter, its node and tsgolint). The
/// other tests of the `app` binary add their children too, unless a filter runs this suite alone.
fn children_memory() -> u64 {
    let Some(src) = RealSource::new() else { return 0 };
    let mut stack = vec![src.self_pid()];
    let mut total = 0;
    let mut first = true;
    while let Some(pid) = stack.pop() {
        if !first {
            total += src.stat(pid).map_or(0, |s| s.memory);
        }
        first = false;
        src.children(pid, &mut stack);
    }
    total
}

#[derive(Debug)]
struct Row {
    cold: Duration,
    cold_next: Duration,
    warm: Duration,
    mem_one: u64,
    mem_many: u64,
    /// After every file was closed again.
    mem_closed: u64,
    problems: usize,
    /// A type-aware rule reported the floating promise.
    typed: bool,
}

fn measure(source: &dyn LintSource, target: impl Fn(&Path) -> LintTarget, root: &Path) -> Row {
    let file = |i: usize, f: usize| root.join(format!("packages/{}/src/{}.ts", pkg(i), if f == 0 { "index".into() } else { format!("f{f}") }));
    let lint = |path: &PathBuf, text: &str| source.lint(&target(path), path, text).unwrap_or_else(|e| panic!("lint {}: {e}", path.display()));
    let first = file(100, 1);
    let text = std::fs::read_to_string(&first).expect("read");
    let t = Instant::now();
    let found = lint(&first, &text);
    let typed = found.iter().any(|d| d.code.as_deref().is_some_and(|c| c.contains("no-floating-promises")));
    let problems = found.len();
    let cold = t.elapsed();
    let second = file(150, 2);
    let t = Instant::now();
    lint(&second, &std::fs::read_to_string(&second).expect("read"));
    let cold_next = t.elapsed();
    let mut times: Vec<Duration> = (0..WARM_RUNS)
        .map(|n| {
            let edited = format!("{text}\nexport const edit{n} = {n};\n");
            let t = Instant::now();
            lint(&first, &edited);
            t.elapsed()
        })
        .collect();
    times.sort();
    let warm = times[WARM_RUNS / 2];
    let mem_one = children_memory();
    for i in 0..MORE {
        let p = file(LIBS + 3 + i * 9, i % FILES);
        lint(&p, &std::fs::read_to_string(&p).expect("read"));
    }
    let mem_many = children_memory();
    let mut linted = vec![first.clone(), second.clone()];
    linted.extend((0..MORE).map(|i| file(LIBS + 3 + i * 9, i % FILES)));
    for p in &linted {
        source.close(p);
    }
    // The ESLint server drops its instances and TS projects after the last close.
    std::thread::sleep(Duration::from_millis(500));
    let mem_closed = children_memory();
    source.shutdown();
    Row { cold, cold_next, warm, mem_one, mem_many, mem_closed, problems, typed }
}

/// oxlint turns type-aware rules on whenever tsgolint is installed; the plain run turns them
/// off, so both linters compare without types.
fn plan(path: &Path, typed: bool) -> strategy::Plan {
    let config = DiagnosticsConfig { oxlint: OxlintConfig { type_aware: Some(typed), ..OxlintConfig::default() }, ..DiagnosticsConfig::default() };
    strategy::plan(true, &strategy::detect(path), &config)
}

fn run(typed: bool) -> Option<(Row, Row)> {
    let name = if typed { "typed" } else { "plain" };
    if skip_without_eslint(&format!("lint_budget {name}")) {
        return None;
    }
    if let Err(why) = oxlint() {
        eprintln!("skipping lint_budget {name}: {why}");
        return None;
    }
    let fx = Fixture::new(SUITE, name);
    let root = fx.dir.join("mono");
    generate(&root, typed);
    let root = std::fs::canonicalize(&root).expect("canonical");

    let eslint = EslintSource::new(None);
    let es = measure(&eslint, |p| LintTarget::Eslint(plan(p, typed).eslint.expect("ESLint planned")), &root);
    let oxlint = Arc::new(OxlintSource::default());
    let ox = measure(oxlint.as_ref(), |p| LintTarget::Oxlint(plan(p, typed).oxlint.expect("oxlint planned")), &root);
    Some((es, ox))
}

fn mb(bytes: u64) -> String {
    format!("{} MB", bytes / (1024 * 1024))
}

fn ms(d: Duration) -> String {
    format!("{:.0} ms", d.as_secs_f64() * 1000.0)
}

fn print(label: &str, r: &Row) {
    println!(
        "| {label} | {} | {} | {} | {} | {} | {} | {} |",
        ms(r.cold),
        ms(r.cold_next),
        ms(r.warm),
        mb(r.mem_one),
        mb(r.mem_many),
        mb(r.mem_closed),
        r.problems
    );
}

#[test]
fn eslint_and_oxlint_on_a_200_package_monorepo() {
    let rows: Vec<(bool, Row, Row)> = [false, true].into_iter().filter_map(|typed| run(typed).map(|(es, ox)| (typed, es, ox))).collect();
    if rows.is_empty() {
        return;
    }
    println!("\n| linter | cold first file | cold 2nd package | warm per file (median) | memory, 1 package | memory, {} packages | memory, all closed | problems in the file |", MORE + 2);
    println!("|---|---|---|---|---|---|---|---|");
    for (typed, es, ox) in &rows {
        let kind = if *typed { "type-aware" } else { "no types" };
        print(&format!("ESLint, {kind}"), es);
        print(&format!("oxlint, {kind}"), ox);
    }
    for (typed, es, ox) in &rows {
        // `debugger`, `==` and the unused variable at least; type-aware adds the floating promise.
        for (name, r) in [("ESLint", es), ("oxlint", ox)] {
            assert!(r.problems >= 3, "{name} found {} problems (typed {typed}): the rules did not run", r.problems);
            assert_eq!(r.typed, *typed, "{name}: type-aware rules ran = {}, wanted {typed}", r.typed);
        }
        let warm_budget = if *typed { WARM_TYPED_BUDGET } else { WARM_BUDGET };
        for (name, r) in [("ESLint", es), ("oxlint", ox)] {
            assert!(r.warm < warm_budget, "{name} warm lint {:?} over {warm_budget:?} (typed {typed})", r.warm);
            assert!(r.cold < COLD_BUDGET, "{name} cold start {:?} over {COLD_BUDGET:?} (typed {typed})", r.cold);
        }
    }
}
