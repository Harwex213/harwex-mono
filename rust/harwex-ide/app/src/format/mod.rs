//! Code formatting: oxfmt before a save that formats (`save::Reason::formats`) and
//! "Reformat File with oxfmt" (⌥⌘L).
//!
//! The buffer, not the disk, goes to the formatter on a worker (`oxfmt.rs`). The worker also
//! computes a line diff, so the UI thread only applies the changed blocks: one undo step, the
//! carets and the scroll stay on their text where it did not change.
//!
//! Only `save` starts a format before a save (`start_save`) and hands the document back to
//! `save::write_now` when the format lands. A failure (no oxfmt, a syntax error, the time limit)
//! saves the text unformatted and leaves one status bar line.

pub mod oxfmt;

use std::collections::HashMap;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use ide_editor::{EditKind, Selection};

use crate::jobs::Cancel;
use crate::notifications::Level;
use crate::save::{Reason, Target};
use crate::state::AppState;
use crate::tabs::TabId;
use oxfmt::FormatError;

/// A format in flight for one document.
struct Flight {
    cancel: Cancel,
    /// The save that waits for the format: its reason and whether the tab closes after it.
    save: Option<(Reason, bool)>,
}

/// Per-workspace formatter state.
#[derive(Default)]
pub struct FormatState {
    flights: HashMap<Target, Flight>,
    /// "oxfmt is not installed" was said for an on-save format of this project. A manual
    /// reformat says it again.
    told_missing: bool,
    /// Formats that changed the buffer (tests).
    pub applied: usize,
}

impl FormatState {
    pub fn in_flight(&self, id: TabId) -> bool {
        self.flights.contains_key(&Target::Tab(id))
    }

    /// A format of any document runs (a project close waits for the saves behind them).
    pub fn any_in_flight(&self) -> bool {
        !self.flights.is_empty()
    }

    /// Stops every format (the project closes or its settings change).
    pub fn cancel_all(&mut self) {
        for (_, f) in self.flights.drain() {
            f.cancel.cancel_quietly();
        }
        self.told_missing = false;
    }
}

/// A format of `target` is running.
pub(crate) fn in_flight_for(state: &AppState, target: &Target) -> bool {
    state.ws.format.flights.contains_key(target)
}

/// A save of `target` while a manual reformat of it runs: the save waits for the format.
/// Returns false when no format runs.
pub(crate) fn queue_save(state: &mut AppState, target: &Target, reason: Reason, then_close: bool) -> bool {
    let Some(waiting) = state.ws.format.flights.get(target).map(|f| f.save.is_some()) else { return false };
    if !waiting {
        if let Some(s) = crate::save::slot(state, target).filter(|s| !s.read_only) {
            *s.saving = true;
            if let Some(f) = state.ws.format.flights.get_mut(target) {
                f.save = Some((reason, then_close));
            }
        }
    }
    true
}

/// Formats `target`, then saves it (`save::write_now`). Called by `save` only.
pub(crate) fn start_save(state: &mut AppState, target: Target, reason: Reason, then_close: bool) {
    let Some(s) = crate::save::slot(state, &target) else { return };
    *s.saving = true;
    start(state, target, Some((reason, then_close)));
}

/// "Reformat File with oxfmt" (⌥⌘L) on the active editor. It does not save.
pub fn reformat_active(state: &mut AppState) {
    let Some(id) = state.ws.tabs.active else { return };
    let Some(e) = state.ws.tabs.editor_mut(id) else { return };
    if e.read_only || state.ws.format.flights.contains_key(&Target::Tab(id)) {
        return;
    }
    // A manual action always reports a missing install.
    state.ws.format.told_missing = false;
    start(state, Target::Tab(id), None);
}

/// What the worker hands back: the formatter's changes as blocks of whole lines.
pub struct Plan {
    hunks: Vec<Hunk>,
}

/// One changed block. Char indices: `old` in the text before, `new_start` in the text after.
struct Hunk {
    old: Range<usize>,
    old_text: String,
    new_start: usize,
    new_text: String,
    old_lines: Range<usize>,
    new_lines: Range<usize>,
}

fn start(state: &mut AppState, target: Target, save: Option<(Reason, bool)>) {
    let timeout = state.ws.langs.config.oxfmt.timeout;
    let Some(s) = crate::save::slot(state, &target) else { return };
    // A rope clone is cheap; the worker turns it into a string.
    let rope = s.doc.rope().clone();
    let version = s.doc.version();
    let path = s.path;
    let name = path.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let key = target.clone();
    let cancel = state.jobs.spawn_cancellable(
        format!("oxfmt {name}"),
        move || {
            let text = rope.to_string();
            let install = path.parent().and_then(oxfmt::find).ok_or(FormatError::NotInstalled)?;
            let cancel = crate::jobs::current_cancel();
            let formatted = oxfmt::format(&install, &path, &text, timeout, &cancel)?;
            Ok::<_, FormatError>((formatted != text).then(|| plan(&text, &formatted)))
        },
        move |state, res| finish(state, key, version, res),
    );
    state.ws.format.flights.insert(target, Flight { cancel, save });
}

fn finish(state: &mut AppState, target: Target, version: u64, res: Result<Option<Plan>, FormatError>) {
    let Some(flight) = state.ws.format.flights.remove(&target) else { return };
    let Some(s) = crate::save::slot(state, &target) else { return };
    if flight.save.is_some() {
        *s.saving = false;
    }
    let current = s.doc.version() == version;
    let note = match res {
        Ok(Some(plan)) if current => {
            match &target {
                Target::Tab(id) => {
                    if let Some(e) = state.ws.tabs.editor_mut(*id) {
                        apply(e, &plan);
                    }
                }
                Target::DiffHidden { .. } => {
                    if let Some(s) = crate::save::slot(state, &target) {
                        apply_doc(s.doc, &plan);
                    }
                }
            }
            state.ws.format.applied += 1;
            None
        }
        Ok(Some(_)) => Some(("oxfmt: the file changed while it was formatted; nothing applied".to_string(), String::new())),
        Ok(None) => None,
        // The status bar's job list already says "Cancelled".
        Err(FormatError::Cancelled) => None,
        Err(FormatError::NotInstalled) if std::mem::replace(&mut state.ws.format.told_missing, true) => None,
        Err(err) => Some((err.title(), err.body())),
    };
    if let Some((title, body)) = note {
        let title = if flight.save.is_some() { format!("{title}. Saved unformatted.") } else { title };
        state.notifications.log_only(Level::Warning, title, body);
    }
    if let Some((reason, then_close)) = flight.save {
        crate::save::write_now(state, target, reason, then_close);
    }
}

/// Splits `text` into lines that keep their `\n`.
fn lines(text: &str) -> Vec<&str> {
    text.split_inclusive('\n').collect()
}

/// The changed blocks between `old` and `new`, as whole lines. Runs on the worker.
pub fn plan(old: &str, new: &str) -> Plan {
    let a = lines(old);
    let b = lines(new);
    let deadline = Some(Instant::now() + Duration::from_millis(1500));
    let ops = similar::capture_diff_slices_deadline(similar::Algorithm::Myers, &a, &b, deadline);
    let mut blocks: Vec<(Range<usize>, Range<usize>)> = Vec::new();
    for op in ops {
        let (tag, o, n) = op.as_tag_tuple();
        if tag == similar::DiffTag::Equal {
            continue;
        }
        match blocks.last_mut() {
            Some(last) if last.0.end == o.start && last.1.end == n.start => {
                last.0.end = o.end;
                last.1.end = n.end;
            }
            _ => blocks.push((o, n)),
        }
    }
    let starts = |ls: &[&str]| {
        let mut out = Vec::with_capacity(ls.len() + 1);
        let mut at = 0;
        out.push(0);
        for l in ls {
            at += l.chars().count();
            out.push(at);
        }
        out
    };
    let (sa, sb) = (starts(&a), starts(&b));
    let hunks = blocks
        .into_iter()
        .map(|(o, n)| Hunk {
            old: sa[o.start]..sa[o.end],
            old_text: a[o.clone()].concat(),
            new_start: sb[n.start],
            new_text: b[n.clone()].concat(),
            old_lines: o,
            new_lines: n,
        })
        .collect();
    Plan { hunks }
}

impl Plan {
    /// Maps a char index of the old text to the new text. Outside the changed blocks the index
    /// keeps its line offset and column. Inside a block it keeps its place among the
    /// non-whitespace chars, which a formatter mostly keeps.
    pub fn map_char(&self, idx: usize) -> usize {
        let mut delta: isize = 0;
        for h in &self.hunks {
            if idx < h.old.start {
                break;
            }
            if idx < h.old.end {
                return h.new_start + map_in_block(&h.old_text, idx - h.old.start, &h.new_text);
            }
            delta = (h.new_start + h.new_text.chars().count()) as isize - h.old.end as isize;
        }
        (idx as isize + delta).max(0) as usize
    }

    /// Maps a line of the old text to the new text, for the scroll position.
    pub fn map_line(&self, line: usize) -> (usize, bool) {
        let mut delta: isize = 0;
        for h in &self.hunks {
            if line < h.old_lines.start {
                break;
            }
            if line < h.old_lines.end {
                let off = (line - h.old_lines.start).min(h.new_lines.len().saturating_sub(1));
                return (h.new_lines.start + off, false);
            }
            delta = h.new_lines.end as isize - h.old_lines.end as isize;
        }
        ((line as isize + delta).max(0) as usize, true)
    }

    /// The edits bottom-up, so each range still refers to the text before them.
    fn edits(&self) -> Vec<(Range<usize>, String)> {
        self.hunks.iter().rev().map(|h| (h.old.clone(), h.new_text.clone())).collect()
    }
}

/// The index in `new` that holds the place of index `k` in `old`: after the same number of
/// non-whitespace chars. A caret right before a token stays before that token.
fn map_in_block(old: &str, k: usize, new: &str) -> usize {
    let mut chars = old.chars();
    let seen = chars.by_ref().take(k).filter(|c| !c.is_whitespace()).count();
    let before_token = chars.next().is_some_and(|c| !c.is_whitespace());
    let mut idx = 0;
    let mut count = 0;
    let mut it = new.chars().peekable();
    while count < seen {
        match it.next() {
            Some(c) => {
                idx += 1;
                if !c.is_whitespace() {
                    count += 1;
                }
            }
            None => return idx,
        }
    }
    if before_token {
        while it.next_if(|c| c.is_whitespace()).is_some() {
            idx += 1;
        }
    }
    idx
}

/// Applies the plan as one undo step and moves the carets and the scroll with the text.
fn apply(e: &mut crate::tabs::EditorTab, plan: &Plan) {
    let before = e.view.carets().clone();
    let mut after = before.clone();
    after.map(|_, s| Selection::new(plan.map_char(s.anchor), plan.map_char(s.head)));
    let view = e.view.view_state(&e.doc);
    e.doc.seal_undo_group();
    e.doc.transact_carets(plan.edits(), &before, &after, EditKind::Other);
    e.doc.seal_undo_group();
    e.view.set_carets(after);
    if let Some(mut v) = view {
        let (line, same) = plan.map_line(v.line);
        v.line = line;
        if !same {
            v.column = 0;
        }
        e.view.restore_view(v);
    }
    e.last_edit = Instant::now();
}

/// Applies the plan to a document without a view of its own (a diff's hidden document): one
/// undo step; the diff's view clamps its carets.
fn apply_doc(doc: &mut ide_editor::Document, plan: &Plan) {
    let sel = Selection::new(0, 0);
    doc.seal_undo_group();
    doc.transact(plan.edits(), sel, sel, EditKind::Other);
    doc.seal_undo_group();
}

/// The folder whose oxfmt the Settings page shows: the active file's, else the project root.
pub fn probe_dir(state: &AppState) -> Option<PathBuf> {
    let root = state.ws.project.as_ref()?.root.clone();
    let active = state.ws.tabs.active_editor().map(|e| e.path.clone()).filter(|p| p.starts_with(&root));
    Some(active.and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or(root))
}

/// Writes `[format.oxfmt]` into `<root>/.harwex/ide.toml`; the rest of the file keeps its text
/// and comments. `extensions` is left out while it is the default. Blocking: call it on a
/// worker.
pub fn write_config(root: &Path, on_save: bool, extensions: &[String]) -> Result<(), String> {
    use crate::lang::config::{CONFIG_PATH, OXFMT_DEFAULT_EXTENSIONS};
    let path = root.join(CONFIG_PATH);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|e| format!("{CONFIG_PATH} is not valid TOML: {e}"))?;
    let implicit = || {
        let mut t = toml_edit::Table::new();
        t.set_implicit(true);
        toml_edit::Item::Table(t)
    };
    let format = doc.entry("format").or_insert_with(implicit);
    let format = format.as_table_like_mut().ok_or_else(|| format!("{CONFIG_PATH}: `format` must be a table"))?;
    let ox = format.entry("oxfmt").or_insert(toml_edit::table());
    let ox = ox.as_table_like_mut().ok_or_else(|| format!("{CONFIG_PATH}: `format.oxfmt` must be a table"))?;
    ox.insert("on_save", toml_edit::value(on_save));
    if extensions.iter().map(String::as_str).eq(OXFMT_DEFAULT_EXTENSIONS) {
        ox.remove("extensions");
    } else {
        ox.insert("extensions", toml_edit::value(extensions.iter().map(String::as_str).collect::<toml_edit::Array>()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(&path, doc.to_string()).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply_text(old: &str, p: &Plan) -> String {
        let mut chars: Vec<char> = old.chars().collect();
        for (r, t) in p.edits() {
            chars.splice(r, t.chars());
        }
        chars.into_iter().collect()
    }

    #[test]
    fn plan_rebuilds_the_new_text_and_keeps_unchanged_lines() {
        let old = "const a = {b:1};\nkeep();\nfunction f( x ){return x}\nend()";
        let new = "const a = { b: 1 };\nkeep();\nfunction f(x) {\n  return x;\n}\nend();\n";
        let p = plan(old, new);
        assert_eq!(apply_text(old, &p), new);
        // "keep();" is unchanged: line 1, column 3 stays line 1, column 3.
        let k = old.find("keep").unwrap() + 3;
        assert_eq!(&new[..p.map_char(k)], &new[..new.find("keep").unwrap() + 3]);
        assert_eq!(p.map_line(1), (1, true));
        // Before "return" in a changed block: still before "return".
        let r = old.find("return").unwrap();
        assert!(new[p.map_char(r)..].starts_with("return"));
        // After "x" at the end of "f( x": after the same "x".
        let x = old.find("( x").unwrap() + 3;
        assert!(new[..p.map_char(x)].ends_with("f(x"), "{:?}", &new[..p.map_char(x)]);
    }

    #[test]
    fn write_config_keeps_comments_and_drops_default_extensions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".harwex")).unwrap();
        std::fs::write(dir.path().join(".harwex/ide.toml"), "# mine\nlanguages = [\"ts\"]\n").unwrap();
        write_config(dir.path(), true, &["ts".into(), "vue".into()]).unwrap();
        let text = std::fs::read_to_string(dir.path().join(".harwex/ide.toml")).unwrap();
        assert!(text.starts_with("# mine\n") && text.contains("[format.oxfmt]\non_save = true\nextensions = [\"ts\", \"vue\"]"), "{text}");
        let defaults: Vec<String> = crate::lang::config::OXFMT_DEFAULT_EXTENSIONS.iter().map(|s| s.to_string()).collect();
        write_config(dir.path(), false, &defaults).unwrap();
        let c = crate::lang::IdeConfig::load(dir.path());
        assert!(c.warnings.is_empty() && !c.oxfmt.on_save && c.oxfmt.extensions == defaults, "{c:?}");
        assert!(!std::fs::read_to_string(dir.path().join(".harwex/ide.toml")).unwrap().contains("extensions"));
    }
}
