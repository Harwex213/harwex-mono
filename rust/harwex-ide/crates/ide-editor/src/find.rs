//! Find and Replace state of one editor tab: the query, the toggles, the matches and the current
//! match. The find bar (`find_bar.rs`) draws it; `EditorState` exposes the actions. Search runs
//! on a worker for big files and updates incrementally after edits.

use std::ops::Range;
use std::sync::mpsc::{self, Receiver, TryRecvError};

use crate::document::{Document, EditKind, Selection, TextChange};
use crate::search::{apply_filter, FindOptions, Matcher, SearchFilter, Template};

/// Files up to this size are searched on the UI thread; bigger ones on a worker.
const SYNC_BYTES: usize = 256 * 1024;
/// More matches than this are not collected. The counter then shows `N/100000+`.
pub const MAX_MATCHES: usize = 100_000;
/// An edit that dirties more text than this triggers a full search instead of a local one.
const INCREMENTAL_MAX_CHARS: usize = 64 * 1024;
/// More raw changes than this since the last search (Replace All, a big undo) mean a full
/// search: mapping every match through each change would cost more.
const INCREMENTAL_MAX_CHANGES: usize = 64;

/// One occurrence, in char indices. Excluded ones are skipped by Replace and the counter.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Match {
    pub range: Range<usize>,
    pub excluded: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Nav {
    /// The first match at or after the char index (wraps).
    From(usize),
    /// The match after the current one, or the first at or after the index.
    Next(usize),
    /// The match before the current one, or the last before the index.
    Prev(usize),
}

struct Pending {
    key: u64,
    version: u64,
    rx: Receiver<(Vec<Range<usize>>, bool)>,
}

/// Find bar state, one per tab (inside `EditorState`).
#[derive(Default)]
pub struct FindState {
    pub(crate) open: bool,
    pub(crate) replace_open: bool,
    /// The replacement field accepts line breaks.
    pub(crate) replace_multiline: bool,
    query: String,
    replacement: String,
    opts: FindOptions,
    preserve_case: bool,
    in_selection: bool,
    /// The selection the bar opened with. In Selection searches inside it. Follows edits.
    scope: Option<Range<usize>>,
    /// Where incremental search starts: the caret when the bar opened. Follows edits.
    origin: usize,
    /// Bumps whenever the query, an option or the scope changes.
    key: u64,
    /// The key and document version the matches belong to.
    matches_key: u64,
    version: u64,
    matcher: Option<Matcher>,
    error: Option<String>,
    matches: Vec<Match>,
    capped: bool,
    pending: Option<Pending>,
    /// Version up to which `scope`, `origin` and `current` follow the edits.
    tracked: u64,
    current: Option<Range<usize>>,
    nav: Option<Nav>,
    /// Output for the view: the match to reveal (and to select, unless In Selection is on).
    pub(crate) reveal: Option<Range<usize>>,
    /// Output for the view: focus the query field and select its text.
    pub(crate) focus_query: bool,
    /// Output for the view: fill the query from the last search of this session.
    pub(crate) seed: bool,
    /// A Replace or Replace All just ran with this replacement (for the history).
    pub(crate) used_replacement: Option<String>,
    /// Bumps whenever the match list changes, for the view's caches.
    pub(crate) gen: u64,
    /// The bar field that had the keyboard last. A click on a bar button gives it back.
    pub(crate) last_field: Option<egui::Id>,
    /// A popup item of the bar was clicked this frame.
    pub(crate) popup_clicked: bool,
}

impl FindState {
    pub fn is_open(&self) -> bool {
        self.open
    }

    pub fn is_replace_open(&self) -> bool {
        self.open && self.replace_open
    }

    pub fn query(&self) -> &str {
        &self.query
    }

    pub fn replacement(&self) -> &str {
        &self.replacement
    }

    pub fn options(&self) -> &FindOptions {
        &self.opts
    }

    pub fn preserve_case(&self) -> bool {
        self.preserve_case
    }

    pub fn in_selection(&self) -> bool {
        self.in_selection
    }

    /// The regex error of the query, if any.
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    /// Every match, sorted, excluded ones included.
    pub fn matches(&self) -> &[Match] {
        &self.matches
    }

    /// True while a worker searches.
    pub fn is_searching(&self) -> bool {
        self.pending.is_some()
    }

    /// The match limit was hit, so the count is a lower bound.
    pub fn is_capped(&self) -> bool {
        self.capped
    }

    /// (1-based index of the current match, number of matches), both without excluded ones.
    pub fn counter(&self) -> (Option<usize>, usize) {
        let mut index = None;
        let mut count = 0;
        for m in &self.matches {
            if m.excluded {
                continue;
            }
            count += 1;
            if Some(&m.range) == self.current.as_ref() {
                index = Some(count);
            }
        }
        (index, count)
    }

    pub fn current(&self) -> Option<Range<usize>> {
        self.current.clone()
    }

    /// Without multiline mode the query ends at its first line break.
    pub fn set_query(&mut self, query: &str) {
        let query = if self.opts.multiline { query } else { query.split('\n').next().unwrap_or("") };
        if self.query != query {
            self.query = query.to_string();
            self.changed_query();
        }
    }

    pub fn set_replacement(&mut self, text: &str) {
        self.replacement = text.to_string();
    }

    pub fn set_options(&mut self, opts: FindOptions) {
        if self.opts != opts {
            // Leaving multiline mode cuts the query at its first line break, like IDEA.
            if !opts.multiline {
                if let Some(i) = self.query.find('\n') {
                    self.query.truncate(i);
                }
            }
            self.opts = opts;
            self.changed_query();
        }
    }

    pub fn set_filter(&mut self, filter: SearchFilter) {
        let opts = FindOptions { filter, ..self.opts.clone() };
        self.set_options(opts);
    }

    pub fn set_preserve_case(&mut self, on: bool) {
        self.preserve_case = on;
    }

    /// Limits the search to the selection the bar opened with. Without one it stays off.
    pub fn set_in_selection(&mut self, on: bool) {
        let on = on && self.scope.as_ref().is_some_and(|s| !s.is_empty());
        if self.in_selection != on {
            self.in_selection = on;
            self.changed_query();
        }
    }

    /// The range In Selection searches in.
    pub fn scope(&self) -> Option<Range<usize>> {
        self.scope.clone()
    }

    fn changed_query(&mut self) {
        self.key += 1;
        self.current = None;
        match Matcher::new(&self.query, &self.opts) {
            Ok(m) => {
                self.matcher = m;
                self.error = None;
            }
            Err(e) => {
                self.matcher = None;
                self.error = Some(e);
            }
        }
        self.nav = Some(Nav::From(self.origin));
    }

    /// Opens the bar. A one-line selection fills the query; a selection over several lines
    /// becomes the In Selection scope instead, like IDEA.
    pub(crate) fn open(&mut self, doc: &Document, sel: Selection, replace: bool) {
        let was_open = self.open;
        self.open = true;
        self.replace_open = replace || (was_open && self.replace_open);
        self.focus_query = true;
        self.origin = sel.start();
        self.tracked = doc.version();
        let text = doc.slice(sel.range());
        if !sel.is_empty() && !text.contains('\n') {
            self.scope = None;
            self.in_selection = false;
            self.set_query(&text);
        } else if !sel.is_empty() {
            self.scope = Some(sel.range());
            self.in_selection = true;
            self.changed_query();
        } else {
            self.scope = None;
            if self.in_selection {
                self.in_selection = false;
                self.changed_query();
            }
            if self.query.is_empty() {
                self.seed = true;
            }
        }
        if self.nav.is_none() {
            self.nav = Some(Nav::From(self.origin));
        }
    }

    pub(crate) fn close(&mut self) {
        self.open = false;
        self.focus_query = false;
        self.pending = None;
        self.nav = None;
        self.matches = Vec::new();
        self.capped = false;
        self.current = None;
        // Forces a fresh search when the bar opens again.
        self.matches_key = u64::MAX;
    }

    /// Fills query and options from the last search of the session (another tab).
    pub(crate) fn seed_from(&mut self, query: &str, opts: &FindOptions) {
        self.seed = false;
        if self.query.is_empty() && !query.is_empty() {
            self.query = query.to_string();
            self.opts = opts.clone();
            self.changed_query();
        }
    }

    pub(crate) fn go_next(&mut self, sel: Selection) {
        self.nav = Some(Nav::Next(sel.end()));
    }

    pub(crate) fn go_prev(&mut self, sel: Selection) {
        self.nav = Some(Nav::Prev(sel.start()));
    }

    /// The current match no longer counts when the user moved the selection off it.
    pub(crate) fn sync_selection(&mut self, sel: Selection) {
        if !self.in_selection && self.current.as_ref() != Some(&sel.range()) {
            self.current = None;
        }
    }

    fn active(&self) -> bool {
        self.open || self.nav.is_some()
    }

    /// True when the matches belong to the current query and text.
    pub fn is_fresh(&self, doc: &Document) -> bool {
        self.pending.is_none() && self.matches_key == self.key && self.version == doc.version()
    }

    /// Brings the matches up to date with the query and the text, then resolves a pending
    /// navigation. Cheap when nothing changed. `block` waits for a worker (tests, Replace All).
    pub fn refresh(&mut self, doc: &mut Document, block: bool) {
        if !self.active() {
            return;
        }
        self.track_edits(doc);
        if let Some(p) = self.pending.take() {
            let got = if block {
                p.rx.recv().ok()
            } else {
                match p.rx.try_recv() {
                    Ok(r) => Some(r),
                    Err(TryRecvError::Empty) => {
                        if p.key == self.key {
                            self.pending = Some(p);
                            return;
                        }
                        None
                    }
                    Err(TryRecvError::Disconnected) => None,
                }
            };
            if let Some((found, capped)) = got {
                if p.key == self.key {
                    self.install(found, capped, p.key, p.version);
                }
            }
        }
        if self.matches_key != self.key {
            self.full_search(doc, block, MAX_MATCHES);
            if self.pending.is_some() {
                return;
            }
        }
        if self.version != doc.version() && !self.incremental(doc) {
            self.full_search(doc, block, MAX_MATCHES);
            if self.pending.is_some() {
                return;
            }
        }
        self.resolve_nav();
    }

    fn install(&mut self, found: Vec<Range<usize>>, capped: bool, key: u64, version: u64) {
        // A re-search of the same query and text keeps the exclusions.
        let keep = self.matches_key == key && self.version == version;
        let old = std::mem::take(&mut self.matches);
        self.matches = found.into_iter().map(|range| Match { range, excluded: false }).collect();
        if keep {
            for m in old.iter().filter(|m| m.excluded) {
                if let Ok(i) = self.matches.binary_search_by_key(&m.range.start, |n| n.range.start) {
                    if self.matches[i].range == m.range {
                        self.matches[i].excluded = true;
                    }
                }
            }
        }
        self.capped = capped;
        self.gen += 1;
        self.matches_key = key;
        self.version = version;
    }

    fn search_region(&self, doc: &Document) -> Range<usize> {
        match (&self.scope, self.in_selection) {
            (Some(s), true) => s.start.min(doc.len_chars())..s.end.min(doc.len_chars()),
            _ => 0..doc.len_chars(),
        }
    }

    fn full_search(&mut self, doc: &mut Document, block: bool, limit: usize) {
        self.pending = None;
        let Some(matcher) = self.matcher.clone() else {
            self.install(Vec::new(), false, self.key, doc.version());
            return;
        };
        let region = self.search_region(doc);
        let syntax = if matcher.filter == SearchFilter::Anywhere { None } else { doc.syntax_snapshot() };
        if block || doc.rope().len_bytes() <= SYNC_BYTES {
            let text = doc.slice(region.clone());
            let (mut found, capped) = matcher.find(&text, region.start, limit);
            apply_filter(doc.rope(), syntax.as_ref(), matcher.filter, &mut found);
            self.install(found, capped, self.key, doc.version());
            return;
        }
        // Rope and tree clones share their storage, so the snapshot is O(1).
        let rope = doc.rope().clone();
        let (tx, rx) = mpsc::channel();
        let spawned = std::thread::Builder::new().name("ide-editor-find".into()).spawn(move || {
            let text: String = rope.slice(region.clone()).into();
            let (mut found, capped) = matcher.find(&text, region.start, limit);
            drop(text);
            apply_filter(&rope, syntax.as_ref(), matcher.filter, &mut found);
            let _ = tx.send((found, capped));
        });
        match spawned {
            Ok(_) => self.pending = Some(Pending { key: self.key, version: doc.version(), rx }),
            Err(_) => self.full_search(doc, true, limit),
        }
    }

    /// Updates the matches after edits by searching only the changed lines (plus the lines a
    /// multiline match can reach). Returns false when a full search is needed instead.
    fn incremental(&mut self, doc: &Document) -> bool {
        let Some(changes) = doc.changes_since(self.version) else { return false };
        let Some(matcher) = self.matcher.clone() else {
            self.install(Vec::new(), false, self.key, doc.version());
            return true;
        };
        // An edit can turn the rest of the file into a comment or a string.
        if matcher.filter != SearchFilter::Anywhere || changes.len() > INCREMENTAL_MAX_CHANGES {
            return false;
        }
        let Some(span) = matcher.span_lines() else { return false };
        let mut dirty: Option<Range<usize>> = None;
        for c in &changes {
            let old_end = c.start + c.removed;
            let delta = c.inserted as isize - c.removed as isize;
            // A match that touches the change may now be longer, shorter or no word anymore.
            self.matches.retain(|m| m.range.end < c.start || m.range.start > old_end);
            let first = self.matches.partition_point(|m| m.range.start < c.start);
            for m in &mut self.matches[first..] {
                m.range.start = (m.range.start as isize + delta) as usize;
                m.range.end = (m.range.end as isize + delta) as usize;
            }
            let new = c.start..c.start + c.inserted;
            dirty = Some(match dirty {
                Some(d) => c.map(d.start, false).min(new.start)..c.map(d.end, true).max(new.end),
                None => new,
            });
        }
        let Some(d) = dirty else {
            self.version = doc.version();
            return true;
        };
        let last_line = doc.line_count().saturating_sub(1);
        let line_of = |i: usize| doc.char_to_position(i).line;
        let mut rs = doc.line_start(line_of(d.start).saturating_sub(span));
        let mut re = doc.line_end((line_of(d.end) + span).min(last_line));
        // A multiline match that reaches into the region is searched again as a whole.
        loop {
            let first = self.matches.partition_point(|m| m.range.end < rs);
            let reach: Vec<Range<usize>> =
                self.matches[first..].iter().take_while(|m| m.range.start <= re).map(|m| m.range.clone()).collect();
            let (nrs, nre) = reach
                .iter()
                .fold((rs, re), |(a, b), r| (a.min(doc.line_start(line_of(r.start))), b.max(doc.line_end(line_of(r.end)))));
            if (nrs, nre) == (rs, re) {
                break;
            }
            rs = nrs;
            re = nre;
        }
        let scope = self.search_region(doc);
        let rs = rs.max(scope.start);
        let re = re.min(scope.end);
        if re.saturating_sub(rs) > INCREMENTAL_MAX_CHARS {
            return false;
        }
        let a = self.matches.partition_point(|m| m.range.end <= rs);
        let b = self.matches.partition_point(|m| m.range.start < re.max(rs));
        let found = if rs < re { matcher.find(&doc.slice(rs..re), rs, MAX_MATCHES).0 } else { Vec::new() };
        let found: Vec<Match> = found.into_iter().map(|range| Match { range, excluded: false }).collect();
        self.matches.splice(a..b.max(a), found);
        if self.matches.len() > MAX_MATCHES {
            self.matches.truncate(MAX_MATCHES);
            self.capped = true;
        }
        self.version = doc.version();
        self.gen += 1;
        true
    }

    /// Moves `scope`, `origin` and `current` along with the edits since the last call.
    fn track_edits(&mut self, doc: &Document) {
        if self.tracked == doc.version() {
            return;
        }
        let len = doc.len_chars();
        match doc.changes_since(self.tracked) {
            Some(changes) => {
                for c in &changes {
                    self.origin = c.map(self.origin, false);
                    if let Some(s) = &mut self.scope {
                        *s = c.map(s.start, false)..c.map(s.end, true);
                    }
                    self.current = self.current.take().and_then(|r| map_range(c, r));
                }
            }
            None => {
                self.origin = self.origin.min(len);
                self.scope = self.scope.take().map(|s| s.start.min(len)..s.end.min(len));
                self.current = None;
            }
        }
        self.tracked = doc.version();
    }

    fn resolve_nav(&mut self) {
        if let Some(cur) = &self.current {
            if !self.matches.iter().any(|m| &m.range == cur) {
                self.current = None;
            }
        }
        let Some(nav) = self.nav.take() else { return };
        let live = |m: &&Match| !m.excluded;
        let cur = self.current.clone();
        let target = match nav {
            Nav::From(pos) => {
                self.matches.iter().filter(live).find(|m| m.range.start >= pos).or_else(|| self.matches.iter().find(live))
            }
            Nav::Next(pos) => {
                let after = cur.as_ref().map_or(pos, |c| c.start + 1);
                self.matches.iter().filter(live).find(|m| m.range.start >= after).or_else(|| self.matches.iter().find(live))
            }
            Nav::Prev(pos) => {
                let before = cur.as_ref().map_or(pos, |c| c.start);
                self.matches
                    .iter()
                    .filter(live)
                    .rev()
                    .find(|m| m.range.start < before)
                    .or_else(|| self.matches.iter().rev().find(live))
            }
        };
        if let Some(m) = target {
            self.current = Some(m.range.clone());
            self.reveal = Some(m.range.clone());
        }
    }

    /// Excludes the current match (or brings it back) and moves on.
    pub(crate) fn exclude(&mut self, sel: Selection) {
        let Some(cur) = self.current.clone() else {
            self.go_next(sel);
            return;
        };
        if let Some(m) = self.matches.iter_mut().find(|m| m.range == cur) {
            m.excluded = !m.excluded;
        }
        self.gen += 1;
        self.nav = Some(Nav::Next(cur.end));
        self.current = None;
    }

    fn replacement_for(&self, doc: &Document, matcher: &Matcher, template: &Template, range: Range<usize>) -> String {
        let first = doc.char_to_position(range.start).line;
        let last = doc.char_to_position(range.end).line;
        let hs = doc.line_start(first);
        let hay = doc.slice(hs..doc.line_end(last));
        let rope = doc.rope();
        let b0 = rope.char_to_byte(range.start) - rope.char_to_byte(hs);
        let b1 = rope.char_to_byte(range.end) - rope.char_to_byte(hs);
        matcher.replacement(&hay, b0..b1, template, self.preserve_case)
    }

    /// Replaces the current match and moves to the next one. Without a current match it only
    /// moves. Returns the new editor selection when the text changed.
    pub(crate) fn replace(&mut self, doc: &mut Document, sel: Selection) -> Option<Selection> {
        self.refresh(doc, false);
        if !self.is_fresh(doc) {
            return None;
        }
        let matcher = self.matcher.clone()?;
        let cur = self.current.clone().filter(|c| self.matches.iter().any(|m| &m.range == c && !m.excluded));
        let Some(cur) = cur else {
            self.go_next(sel);
            self.refresh(doc, false);
            return None;
        };
        let template = Template::parse(&self.replacement, self.opts.regex);
        let text = self.replacement_for(doc, &matcher, &template, cur.clone());
        let end = cur.start + text.chars().count();
        let after = Selection::caret(end);
        doc.edit(cur.clone(), &text, sel, after, EditKind::Other);
        doc.seal_undo_group();
        self.used_replacement = Some(self.replacement.clone());
        self.current = None;
        self.nav = Some(Nav::From(end));
        self.refresh(doc, false);
        Some(after)
    }

    /// Replaces every match that is not excluded as one undo step. Returns the new selection.
    pub(crate) fn replace_all(&mut self, doc: &mut Document, sel: Selection) -> Option<Selection> {
        self.refresh(doc, true);
        if self.capped {
            // The counter stops at the limit; Replace All must not.
            self.full_search(doc, true, usize::MAX);
        }
        let matcher = self.matcher.clone()?;
        let template = Template::parse(&self.replacement, self.opts.regex);
        let mut edits = Vec::new();
        let mut caret = sel.head;
        for m in self.matches.iter().filter(|m| !m.excluded) {
            let text = self.replacement_for(doc, &matcher, &template, m.range.clone());
            if m.range.end <= sel.head {
                caret = (caret as isize + text.chars().count() as isize - m.range.len() as isize) as usize;
            }
            edits.push((m.range.clone(), text));
        }
        if edits.is_empty() {
            return None;
        }
        // Bottom-up, so every range is still valid when its edit runs.
        edits.reverse();
        let after = Selection::caret(caret);
        doc.transact(edits, sel, after, EditKind::Other);
        doc.seal_undo_group();
        self.used_replacement = Some(self.replacement.clone());
        self.current = None;
        self.refresh(doc, false);
        Some(after)
    }
}

/// Maps a range through a change; a range the change touched is gone.
fn map_range(c: &TextChange, r: Range<usize>) -> Option<Range<usize>> {
    if r.end < c.start || r.start > c.start + c.removed {
        Some(c.map(r.start, false)..c.map(r.end, true))
    } else {
        None
    }
}
