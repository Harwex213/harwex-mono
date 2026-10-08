//! IDEA's "identifier under caret": when the selection is exactly one identifier, or the caret
//! stands in one, the other occurrences of that identifier in the file get a soft background
//! and a scrollbar mark. Whole word, case-sensitive. Small files are searched on the UI thread,
//! big ones on a worker; the result is cached by (word, doc version).

use std::ops::Range;
use std::sync::mpsc::{self, Receiver, TryRecvError};

use crate::carets::Carets;
use crate::document::{is_word_char, Document};
use crate::highlight::HlKind;
use crate::search::{FindOptions, Matcher};

/// More occurrences than this are not collected (and not marked).
pub const MAX_OCCURRENCES: usize = 2000;
/// Files up to this size are searched on the UI thread; bigger ones on a worker.
const SYNC_BYTES: usize = 256 * 1024;
/// A longer run of word chars is not an identifier worth marking, and the scan stops there.
const MAX_WORD: usize = 256;

type Found = (Vec<Range<usize>>, bool);

#[derive(Default)]
pub(crate) struct Occurrences {
    /// What `target` was computed for: doc version, primary anchor and head, several carets.
    target_key: Option<(u64, usize, usize, bool)>,
    /// The identifier and its own range (the selection, or the word at the caret).
    target: Option<(String, Range<usize>)>,
    /// The word and doc version `ranges` belong to.
    have: Option<(String, u64)>,
    ranges: Vec<Range<usize>>,
    capped: bool,
    pending: Option<(String, u64, Receiver<Found>)>,
    /// Bumps whenever `ranges` changes, for the scrollbar mark cache.
    pub(crate) gen: u64,
}

impl Occurrences {
    /// Brings the occurrences up to date with the carets and the text. Cheap when nothing
    /// changed: the target is recomputed only after an edit or a caret move.
    pub(crate) fn update(&mut self, doc: &mut Document, carets: &Carets) {
        let p = carets.primary();
        let key = (doc.version(), p.anchor, p.head, carets.is_multi());
        if self.target_key != Some(key) {
            self.target_key = Some(key);
            self.target = target(doc, carets);
        }
        let Some((word, _)) = &self.target else {
            self.pending = None;
            self.set(Vec::new(), false, None);
            return;
        };
        let want = (word.clone(), doc.version());
        if self.have.as_ref() == Some(&want) {
            return;
        }
        if let Some((w, v, rx)) = &self.pending {
            let current = *w == want.0 && *v == want.1;
            match rx.try_recv() {
                Ok((found, capped)) if current => {
                    self.pending = None;
                    self.set(found, capped, Some(want));
                    return;
                }
                Err(TryRecvError::Empty) => {
                    // Old ranges would sit at shifted places; show none until the answer. A
                    // stale search runs to its end first, so fast typing keeps one worker.
                    self.set(Vec::new(), false, None);
                    return;
                }
                Ok(_) | Err(TryRecvError::Disconnected) => {}
            }
        }
        self.pending = None;
        self.set(Vec::new(), false, None);
        let opts = FindOptions { match_case: true, words: true, ..FindOptions::default() };
        let Ok(Some(matcher)) = Matcher::new(&want.0, &opts) else { return };
        if doc.rope().len_bytes() <= SYNC_BYTES {
            let text = doc.slice(0..doc.len_chars());
            let (found, capped) = matcher.find(&text, 0, MAX_OCCURRENCES);
            self.set(found, capped, Some(want));
            return;
        }
        // A rope clone shares its storage, so the snapshot is O(1).
        let rope = doc.rope().clone();
        let (tx, rx) = mpsc::channel();
        let spawned = std::thread::Builder::new().name("ide-editor-occurrences".into()).spawn(move || {
            let text: String = rope.into();
            let _ = tx.send(matcher.find(&text, 0, MAX_OCCURRENCES));
        });
        if spawned.is_ok() {
            self.pending = Some((want.0, want.1, rx));
        }
    }

    fn set(&mut self, ranges: Vec<Range<usize>>, capped: bool, have: Option<(String, u64)>) {
        if ranges != self.ranges {
            self.gen += 1;
        }
        self.ranges = ranges;
        self.capped = capped;
        self.have = have;
    }

    /// True while a worker searches.
    pub(crate) fn is_searching(&self) -> bool {
        self.pending.is_some()
    }

    /// The identifier's own range, which is never painted.
    pub(crate) fn current(&self) -> Option<Range<usize>> {
        self.target.as_ref().map(|t| t.1.clone())
    }

    /// The occurrences to show, sorted: all of them when at least one is not the target
    /// itself, otherwise none.
    pub(crate) fn shown(&self) -> &[Range<usize>] {
        let cur = self.target.as_ref().map(|t| &t.1);
        if self.ranges.iter().any(|r| Some(r) != cur) {
            &self.ranges
        } else {
            &[]
        }
    }

    pub(crate) fn is_capped(&self) -> bool {
        self.capped
    }
}

/// The identifier to look for: the primary selection when it is exactly one whole identifier,
/// or the identifier at a bare caret. Keywords, numbers, comments and strings are not
/// identifiers. Several carets show nothing.
fn target(doc: &mut Document, carets: &Carets) -> Option<(String, Range<usize>)> {
    if carets.is_multi() {
        return None;
    }
    let sel = carets.primary();
    let word_at = |i: usize| doc.char_at(i).is_some_and(is_word_char);
    let range = if sel.is_empty() {
        let h = sel.head;
        let mut s = if word_at(h) {
            h
        } else if h > 0 && word_at(h - 1) {
            h - 1
        } else {
            return None;
        };
        let mut e = s + 1;
        while s > 0 && word_at(s - 1) {
            s -= 1;
            if e - s > MAX_WORD {
                return None;
            }
        }
        while word_at(e) {
            e += 1;
            if e - s > MAX_WORD {
                return None;
            }
        }
        s..e
    } else {
        let r = sel.range();
        if r.len() > MAX_WORD || (r.start > 0 && word_at(r.start - 1)) || word_at(r.end) {
            return None;
        }
        r
    };
    let word = doc.slice(range.clone());
    if !word.chars().all(is_word_char) || word.chars().next().is_none_or(char::is_numeric) {
        return None;
    }
    let rope = doc.rope();
    let line = rope.char_to_line(range.start);
    let byte = (rope.char_to_byte(range.start) - rope.line_to_byte(line)) as u32;
    let spans = doc.highlight(line..line + 1);
    let kind = spans.first().and_then(|s| s.iter().find(|s| s.start <= byte && byte < s.end)).map(|s| s.kind);
    if matches!(
        kind,
        Some(HlKind::Keyword | HlKind::Builtin | HlKind::String | HlKind::Escape | HlKind::Number | HlKind::Comment | HlKind::DocComment)
    ) {
        return None;
    }
    Some((word, range))
}
