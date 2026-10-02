//! Text buffer, syntax highlighting and the egui editor widget for harwex-ide.
//!
//! Rendering cost depends on the viewport, not the file: only visible lines are highlighted and
//! laid out, and line galleys are cached by content.

mod document;
pub mod editing;
mod highlight;
mod language;
mod view;

pub use document::{Document, EditKind, Indent, Position, Selection};
pub use highlight::{HlKind, Span};
pub use language::Language;
pub use view::{EditorAction, EditorGeometry, EditorResponse, EditorState, EditorTheme, EditorView, GutterMark};
