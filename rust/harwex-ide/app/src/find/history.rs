//! Find in Files history per project: recent queries, file masks and directories, newest
//! first. App storage key `find_history`, one entry per line: `root \t kind \t value`, where
//! kind is `q`, `m` or `d` and the value escapes `\`, tab and newline (a multiline query).

use std::collections::HashMap;
use std::path::PathBuf;

use crate::state::AppState;

pub const STORAGE_FIND_HISTORY: &str = "find_history";
/// Entries kept per list.
const MAX_ENTRIES: usize = 20;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FindHistory {
    pub queries: Vec<String>,
    pub masks: Vec<String>,
    pub dirs: Vec<String>,
}

impl FindHistory {
    /// Moves `value` to the front of `list`.
    pub fn push(list: &mut Vec<String>, value: &str) {
        if value.is_empty() {
            return;
        }
        list.retain(|v| v != value);
        list.insert(0, value.to_string());
        list.truncate(MAX_ENTRIES);
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\t', "\\t").replace('\n', "\\n")
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

pub fn parse(text: &str) -> HashMap<PathBuf, FindHistory> {
    let mut map: HashMap<PathBuf, FindHistory> = HashMap::new();
    for line in text.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(root), Some(kind), Some(value)) = (parts.next(), parts.next(), parts.next()) else { continue };
        if root.is_empty() || value.is_empty() {
            continue;
        }
        let h = map.entry(PathBuf::from(root)).or_default();
        let list = match kind {
            "q" => &mut h.queries,
            "m" => &mut h.masks,
            "d" => &mut h.dirs,
            _ => continue,
        };
        if list.len() < MAX_ENTRIES {
            list.push(unescape(value));
        }
    }
    map
}

pub fn format(map: &HashMap<PathBuf, FindHistory>) -> String {
    let mut roots: Vec<&PathBuf> = map.keys().collect();
    roots.sort();
    let mut lines = Vec::new();
    for root in roots {
        let h = &map[root];
        for (kind, list) in [("q", &h.queries), ("m", &h.masks), ("d", &h.dirs)] {
            lines.extend(list.iter().map(|v| format!("{}\t{kind}\t{}", root.display(), escape(v))));
        }
    }
    lines.join("\n")
}

pub fn load_storage(state: &mut AppState, storage: &dyn eframe::Storage) {
    if let Some(text) = storage.get_string(STORAGE_FIND_HISTORY) {
        state.find_history = parse(&text);
    }
}

pub fn save_storage(state: &AppState, storage: &mut dyn eframe::Storage) {
    storage.set_string(STORAGE_FIND_HISTORY, format(&state.find_history));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_keeps_order_and_escapes() {
        let mut h = FindHistory::default();
        FindHistory::push(&mut h.queries, "a");
        FindHistory::push(&mut h.queries, "two\nlines\twith \\ tab");
        FindHistory::push(&mut h.queries, "a");
        FindHistory::push(&mut h.masks, "*.ts");
        FindHistory::push(&mut h.dirs, "/p/src");
        assert_eq!(h.queries, ["a", "two\nlines\twith \\ tab"]);
        let map: HashMap<PathBuf, FindHistory> = [(PathBuf::from("/p"), h)].into_iter().collect();
        assert_eq!(parse(&format(&map)), map);
        assert!(parse("garbage\n\tq\tx\n/p\tz\tx").values().all(|h| h.queries.is_empty()));
    }
}
