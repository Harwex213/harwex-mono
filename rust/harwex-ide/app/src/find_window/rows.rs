//! The Find window's result tree as a flat list of rows (pure, no UI): usage-kind groups, then
//! folders, then files, then the results. Chains of single-child folders collapse into one row,
//! like the Git changes tree.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

/// What kind of usage a Find Usages result is. The language servers report declarations and
/// writes; a result on an `import`/`use` line is an import. tsserver marks no declarations
/// (`isDefinition` comes only for a search started at one) and counts a declaration as a write.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum UsageKind {
    Declaration,
    Import,
    Write,
    Read,
}

impl UsageKind {
    pub fn title(self) -> &'static str {
        match self {
            UsageKind::Declaration => "Declarations",
            UsageKind::Import => "Imports",
            UsageKind::Write => "Writes",
            UsageKind::Read => "Reads",
        }
    }

    pub fn of(r: &crate::lang::Reference) -> UsageKind {
        if r.is_definition {
            UsageKind::Declaration
        } else if is_import_line(&r.line_text) {
            UsageKind::Import
        } else if r.is_write {
            UsageKind::Write
        } else {
            UsageKind::Read
        }
    }
}

fn is_import_line(line: &str) -> bool {
    let l = line.trim_start();
    l.starts_with("import ")
        || l.starts_with("import{")
        || l.starts_with("use ")
        || l.starts_with("pub use ")
        || (l.starts_with("export ") && l.contains(" from "))
        || l.contains("require(")
}

/// One result line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResultItem {
    /// Stable for the life of the tab; the tree keys rows by it.
    pub id: u64,
    pub path: PathBuf,
    pub line: usize,
    /// Char columns of the match on the line.
    pub column: usize,
    pub end_column: usize,
    pub line_text: String,
    /// `None` in Find in Files tabs.
    pub kind: Option<UsageKind>,
}

/// A row's identity: collapse state and the selection follow it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum NodeKey {
    Group(UsageKind),
    /// A folder by its display path (relative to the project, or from `node_modules` etc.).
    Dir(Option<UsageKind>, String),
    File(Option<UsageKind>, PathBuf),
    Item(u64),
}

#[derive(Clone, Debug, PartialEq)]
pub enum RowKind {
    Group(UsageKind),
    /// The folder chain as drawn (`src/store`).
    Dir(String),
    /// The file name.
    File(String),
    /// Index into the tab's items.
    Item(usize),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub key: NodeKey,
    pub parent: Option<NodeKey>,
    pub depth: usize,
    pub kind: RowKind,
    /// Results under the row (1 for a result).
    pub count: usize,
    pub expanded: bool,
}

impl Row {
    pub fn expandable(&self) -> bool {
        !matches!(self.kind, RowKind::Item(_))
    }
}

#[derive(Default)]
struct Dir {
    dirs: BTreeMap<String, Dir>,
    files: BTreeMap<String, (PathBuf, Vec<usize>)>,
    count: usize,
}

/// The display path of a result file: relative inside the project, short for dependencies.
pub fn display(root: &Path, path: &Path) -> String {
    crate::nav::display_path(root, path)
        .trim_start_matches('/')
        .to_string()
}

/// Sort key of an item: group, display path, position.
pub fn sort_items(root: &Path, items: &mut [ResultItem]) {
    items.sort_by_cached_key(|i| (i.kind, display(root, &i.path), i.line, i.column));
}

/// Builds the visible rows. `items` must be sorted by `sort_items`.
pub fn build(root: &Path, items: &[ResultItem], collapsed: &HashSet<NodeKey>) -> Vec<Row> {
    let mut rows = Vec::new();
    let mut start = 0;
    while start < items.len() {
        let kind = items[start].kind;
        let end = start + items[start..].iter().take_while(|i| i.kind == kind).count();
        let mut tree = Dir::default();
        for (n, item) in items[start..end].iter().enumerate() {
            let rel = display(root, &item.path);
            let mut parts: Vec<&str> = rel.split('/').filter(|p| !p.is_empty()).collect();
            let name = parts.pop().unwrap_or_default().to_string();
            let mut dir = &mut tree;
            dir.count += 1;
            for p in parts {
                dir = dir.dirs.entry(p.to_string()).or_default();
                dir.count += 1;
            }
            dir.files
                .entry(name)
                .or_insert_with(|| (item.path.clone(), Vec::new()))
                .1
                .push(start + n);
        }
        let (depth, parent) = match kind {
            Some(k) => {
                let key = NodeKey::Group(k);
                let expanded = !collapsed.contains(&key);
                rows.push(Row {
                    key: key.clone(),
                    parent: None,
                    depth: 0,
                    kind: RowKind::Group(k),
                    count: end - start,
                    expanded,
                });
                if !expanded {
                    start = end;
                    continue;
                }
                (1, Some(key))
            }
            None => (0, None),
        };
        Emit {
            items,
            kind,
            collapsed,
            rows: &mut rows,
        }
        .dir(&tree, "", depth, parent);
        start = end;
    }
    rows
}

/// The rows of one group's folder tree.
struct Emit<'a> {
    items: &'a [ResultItem],
    kind: Option<UsageKind>,
    collapsed: &'a HashSet<NodeKey>,
    rows: &'a mut Vec<Row>,
}

impl Emit<'_> {
    fn dir(&mut self, dir: &Dir, prefix: &str, depth: usize, parent: Option<NodeKey>) {
        let (items, kind, collapsed) = (self.items, self.kind, self.collapsed);
        for (name, child) in &dir.dirs {
            // Single-child chains (`src` > `store`) become one row (`src/store`).
            let mut label = name.clone();
            let mut node = child;
            while node.files.is_empty() && node.dirs.len() == 1 {
                let (n, c) = node.dirs.iter().next().expect("one child");
                label = format!("{label}/{n}");
                node = c;
            }
            let full = if prefix.is_empty() {
                label.clone()
            } else {
                format!("{prefix}/{label}")
            };
            let key = NodeKey::Dir(kind, full.clone());
            let expanded = !collapsed.contains(&key);
            self.rows.push(Row {
                key: key.clone(),
                parent: parent.clone(),
                depth,
                kind: RowKind::Dir(label),
                count: node.count,
                expanded,
            });
            if expanded {
                self.dir(node, &full, depth + 1, Some(key));
            }
        }
        for (name, (path, idx)) in &dir.files {
            let key = NodeKey::File(kind, path.clone());
            let expanded = !collapsed.contains(&key);
            self.rows.push(Row {
                key: key.clone(),
                parent: parent.clone(),
                depth,
                kind: RowKind::File(name.clone()),
                count: idx.len(),
                expanded,
            });
            if expanded {
                for &i in idx {
                    self.rows.push(Row {
                        key: NodeKey::Item(items[i].id),
                        parent: Some(key.clone()),
                        depth: depth + 1,
                        kind: RowKind::Item(i),
                        count: 1,
                        expanded: false,
                    });
                }
            }
        }
    }
}

/// Every expandable key over `items`, for Collapse All.
pub fn all_keys(root: &Path, items: &[ResultItem]) -> HashSet<NodeKey> {
    let all = build(root, items, &HashSet::new());
    all.into_iter()
        .filter(|r| r.expandable())
        .map(|r| r.key)
        .collect()
}

/// The keys of the rows that contain `item` (group, folders, file), for revealing it.
pub fn ancestors(root: &Path, item: &ResultItem) -> Vec<NodeKey> {
    let mut out = Vec::new();
    if let Some(k) = item.kind {
        out.push(NodeKey::Group(k));
    }
    // Every prefix: a collapsed chain row is keyed by its full prefix, and a prefix that is no
    // row key costs nothing.
    let rel = display(root, &item.path);
    let parts: Vec<&str> = rel.split('/').filter(|p| !p.is_empty()).collect();
    for n in 1..parts.len() {
        out.push(NodeKey::Dir(item.kind, parts[..n].join("/")));
    }
    out.push(NodeKey::File(item.kind, item.path.clone()));
    out
}

/// "1 result", "10 results".
pub fn results(n: usize) -> String {
    crate::badge::plural(n, "result", "results")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: u64, path: &str, line: usize, kind: Option<UsageKind>) -> ResultItem {
        ResultItem {
            id,
            path: PathBuf::from(path),
            line,
            column: 0,
            end_column: 1,
            line_text: String::new(),
            kind,
        }
    }

    #[test]
    fn groups_folders_chains_and_counts() {
        let root = Path::new("/p");
        let mut items = vec![
            item(0, "/p/src/store/a.ts", 3, Some(UsageKind::Read)),
            item(1, "/p/src/store/a.ts", 1, Some(UsageKind::Read)),
            item(2, "/p/src/b.ts", 0, Some(UsageKind::Read)),
            item(3, "/p/lib/x/y/c.ts", 0, Some(UsageKind::Import)),
            item(4, "/p/top.ts", 0, Some(UsageKind::Declaration)),
        ];
        sort_items(root, &mut items);
        let rows = build(root, &items, &HashSet::new());
        let text: Vec<String> = rows
            .iter()
            .map(|r| {
                let label = match &r.kind {
                    RowKind::Group(k) => k.title().to_string(),
                    RowKind::Dir(d) => d.clone(),
                    RowKind::File(f) => f.clone(),
                    RowKind::Item(i) => format!(":{}", items[*i].line + 1),
                };
                format!("{}{label} {}", "  ".repeat(r.depth), r.count)
            })
            .collect();
        assert_eq!(
            text,
            [
                "Declarations 1",
                "  top.ts 1",
                "    :1 1",
                "Imports 1",
                "  lib/x/y 1",
                "    c.ts 1",
                "      :1 1",
                "Reads 3",
                "  src 3",
                "    store 2",
                "      a.ts 2",
                "        :2 1",
                "        :4 1",
                "    b.ts 1",
                "      :1 1",
            ]
        );
        // Collapsing a folder hides its rows; the chain row is keyed by its full prefix.
        let collapsed: HashSet<NodeKey> = [
            NodeKey::Dir(Some(UsageKind::Read), "src/store".into()),
            NodeKey::Group(UsageKind::Import),
        ]
        .into();
        let rows = build(root, &items, &collapsed);
        assert_eq!(rows.len(), 15 - 3 - 3);
        assert!(ancestors(root, &items[1])
            .contains(&NodeKey::Dir(Some(UsageKind::Import), "lib/x/y".into())));
    }

    #[test]
    fn text_results_have_no_groups() {
        let root = Path::new("/p");
        let items = vec![item(0, "/p/a.ts", 0, None), item(1, "/p/d/b.ts", 0, None)];
        let rows = build(root, &items, &HashSet::new());
        assert_eq!(
            rows.iter().map(|r| r.depth).collect::<Vec<_>>(),
            [0, 1, 2, 0, 1]
        );
        assert!(matches!(&rows[0].kind, RowKind::Dir(d) if d == "d"));
    }

    #[test]
    fn import_lines() {
        assert!(is_import_line("import { signal } from \"x\";"));
        assert!(is_import_line("  use crate::a::b;"));
        assert!(is_import_line("export { a } from './a';"));
        assert!(!is_import_line("const a = imported;"));
    }
}
