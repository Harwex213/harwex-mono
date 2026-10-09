use std::collections::VecDeque;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::time::{Duration, Instant};

use ropey::Rope;
use tree_sitter::{InputEdit, Parser, Point, Tree};

use crate::carets::Carets;
use crate::highlight::{self, HighlightConfig, Span};
use crate::language::Language;

/// 0-based line, 0-based column in chars.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Position {
    pub line: usize,
    pub column: usize,
}

impl Position {
    pub fn new(line: usize, column: usize) -> Position {
        Position { line, column }
    }
}

/// A selection in absolute char indices. `head` is where the caret is drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Selection {
    pub anchor: usize,
    pub head: usize,
}

impl Selection {
    pub fn caret(at: usize) -> Selection {
        Selection { anchor: at, head: at }
    }
    pub fn new(anchor: usize, head: usize) -> Selection {
        Selection { anchor, head }
    }
    pub fn is_empty(&self) -> bool {
        self.anchor == self.head
    }
    pub fn start(&self) -> usize {
        self.anchor.min(self.head)
    }
    pub fn end(&self) -> usize {
        self.anchor.max(self.head)
    }
    pub fn range(&self) -> Range<usize> {
        self.start()..self.end()
    }
}

/// One raw text replacement, in char indices of the text before it. `Document::changes_since`
/// lists them, so a consumer (the find bar) can update its ranges instead of starting over.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextChange {
    pub start: usize,
    /// Chars removed at `start`.
    pub removed: usize,
    /// Chars inserted at `start`.
    pub inserted: usize,
}

impl TextChange {
    /// Maps a char index of the text before the change to the text after it. An index inside
    /// the removed range moves to the start (`after == false`) or the end of the inserted text.
    pub fn map(&self, idx: usize, after: bool) -> usize {
        if idx < self.start || (idx == self.start && !after) {
            idx
        } else if idx >= self.start + self.removed {
            idx - self.removed + self.inserted
        } else if after {
            self.start + self.inserted
        } else {
            self.start
        }
    }
}

/// How many recent changes the journal keeps. Older versions get `None` and a full rescan.
const JOURNAL_LEN: usize = 4096;

/// Undo grouping class. Consecutive edits of the same class merge into one undo step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditKind {
    Insert,
    Delete,
    /// Never merges: paste, Enter, indent, comment toggle, programmatic edits.
    Other,
}

#[derive(Clone, Debug)]
struct EditRecord {
    start: usize,
    removed: String,
    inserted: String,
}

#[derive(Clone, Debug)]
struct Transaction {
    id: u64,
    /// Applied in order; each record's `start` is valid for the text after the previous one.
    edits: Vec<EditRecord>,
    before: Carets,
    after: Carets,
    kind: EditKind,
    at: Instant,
}

#[derive(Default)]
struct History {
    undo: Vec<Transaction>,
    redo: Vec<Transaction>,
    next_id: u64,
    /// Set by save and by cursor jumps so the next keystroke starts a new undo step.
    sealed: bool,
}

const GROUP_TIMEOUT: Duration = Duration::from_millis(1200);

impl History {
    fn top_id(&self) -> u64 {
        self.undo.last().map_or(0, |t| t.id)
    }

    fn push(&mut self, edits: Vec<EditRecord>, before: Carets, after: Carets, kind: EditKind) {
        self.redo.clear();
        let now = Instant::now();
        if !self.sealed && kind != EditKind::Other {
            if let Some(top) = self.undo.last_mut() {
                let continues = top.kind == kind
                    && top.after == before
                    && now.duration_since(top.at) < GROUP_TIMEOUT
                    // A word boundary ends a typing group, like IDEA: undo removes one word.
                    && !(kind == EditKind::Insert
                        && edits.iter().any(|e| e.inserted.chars().all(char::is_whitespace))
                        && !top.edits.last().is_some_and(|e| e.inserted.chars().all(char::is_whitespace)));
                if continues {
                    top.edits.extend(edits);
                    top.after = after;
                    top.at = now;
                    return;
                }
            }
        }
        self.sealed = false;
        self.next_id += 1;
        self.undo.push(Transaction { id: self.next_id, edits, before, after, kind, at: now });
    }
}

struct PendingParse {
    rx: Receiver<Option<Tree>>,
    /// Edits made while the background parse ran. They are replayed on the tree when it arrives,
    /// so the tree can then be brought up to date with a cheap incremental parse.
    edits: Vec<InputEdit>,
    /// A batch could not be replayed on the result. It is dropped when it lands, and only then
    /// the next parse starts, so fast typing never piles up parse threads.
    discard: bool,
}

struct Syntax {
    config: &'static HighlightConfig,
    parser: Parser,
    tree: Option<Tree>,
    /// The tree was edited but not reparsed yet. Reparse is deferred to the next highlight
    /// request so a burst of edits in one frame (multi-line indent) costs a single parse.
    stale: bool,
    pending: Option<PendingParse>,
    /// Bumped whenever `tree` changes, so view caches know when spans may differ.
    generation: u64,
    /// After a batch in a big file: the last good tree with the text it belongs to. It colors
    /// the lines until the worker's fresh tree lands. A tree edited by a file-wide span would
    /// color garbage, and editing it costs ~5 ms on 200k lines.
    fallback: Option<(Rope, Tree)>,
}

/// Raw edits made as one step (many carets, Replace All, undo of either). They reach the syntax
/// tree and the change journal as one edit that spans them all: tree-sitter's `Tree::edit`
/// scans the root's children, so 10k separate edits on a 200k-line file would cost seconds.
struct Batch {
    /// The text before the batch, kept only when the tree needs it. A live clone makes every
    /// rope node the batch touches a copy, which is most of the cost at 10k carets.
    old: Option<Rope>,
    old_chars: usize,
    /// The lowest edited char. The text before it is unchanged.
    lo_char: usize,
    /// The unchanged tail after the last edited place, in chars.
    tail_chars: usize,
    any: bool,
}

/// An undo step being collected from several `edit` calls (one per caret).
struct Group {
    records: Vec<EditRecord>,
    kind: Option<EditKind>,
}

impl Group {
    /// Typing at every caret stays an Insert step, so it groups by word like one caret does.
    fn add_kind(&mut self, kind: EditKind) {
        self.kind = Some(match self.kind {
            None => kind,
            Some(k) if k == kind => k,
            Some(_) => EditKind::Other,
        });
    }
}

/// More raw edits than this in one step go through a `Batch`.
const BATCH_MIN: usize = 16;

/// Files above this size are parsed (at open and after edits) on a worker thread, so the UI never
/// waits for tree-sitter.
const BACKGROUND_PARSE_BYTES: usize = 256 * 1024;
/// Above this size no syntax tree is built at all; tree-sitter memory grows roughly 10x the text.
const MAX_SYNTAX_BYTES: usize = 32 << 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LineEnding {
    Lf,
    CrLf,
}

pub struct Document {
    rope: Rope,
    path: Option<PathBuf>,
    language: Language,
    history: History,
    syntax: Option<Syntax>,
    version: u64,
    saved_id: u64,
    line_ending: LineEnding,
    bom: bool,
    indent: Indent,
    /// Longest line in chars; only grows between full rescans. It sizes the horizontal scroll
    /// range, where a stale overestimate is harmless and a full scan per edit is not.
    max_line_chars: usize,
    /// The last raw changes, each tagged with the version it produced.
    journal: VecDeque<(u64, TextChange)>,
    batch: Option<Batch>,
    group: Option<Group>,
}

/// Indentation style detected from the file, used by Tab, Enter and Shift+Tab.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Indent {
    pub use_tabs: bool,
    pub width: usize,
}

impl Indent {
    pub fn unit(&self) -> String {
        if self.use_tabs {
            "\t".to_string()
        } else {
            " ".repeat(self.width)
        }
    }
}

/// A cheap copy of a document's text (a rope clone) that a worker turns into the file's bytes.
#[derive(Clone)]
pub struct TextSnapshot {
    rope: Rope,
    crlf: bool,
    bom: bool,
}

impl TextSnapshot {
    /// The text as the file holds it: the BOM and CRLF line breaks restored.
    pub fn file_text(&self) -> String {
        let mut out = String::with_capacity(self.rope.len_bytes() + 16);
        if self.bom {
            out.push('\u{feff}');
        }
        for chunk in self.rope.chunks() {
            if self.crlf {
                out.push_str(&chunk.replace('\n', "\r\n"));
            } else {
                out.push_str(chunk);
            }
        }
        out
    }
}

impl Document {
    pub fn open(path: &Path) -> std::io::Result<Document> {
        let bytes = std::fs::read(path)?;
        let (bom, body) = match bytes.strip_prefix(b"\xEF\xBB\xBF") {
            Some(rest) => (true, rest),
            None => (false, &bytes[..]),
        };
        let text = String::from_utf8_lossy(body);
        let mut doc = Document::from_text(&text, Language::from_path(path));
        doc.path = Some(path.to_path_buf());
        doc.bom = bom;
        Ok(doc)
    }

    pub fn from_text(text: &str, language: Language) -> Document {
        // Ropey is built without CR line support so lines agree with tree-sitter and git, which
        // only count `\n`. CRLF is restored on save.
        let line_ending = if text.contains("\r\n") { LineEnding::CrLf } else { LineEnding::Lf };
        let rope = if line_ending == LineEnding::CrLf {
            Rope::from_str(&text.replace("\r\n", "\n"))
        } else {
            Rope::from_str(text)
        };
        let indent = detect_indent(&rope, language);
        let mut doc = Document {
            rope,
            path: None,
            language,
            history: History::default(),
            syntax: None,
            version: 0,
            saved_id: 0,
            line_ending,
            bom: false,
            indent,
            max_line_chars: 0,
            journal: VecDeque::new(),
            batch: None,
            group: None,
        };
        doc.max_line_chars = longest_line(&doc.rope);
        doc.init_syntax();
        doc
    }

    fn init_syntax(&mut self) {
        self.syntax = None;
        let Some(config) = self.language.highlight_config() else {
            return;
        };
        let len = self.rope.len_bytes();
        if len > MAX_SYNTAX_BYTES {
            return;
        }
        let mut parser = Parser::new();
        if parser.set_language(&config.language).is_err() {
            return;
        }
        self.syntax = Some(Syntax {
            config,
            parser,
            tree: None,
            stale: true,
            pending: None,
            generation: 0,
            fallback: None,
        });
        self.ensure_parsed(false);
    }

    pub fn save(&mut self) -> std::io::Result<()> {
        let path = self
            .path
            .clone()
            .ok_or_else(|| std::io::Error::other("document has no path"))?;
        self.save_as(&path)
    }

    /// The exact file contents `save` would write (BOM and line endings restored), plus a token
    /// for `mark_saved`. Lets the app write the file on a worker thread instead of the UI thread.
    pub fn save_snapshot(&mut self) -> (String, u64) {
        let mut out = String::with_capacity(self.rope.len_bytes() + 16);
        if self.bom {
            out.push('\u{feff}');
        }
        for chunk in self.rope.chunks() {
            match self.line_ending {
                LineEnding::Lf => out.push_str(chunk),
                LineEnding::CrLf => out.push_str(&chunk.replace('\n', "\r\n")),
            }
        }
        // Sealing makes the next keystroke start a new undo step, so the token keeps naming
        // exactly the state that was written.
        self.history.sealed = true;
        (out, self.history.top_id())
    }

    /// Marks the state named by a `save_snapshot` token as saved. Edits made after the snapshot
    /// keep the document dirty, because their undo id differs from the token.
    pub fn mark_saved(&mut self, token: u64) {
        self.saved_id = token;
        self.history.sealed = true;
    }

    /// Like `reload`, but with file bytes the caller already read (on a worker thread).
    /// Returns false and changes nothing when the text is already equal.
    pub fn reload_from_bytes(&mut self, bytes: &[u8]) -> bool {
        let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
        let text = String::from_utf8_lossy(body).replace("\r\n", "\n");
        if self.rope == text.as_str() {
            return false;
        }
        self.set_text(&text);
        self.saved_id = self.history.top_id();
        self.history.sealed = true;
        true
    }

    pub fn save_as(&mut self, path: &Path) -> std::io::Result<()> {
        let (out, _) = self.save_snapshot();
        std::fs::write(path, out)?;
        if self.path.as_deref() != Some(path) {
            self.path = Some(path.to_path_buf());
            let lang = Language::from_path(path);
            if lang != self.language {
                self.language = lang;
                self.init_syntax();
            }
        }
        self.saved_id = self.history.top_id();
        self.history.sealed = true;
        Ok(())
    }

    /// Replaces the content with the file on disk as one undoable edit, e.g. after a git checkout.
    pub fn reload(&mut self) -> std::io::Result<()> {
        let path = self
            .path
            .clone()
            .ok_or_else(|| std::io::Error::other("document has no path"))?;
        let bytes = std::fs::read(&path)?;
        let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
        let text = String::from_utf8_lossy(body).replace("\r\n", "\n");
        self.set_text(&text);
        self.saved_id = self.history.top_id();
        self.history.sealed = true;
        Ok(())
    }

    /// Full copy, used for tsserver sync.
    pub fn text(&self) -> String {
        self.rope.to_string()
    }

    /// Increments on every edit.
    pub fn version(&self) -> u64 {
        self.version
    }

    /// The raw changes that turned version `version` into the current text, oldest first.
    /// `None` when the journal no longer reaches back that far.
    pub fn changes_since(&self, version: u64) -> Option<Vec<TextChange>> {
        if version == self.version {
            return Some(Vec::new());
        }
        if version > self.version {
            return None;
        }
        let first = self.journal.front()?.0;
        if version + 1 < first {
            return None;
        }
        Some(self.journal.iter().filter(|(v, _)| *v > version).map(|(_, c)| *c).collect())
    }

    pub fn is_dirty(&self) -> bool {
        self.history.top_id() != self.saved_id
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn language(&self) -> Language {
        self.language
    }

    pub fn indent(&self) -> Indent {
        self.indent
    }

    pub fn rope(&self) -> &Rope {
        &self.rope
    }

    pub fn line_count(&self) -> usize {
        self.rope.len_lines()
    }

    pub fn len_chars(&self) -> usize {
        self.rope.len_chars()
    }

    /// Chars of the longest line (an upper bound after edits that shorten it).
    pub fn max_line_chars(&self) -> usize {
        self.max_line_chars
    }

    /// The text as `save_snapshot` writes it (BOM, CRLF), taken in O(1) without touching the
    /// undo history. Build the `String` on a worker with `TextSnapshot::file_text`.
    pub fn text_snapshot(&self) -> TextSnapshot {
        TextSnapshot { rope: self.rope.clone(), crlf: self.line_ending == LineEnding::CrLf, bom: self.bom }
    }

    /// Line length in chars, without the trailing newline.
    pub fn line_len(&self, line: usize) -> usize {
        if line >= self.rope.len_lines() {
            return 0;
        }
        let slice = self.rope.line(line);
        let n = slice.len_chars();
        if n > 0 && slice.char(n - 1) == '\n' {
            n - 1
        } else {
            n
        }
    }

    /// Line text without the trailing newline.
    pub fn line(&self, line: usize) -> String {
        if line >= self.rope.len_lines() {
            return String::new();
        }
        let mut s: String = self.rope.line(line).into();
        if s.ends_with('\n') {
            s.pop();
        }
        s
    }

    pub fn line_start(&self, line: usize) -> usize {
        self.rope.line_to_char(line.min(self.rope.len_lines()))
    }

    pub fn line_end(&self, line: usize) -> usize {
        self.line_start(line) + self.line_len(line)
    }

    pub fn char_to_position(&self, idx: usize) -> Position {
        let idx = idx.min(self.rope.len_chars());
        let line = self.rope.char_to_line(idx);
        Position { line, column: idx - self.rope.line_to_char(line) }
    }

    /// Clamps out-of-range positions to the nearest valid one.
    pub fn position_to_char(&self, pos: Position) -> usize {
        let last = self.rope.len_lines().saturating_sub(1);
        if pos.line > last {
            return self.rope.len_chars();
        }
        self.line_start(pos.line) + pos.column.min(self.line_len(pos.line))
    }

    pub fn slice(&self, range: Range<usize>) -> String {
        let len = self.rope.len_chars();
        self.rope.slice(range.start.min(len)..range.end.min(len)).into()
    }

    pub fn char_at(&self, idx: usize) -> Option<char> {
        (idx < self.rope.len_chars()).then(|| self.rope.char(idx))
    }

    /// Identifier-like word (letters, digits, `_`, `$`) at or right before `pos`.
    pub fn word_at(&self, pos: Position) -> Option<Range<Position>> {
        let line = self.line(pos.line);
        let chars: Vec<char> = line.chars().collect();
        let mut col = pos.column.min(chars.len());
        if col == chars.len() || !is_word_char(chars[col]) {
            if col > 0 && is_word_char(chars[col - 1]) {
                col -= 1;
            } else {
                return None;
            }
        }
        let mut s = col;
        while s > 0 && is_word_char(chars[s - 1]) {
            s -= 1;
        }
        let mut e = col;
        while e < chars.len() && is_word_char(chars[e]) {
            e += 1;
        }
        Some(Position::new(pos.line, s)..Position::new(pos.line, e))
    }

    /// One undoable edit, grouped with the previous edit when `kind` allows it.
    pub fn edit(&mut self, range: Range<usize>, text: &str, before: Selection, after: Selection, kind: EditKind) {
        let len = self.rope.len_chars();
        let range = range.start.min(len)..range.end.min(len).max(range.start.min(len));
        if range.is_empty() && text.is_empty() {
            return;
        }
        // No vectors for one edit: at 10k carets this runs 10k times per keystroke.
        let removed: String = if range.is_empty() { String::new() } else { self.rope.slice(range.clone()).into() };
        self.replace_raw(range.clone(), text);
        let record = EditRecord { start: range.start, removed, inserted: text.to_string() };
        if let Some(g) = &mut self.group {
            g.records.push(record);
            g.add_kind(kind);
            return;
        }
        self.history.push(vec![record], Carets::single(before), Carets::single(after), kind);
    }

    /// Like `transact`, with the carets to restore on undo and redo.
    pub fn transact_carets(&mut self, edits: Vec<(Range<usize>, String)>, before: &Carets, after: &Carets, kind: EditKind) {
        let records = self.apply_edits(edits);
        if let Some(records) = self.collect(records, kind) {
            self.history.push(records, before.clone(), after.clone(), kind);
        }
    }

    /// Applies edits in order and returns their undo records.
    fn apply_edits(&mut self, edits: Vec<(Range<usize>, String)>) -> Vec<EditRecord> {
        let batch = edits.len() > BATCH_MIN && self.batch.is_none();
        if batch {
            self.begin_batch();
        }
        let mut records = Vec::with_capacity(edits.len());
        for (range, text) in edits {
            let len = self.rope.len_chars();
            let range = range.start.min(len)..range.end.min(len).max(range.start.min(len));
            if range.is_empty() && text.is_empty() {
                continue;
            }
            let removed: String = self.rope.slice(range.clone()).into();
            self.replace_raw(range.clone(), &text);
            records.push(EditRecord { start: range.start, removed, inserted: text });
        }
        if batch {
            self.finish_batch();
        }
        records
    }

    /// Adds the records to the open group. Returns them when there is no group (or nothing to
    /// record), so the caller makes them an undo step of their own.
    fn collect(&mut self, records: Vec<EditRecord>, kind: EditKind) -> Option<Vec<EditRecord>> {
        if records.is_empty() {
            return None;
        }
        let Some(g) = &mut self.group else { return Some(records) };
        g.records.extend(records);
        g.add_kind(kind);
        None
    }

    /// Starts one undo step that collects every following `edit` and `transact` until
    /// `end_group`. Used to run a command at many carets.
    pub(crate) fn begin_group(&mut self) {
        self.group = Some(Group { records: Vec::new(), kind: None });
        self.begin_batch();
    }

    /// The lowest char an edit of the open group touched, in the current text.
    pub(crate) fn group_low(&self) -> Option<usize> {
        self.batch.as_ref().filter(|b| b.any).map(|b| b.lo_char)
    }

    pub(crate) fn end_group(&mut self, before: &Carets, after: &Carets) {
        self.finish_batch();
        let Some(g) = self.group.take() else { return };
        if !g.records.is_empty() {
            self.history.push(g.records, before.clone(), after.clone(), g.kind.unwrap_or(EditKind::Other));
        }
    }

    fn begin_batch(&mut self) {
        let big = self.rope.len_bytes() > BACKGROUND_PARSE_BYTES;
        let needs_old = self.syntax.as_ref().is_some_and(|s| if big { s.tree.is_some() && s.fallback.is_none() } else { true });
        self.batch = Some(Batch {
            old: needs_old.then(|| self.rope.clone()),
            old_chars: self.rope.len_chars(),
            lo_char: usize::MAX,
            tail_chars: usize::MAX,
            any: false,
        });
    }

    /// Reports the batch to the journal and the syntax tree as one change.
    fn finish_batch(&mut self) {
        let Some(b) = self.batch.take() else { return };
        if !b.any {
            return;
        }
        let new_chars = self.rope.len_chars();
        let change = TextChange {
            start: b.lo_char,
            removed: b.old_chars - b.tail_chars - b.lo_char,
            inserted: new_chars - b.tail_chars - b.lo_char,
        };
        self.log_change(change);
        let Some(syntax) = &mut self.syntax else { return };
        if self.rope.len_bytes() > BACKGROUND_PARSE_BYTES {
            // The worker parses from scratch: a span over the whole file leaves nothing to reuse.
            if syntax.fallback.is_none() {
                if let (Some(tree), Some(old)) = (syntax.tree.take(), b.old) {
                    syntax.fallback = Some((old, tree));
                }
            }
            syntax.tree = None;
            if let Some(p) = &mut syntax.pending {
                p.discard = true;
            }
            syntax.stale = true;
            syntax.generation += 1;
            return;
        }
        let Some(old) = b.old else { return };
        // The text before `lo` and after the tail is unchanged, so byte offsets there agree.
        let lo_byte = self.rope.char_to_byte(b.lo_char);
        let old_end_byte = old.char_to_byte(b.old_chars - b.tail_chars);
        let new_end_byte = self.rope.char_to_byte(new_chars - b.tail_chars);
        let old_end_row = old.byte_to_line(old_end_byte);
        let edit = InputEdit {
            start_byte: lo_byte,
            old_end_byte,
            new_end_byte,
            start_position: self.point_at(lo_byte),
            old_end_position: Point { row: old_end_row, column: old_end_byte - old.line_to_byte(old_end_row) },
            new_end_position: self.point_at(new_end_byte),
        };
        self.apply_input_edit(edit);
    }

    /// Several edits applied in order as one undo step. Each range refers to the text produced by
    /// the previous edit, so callers editing many lines go bottom-up to keep ranges simple.
    pub fn transact(&mut self, edits: Vec<(Range<usize>, String)>, before: Selection, after: Selection, kind: EditKind) {
        // Inside a group the selections are not needed: no Carets get built per caret.
        let records = self.apply_edits(edits);
        if let Some(records) = self.collect(records, kind) {
            self.history.push(records, Carets::single(before), Carets::single(after), kind);
        }
    }

    /// Undoable replace by positions. Convenient for the app (rollback lines, rename).
    pub fn replace(&mut self, start: Position, end: Position, text: &str) {
        let s = self.position_to_char(start);
        let e = self.position_to_char(end);
        let after = Selection::caret(s + text.chars().count());
        self.edit(s..e, text, Selection::caret(s), after, EditKind::Other);
    }

    /// Replaces the whole text as one undoable edit. Only the differing middle is touched, so the
    /// syntax tree is reparsed incrementally and undo stays small.
    pub fn set_text(&mut self, text: &str) {
        let old: String = self.rope.to_string();
        let prefix = old
            .char_indices()
            .zip(text.chars())
            .take_while(|((_, a), b)| a == b)
            .count();
        let old_rest: Vec<char> = old.chars().skip(prefix).collect();
        let new_rest: Vec<char> = text.chars().skip(prefix).collect();
        let suffix = old_rest
            .iter()
            .rev()
            .zip(new_rest.iter().rev())
            .take_while(|(a, b)| a == b)
            .count();
        let removed_end = prefix + old_rest.len() - suffix;
        let inserted: String = new_rest[..new_rest.len() - suffix].iter().collect();
        if removed_end == prefix && inserted.is_empty() {
            return;
        }
        let after = Selection::caret(prefix + inserted.chars().count());
        self.edit(prefix..removed_end, &inserted, Selection::caret(prefix), after, EditKind::Other);
    }

    /// Returns the selection to restore, or `None` when there is nothing to undo.
    pub fn undo(&mut self) -> Option<Selection> {
        self.undo_carets().map(|c| c.primary())
    }

    pub fn redo(&mut self) -> Option<Selection> {
        self.redo_carets().map(|c| c.primary())
    }

    /// Undo that returns every caret to restore.
    pub fn undo_carets(&mut self) -> Option<Carets> {
        let tx = self.history.undo.pop()?;
        let batch = tx.edits.len() > BATCH_MIN;
        if batch {
            self.begin_batch();
        }
        for e in tx.edits.iter().rev() {
            let end = e.start + e.inserted.chars().count();
            self.replace_raw(e.start..end, &e.removed);
        }
        if batch {
            self.finish_batch();
        }
        let sel = tx.before.clone();
        self.history.redo.push(tx);
        self.history.sealed = true;
        Some(sel)
    }

    /// Redo that returns every caret to restore.
    pub fn redo_carets(&mut self) -> Option<Carets> {
        let tx = self.history.redo.pop()?;
        let batch = tx.edits.len() > BATCH_MIN;
        if batch {
            self.begin_batch();
        }
        for e in &tx.edits {
            let end = e.start + e.removed.chars().count();
            self.replace_raw(e.start..end, &e.inserted);
        }
        if batch {
            self.finish_batch();
        }
        let sel = tx.after.clone();
        self.history.undo.push(tx);
        self.history.sealed = true;
        Some(sel)
    }

    pub fn can_undo(&self) -> bool {
        !self.history.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.history.redo.is_empty()
    }

    /// Ends the current undo group, so the next edit becomes its own undo step.
    pub fn seal_undo_group(&mut self) {
        self.history.sealed = true;
    }

    fn point_at(&self, byte: usize) -> Point {
        let row = self.rope.byte_to_line(byte);
        Point { row, column: byte - self.rope.line_to_byte(row) }
    }

    fn replace_raw(&mut self, range: Range<usize>, text: &str) {
        if let Some(b) = &mut self.batch {
            b.any = true;
            b.lo_char = b.lo_char.min(range.start);
            b.tail_chars = b.tail_chars.min(self.rope.len_chars() - range.end);
            // Removing a line break joins two lines, which can make a longer one.
            let joins = match range.len() {
                0 => false,
                1 => matches!(self.rope.char(range.start), '\n' | '\r' | '\u{0B}' | '\u{0C}' | '\u{85}' | '\u{2028}' | '\u{2029}'),
                _ => self.rope.char_to_line(range.start) != self.rope.char_to_line(range.end),
            };
            if !range.is_empty() {
                self.rope.remove(range.clone());
            }
            if !text.is_empty() {
                self.rope.insert(range.start, text);
            }
            if text.contains('\n') {
                let first = self.rope.char_to_line(range.start);
                let last = self.rope.char_to_line(range.start + text.chars().count());
                self.grow_max_line(first, last);
            } else if !text.is_empty() || joins {
                // Two lookups instead of a line slice; the count may include the line break,
                // and a 1-char overestimate of the scroll range is harmless.
                let line = self.rope.char_to_line(range.start);
                let n = self.rope.line_to_char(line + 1) - self.rope.line_to_char(line);
                self.max_line_chars = self.max_line_chars.max(n);
            }
            return;
        }
        let start_byte = self.rope.char_to_byte(range.start);
        let old_end_byte = self.rope.char_to_byte(range.end);
        let start_position = self.point_at(start_byte);
        let old_end_position = self.point_at(old_end_byte);
        if !range.is_empty() {
            self.rope.remove(range.clone());
        }
        if !text.is_empty() {
            self.rope.insert(range.start, text);
        }
        let new_end_byte = start_byte + text.len();
        let new_end_position = self.point_at(new_end_byte);
        self.log_change(TextChange { start: range.start, removed: range.len(), inserted: text.chars().count() });
        self.grow_max_line(start_position.row, new_end_position.row);
        self.apply_input_edit(InputEdit {
            start_byte,
            old_end_byte,
            new_end_byte,
            start_position,
            old_end_position,
            new_end_position,
        });
    }

    fn log_change(&mut self, change: TextChange) {
        self.version += 1;
        if self.journal.len() == JOURNAL_LEN {
            self.journal.pop_front();
        }
        self.journal.push_back((self.version, change));
    }

    fn grow_max_line(&mut self, first: usize, last: usize) {
        for l in first..=last.min(self.rope.len_lines().saturating_sub(1)) {
            let n = self.line_len(l);
            if n > self.max_line_chars {
                self.max_line_chars = n;
            }
        }
    }

    fn apply_input_edit(&mut self, edit: InputEdit) {
        if let Some(syntax) = &mut self.syntax {
            // The edited old tree stays usable for highlighting until the reparse lands.
            if let Some(tree) = &mut syntax.tree {
                tree.edit(&edit);
            }
            if let Some(p) = &mut syntax.pending {
                p.edits.push(edit);
            }
            syntax.stale = true;
        }
    }

    /// Brings the syntax tree up to date. Small files reparse right here (well under a
    /// millisecond). Big files reparse on a worker thread: tree-sitter's incremental parse still
    /// walks every top-level node, which costs ~15 ms on a 200k-line file and would drop frames
    /// on every keystroke. Until the worker answers, the edited old tree keeps highlighting.
    fn ensure_parsed(&mut self, block: bool) {
        let Some(syntax) = &mut self.syntax else {
            return;
        };
        if let Some(p) = &mut syntax.pending {
            let got = if block {
                p.rx.recv().map_err(|_| TryRecvError::Disconnected)
            } else {
                p.rx.try_recv()
            };
            match got {
                Ok(tree) => {
                    let p = syntax.pending.take().expect("checked above");
                    if p.discard {
                        // Nothing to keep; the next parse below starts from scratch.
                    } else if let Some(mut tree) = tree {
                        // The worker parsed a snapshot; replay what was typed since then.
                        for e in &p.edits {
                            tree.edit(e);
                        }
                        syntax.tree = Some(tree);
                        syntax.fallback = None;
                        syntax.generation += 1;
                    }
                    syntax.stale = p.discard || !p.edits.is_empty();
                }
                Err(TryRecvError::Empty) => return,
                Err(TryRecvError::Disconnected) => {
                    syntax.pending = None;
                    syntax.stale = true;
                }
            }
        }
        if !syntax.stale {
            return;
        }
        if !block && self.rope.len_bytes() > BACKGROUND_PARSE_BYTES {
            // Rope and tree clones share their storage, so the snapshot is O(1).
            let rope = self.rope.clone();
            let old = syntax.tree.clone();
            let language = syntax.config.language.clone();
            let (tx, rx) = mpsc::channel();
            let spawned = std::thread::Builder::new().name("ide-editor-parse".into()).spawn(move || {
                let mut parser = Parser::new();
                let tree = parser
                    .set_language(&language)
                    .ok()
                    .and_then(|_| parse_rope(&mut parser, &rope, old.as_ref()));
                let _ = tx.send(tree);
            });
            if spawned.is_ok() {
                syntax.pending = Some(PendingParse { rx, edits: Vec::new(), discard: false });
                syntax.stale = false;
                return;
            }
        }
        if let Some(tree) = parse_rope(&mut syntax.parser, &self.rope, syntax.tree.as_ref()) {
            syntax.tree = Some(tree);
            syntax.fallback = None;
            syntax.generation += 1;
        }
        syntax.stale = false;
    }

    /// False while a background parse is running or edits are not parsed yet.
    pub fn syntax_ready(&mut self) -> bool {
        self.ensure_parsed(false);
        self.syntax.as_ref().is_none_or(|s| s.pending.is_none() && !s.stale)
    }

    /// Blocks until the syntax tree matches the text. Used by tests and benchmarks.
    pub fn wait_syntax(&mut self) {
        self.ensure_parsed(true);
    }

    /// Changes whenever highlight spans may have changed (edit or new tree).
    pub fn highlight_version(&self) -> (u64, u64) {
        (self.version, self.syntax.as_ref().map_or(0, |s| s.generation))
    }

    /// Colored spans per line for `lines`. Lines without a tree come back empty (plain text).
    pub fn highlight(&mut self, lines: Range<usize>) -> Vec<Vec<Span>> {
        self.ensure_parsed(false);
        match &self.syntax {
            Some(Syntax { tree: Some(tree), config, .. }) => {
                highlight::highlight_lines(&self.rope, tree, config, lines)
            }
            // Old colors on the new text: off by the typed chars until the fresh tree lands.
            Some(Syntax { fallback: Some((rope, tree)), config, .. }) => {
                let n = lines.len();
                let mut out = if lines.start < rope.len_lines() {
                    highlight::highlight_lines(rope, tree, config, lines.start..lines.end.min(rope.len_lines()))
                } else {
                    Vec::new()
                };
                out.resize(n, Vec::new());
                out
            }
            _ if self.language == Language::Plain => highlight::plain_code_spans(&self.rope, lines),
            _ => vec![Vec::new(); lines.len()],
        }
    }

    /// The current tree (possibly one parse behind) and its highlight query, for classifying
    /// text on a worker. Tree clones share their storage.
    pub(crate) fn syntax_snapshot(&mut self) -> Option<(Tree, &'static HighlightConfig)> {
        self.ensure_parsed(false);
        let s = self.syntax.as_ref()?;
        Some((s.tree.clone()?, s.config))
    }

    /// The tree-sitter tree, if parsed. Exposed for structural features in the app.
    pub fn syntax_tree(&mut self) -> Option<&Tree> {
        self.ensure_parsed(false);
        self.syntax.as_ref().and_then(|s| s.tree.as_ref())
    }
}

pub(crate) fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// One linear pass over the chunks; per-line rope lookups cost ~10x more on big files.
fn longest_line(rope: &Rope) -> usize {
    let mut max = 0;
    let mut cur = 0;
    for chunk in rope.chunks() {
        for &b in chunk.as_bytes() {
            if b == b'\n' {
                max = max.max(cur);
                cur = 0;
            } else if b & 0xC0 != 0x80 {
                // Counting non-continuation bytes counts chars without decoding UTF-8.
                cur += 1;
            }
        }
    }
    max.max(cur)
}

fn parse_rope(parser: &mut Parser, rope: &Rope, old: Option<&Tree>) -> Option<Tree> {
    let len = rope.len_bytes();
    let mut read = |byte: usize, _: Point| -> &[u8] {
        if byte >= len {
            return &[];
        }
        let (chunk, chunk_byte, _, _) = rope.chunk_at_byte(byte);
        &chunk.as_bytes()[byte - chunk_byte..]
    };
    parser.parse_with_options(&mut read, old, None)
}

/// Guesses the indent unit from leading whitespace changes between consecutive lines.
fn detect_indent(rope: &Rope, language: Language) -> Indent {
    let mut tabs = 0usize;
    let mut spaces = 0usize;
    let mut deltas = [0usize; 9];
    let mut prev = 0usize;
    for line in rope.lines().take(4000) {
        let mut n = 0;
        let mut first = None;
        for c in line.chars() {
            match c {
                ' ' => n += 1,
                '\t' => {
                    first.get_or_insert('\t');
                    break;
                }
                _ => break,
            }
            first.get_or_insert(' ');
        }
        let blank = line.chars().all(char::is_whitespace);
        if blank {
            continue;
        }
        match first {
            Some('\t') => tabs += 1,
            Some(' ') => spaces += 1,
            _ => {}
        }
        if n > prev && n - prev < deltas.len() {
            deltas[n - prev] += 1;
        }
        prev = n;
    }
    if tabs > spaces {
        return Indent { use_tabs: true, width: 4 };
    }
    // Deltas of 1 and 3 come from JSDoc ` * ` continuation lines, not from indentation.
    let width = [2usize, 4, 8]
        .into_iter()
        .max_by_key(|&w| deltas[w])
        .filter(|&w| deltas[w] > 0)
        .unwrap_or_else(|| language.default_indent_width());
    Indent { use_tabs: false, width }
}
