//! Text buffer, syntax highlighting and the egui editor widget for harwex-ide.
//!
//! Rendering cost depends on the viewport, not the file: only visible lines are highlighted and
//! laid out, and line galleys are cached by content.

pub mod carets;
mod conf;
mod document;
pub mod editing;
mod find;
mod find_bar;
mod highlight;
pub mod keys;
mod language;
mod layout;
mod occurrences;
mod search;
mod theme;
mod view;
pub mod wrap;

pub use carets::Carets;
pub use document::{Document, EditKind, Indent, Position, Selection, TextChange, TextSnapshot};
pub use find::{FindState, Match, MAX_MATCHES};
pub use search::{preserve_case, FindOptions, Matcher, SearchFilter, Template};
pub use highlight::{HlKind, Span};
pub use keys::shortcut_label;
pub use language::Language;
pub use occurrences::MAX_OCCURRENCES;
pub use layout::Fold;
pub use view::{column_advance, ClickChain, CHAIN_DIST, EditorAction, EditorGeometry, EditorResponse, EditorState, EditorView, GutterMark, LineBand, ProblemMark, ProblemSeverity, ViewState};
pub use theme::EditorTheme;
