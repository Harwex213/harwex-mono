//! The workspace package graph: which packages list which others in their `package.json`. It
//! narrows the Find Usages pre-filter (`symbol_candidates`) to the packages that can import a
//! symbol. Only names and folders are kept, never file contents.

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use serde_json::Value;

/// One `package.json` of the workspace.
#[derive(Clone, Debug)]
struct Package {
    dir: PathBuf,
    name: Option<String>,
}

/// Packages by folder, with reverse dependency edges. Build it from the `package.json` files of
/// the file index ([`PackageGraph::build`]); an empty graph makes every file "outside any
/// package", so the pre-filter scans everything.
#[derive(Clone, Debug, Default)]
pub struct PackageGraph {
    packages: Vec<Package>,
    by_dir: HashMap<OsString, usize>,
    /// Package -> the packages that list it in `dependencies`, `devDependencies` or
    /// `peerDependencies`.
    dependents: Vec<Vec<usize>>,
}

impl PackageGraph {
    /// Reads the given `package.json` files. Files under `node_modules` and workspace roots (a
    /// manifest with `workspaces`) are skipped: a root's own files count as outside any package.
    /// A manifest that does not parse still makes its folder a package, without dependencies.
    pub fn build(manifests: impl IntoIterator<Item = PathBuf>) -> PackageGraph {
        let mut graph = PackageGraph::default();
        let mut deps: Vec<Vec<String>> = Vec::new();
        let mut links: Vec<Vec<PathBuf>> = Vec::new();
        for manifest in manifests {
            if manifest.file_name().is_none_or(|n| n != "package.json") || in_node_modules(&manifest) {
                continue;
            }
            let Some(dir) = manifest.parent().map(Path::to_path_buf) else { continue };
            let json: Value = std::fs::read_to_string(&manifest).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
            if !json["workspaces"].is_null() || graph.by_dir.contains_key(dir.as_os_str()) {
                continue;
            }
            let (names, paths) = dependency_names(&json, &dir);
            graph.by_dir.insert(dir.clone().into_os_string(), graph.packages.len());
            graph.packages.push(Package { dir, name: json["name"].as_str().map(str::to_string) });
            deps.push(names);
            links.push(paths);
        }
        let mut by_name: HashMap<&str, Vec<usize>> = HashMap::new();
        for (i, p) in graph.packages.iter().enumerate() {
            if let Some(n) = &p.name {
                by_name.entry(n.as_str()).or_default().push(i);
            }
        }
        let mut dependents: Vec<HashSet<usize>> = vec![HashSet::new(); graph.packages.len()];
        for (user, names) in deps.iter().enumerate() {
            for n in names {
                for &target in by_name.get(n.as_str()).into_iter().flatten() {
                    if target != user {
                        dependents[target].insert(user);
                    }
                }
            }
            for dir in &links[user] {
                if let Some(&target) = graph.by_dir.get(dir.as_os_str()) {
                    if target != user {
                        dependents[target].insert(user);
                    }
                }
            }
        }
        graph.dependents = dependents
            .into_iter()
            .map(|s| {
                let mut v: Vec<usize> = s.into_iter().collect();
                v.sort_unstable();
                v
            })
            .collect();
        graph
    }

    /// The graph of the `package.json` files among `files`.
    pub fn from_files(files: &[PathBuf]) -> PackageGraph {
        PackageGraph::build(files.iter().filter(|f| f.file_name().is_some_and(|n| n == "package.json")).cloned())
    }

    /// The number of packages.
    pub fn len(&self) -> usize {
        self.packages.len()
    }

    pub fn is_empty(&self) -> bool {
        self.packages.is_empty()
    }

    /// The package that owns folder `dir`: the nearest folder with a `package.json` at or above
    /// it. `None` outside any package and inside `node_modules`. `memo` holds the answers by
    /// folder; it borrows the folders from `dir`, so hashing never walks path components.
    pub(crate) fn package_of_dir<'a>(&self, dir: &'a Path, memo: &mut HashMap<&'a OsStr, Option<usize>>) -> Option<usize> {
        let mut missed: Vec<&'a OsStr> = Vec::new();
        let mut found = None;
        for d in dir.ancestors() {
            if let Some(known) = memo.get(d.as_os_str()) {
                found = *known;
                break;
            }
            if d.file_name().is_some_and(|n| n == "node_modules") {
                // Everything below a `node_modules` belongs to no workspace package.
                missed.push(d.as_os_str());
                found = None;
                break;
            }
            missed.push(d.as_os_str());
            if let Some(&i) = self.by_dir.get(d.as_os_str()) {
                found = Some(i);
                break;
            }
        }
        // A folder below a `node_modules` gets `None`; the `node_modules` folder itself too.
        for d in missed {
            memo.insert(d, found);
        }
        found
    }

    /// The package of a file, like [`PackageGraph::package_of_dir`] for its folder.
    pub(crate) fn package_of(&self, file: &Path) -> Option<usize> {
        if in_node_modules(file) {
            return None;
        }
        self.package_of_dir(file.parent()?, &mut HashMap::new())
    }

    /// The packages that list package `i` as a dependency.
    pub(crate) fn dependents(&self, i: usize) -> &[usize] {
        self.dependents.get(i).map(Vec::as_slice).unwrap_or_default()
    }

    pub(crate) fn name(&self, i: usize) -> Option<&str> {
        self.packages.get(i).and_then(|p| p.name.as_deref())
    }

    /// The folder of package `i`.
    pub fn dir(&self, i: usize) -> &Path {
        &self.packages[i].dir
    }
}

/// The package names a manifest depends on, and the folders of `link:`/`file:`/`portal:`
/// dependencies. An alias (`"x": "npm:@ws/real@^1"`) names its target too.
fn dependency_names(json: &Value, dir: &Path) -> (Vec<String>, Vec<PathBuf>) {
    let mut names = Vec::new();
    let mut paths = Vec::new();
    for field in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
        let Some(map) = json[field].as_object() else { continue };
        for (name, spec) in map {
            names.push(name.clone());
            let Some(spec) = spec.as_str() else { continue };
            if let Some(target) = spec.strip_prefix("npm:") {
                // `@scope/name@range` or `name@range`: the last `@` after the first char.
                let end = target[1..].find('@').map_or(target.len(), |i| i + 1);
                names.push(target[..end].to_string());
            }
            for prefix in ["link:", "file:", "portal:"] {
                if let Some(rel) = spec.strip_prefix(prefix) {
                    paths.push(lexical_join(dir, rel));
                }
            }
        }
    }
    (names, paths)
}

fn lexical_join(dir: &Path, rel: &str) -> PathBuf {
    let mut out = dir.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::Normal(n) => out.push(n),
            _ => {}
        }
    }
    out
}

pub(crate) fn in_node_modules(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "node_modules")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, text: &str) -> PathBuf {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, text).unwrap();
        p
    }

    #[test]
    fn dependents_follow_names_aliases_and_links() {
        let tmp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(tmp.path()).unwrap();
        let files = vec![
            write(&root, "package.json", r#"{"name": "root", "workspaces": ["packages/*"], "dependencies": {"@ws/core": "workspace:*"}}"#),
            write(&root, "packages/core/package.json", r#"{"name": "@ws/core"}"#),
            write(&root, "packages/a/package.json", r#"{"name": "@ws/a", "dependencies": {"@ws/core": "workspace:*"}}"#),
            write(&root, "packages/b/package.json", r#"{"name": "@ws/b", "devDependencies": {"core-alias": "npm:@ws/core@^1"}}"#),
            write(&root, "packages/c/package.json", r#"{"name": "@ws/c", "peerDependencies": {"x": "link:../core"}}"#),
            write(&root, "packages/d/package.json", r#"{"name": "@ws/d", "dependencies": {"@ws/a": "workspace:^"}}"#),
            write(&root, "packages/broken/package.json", "{ not json"),
            write(&root, "node_modules/@ws/core/package.json", r#"{"name": "@ws/core"}"#),
        ];
        let g = PackageGraph::from_files(&files);
        assert_eq!(g.len(), 6, "the workspace root and node_modules are no packages");
        let core = g.package_of(&root.join("packages/core/src/x.ts")).unwrap();
        let names: Vec<&str> = g.dependents(core).iter().filter_map(|&i| g.name(i)).collect();
        assert_eq!(names, ["@ws/a", "@ws/b", "@ws/c"], "d depends on a only; the root is not a package");
        assert_eq!(g.package_of(&root.join("scripts/build.ts")), None);
        assert_eq!(g.package_of(&root.join("packages/core/node_modules/y/index.ts")), None);
        assert!(g.package_of(&root.join("packages/broken/src/z.ts")).is_some());
        let mut memo = HashMap::new();
        let nested = root.join("packages/core/node_modules/y");
        assert_eq!(g.package_of_dir(&nested, &mut memo), None, "a folder inside node_modules");
        let src = root.join("packages/core/src/deep");
        assert_eq!(g.package_of_dir(&src, &mut memo), Some(core), "the memo answered node_modules only for its own folders");
    }
}
