use std::path::Path;
use std::sync::OnceLock;

use crate::highlight::{HighlightConfig, HlKind};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Language {
    TypeScript,
    Tsx,
    JavaScript,
    Jsx,
    Json,
    Rust,
    Css,
    Markdown,
    Plain,
}

impl Language {
    pub fn from_path(path: &Path) -> Language {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        match ext.as_str() {
            "ts" | "mts" | "cts" => Language::TypeScript,
            "tsx" => Language::Tsx,
            "js" | "mjs" | "cjs" => Language::JavaScript,
            "jsx" => Language::Jsx,
            "json" | "jsonc" | "json5" => Language::Json,
            "rs" => Language::Rust,
            "css" => Language::Css,
            "md" | "markdown" | "mdx" => Language::Markdown,
            _ => {
                // Dotfiles like `.eslintrc` or `tsconfig` variants without an extension.
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                match name {
                    ".babelrc" | ".eslintrc" | ".prettierrc" => Language::Json,
                    _ => Language::Plain,
                }
            }
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Language::TypeScript => "TypeScript",
            Language::Tsx => "TypeScript JSX",
            Language::JavaScript => "JavaScript",
            Language::Jsx => "JavaScript JSX",
            Language::Json => "JSON",
            Language::Rust => "Rust",
            Language::Css => "CSS",
            Language::Markdown => "Markdown",
            Language::Plain => "Plain text",
        }
    }

    /// Token for Cmd+/. CSS has no line comment, so it gets a block pair.
    pub fn comment_tokens(self) -> Option<(&'static str, &'static str)> {
        match self {
            Language::TypeScript
            | Language::Tsx
            | Language::JavaScript
            | Language::Jsx
            | Language::Rust
            | Language::Json => Some(("//", "")),
            Language::Css => Some(("/*", "*/")),
            Language::Markdown | Language::Plain => None,
        }
    }

    pub(crate) fn default_indent_width(self) -> usize {
        match self {
            Language::Rust | Language::Plain | Language::Markdown => 4,
            _ => 2,
        }
    }

    /// Compiled grammar + highlight query, built once per process and shared by every document.
    pub(crate) fn highlight_config(self) -> Option<&'static HighlightConfig> {
        macro_rules! cached {
            ($build:expr) => {{
                static CELL: OnceLock<Option<HighlightConfig>> = OnceLock::new();
                CELL.get_or_init(|| $build).as_ref()
            }};
        }
        let js = tree_sitter_javascript::HIGHLIGHT_QUERY;
        let jsx = tree_sitter_javascript::JSX_HIGHLIGHT_QUERY;
        let ts = tree_sitter_typescript::HIGHLIGHTS_QUERY;
        match self {
            // The TS query only lists what TS adds on top of JS, so JS goes first and the TS
            // patterns, being later, win on equal nodes (see `highlight::paint`).
            Language::TypeScript => cached!(HighlightConfig::new(
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
                &[js, ts],
            )),
            Language::Tsx => cached!(HighlightConfig::new(
                tree_sitter_typescript::LANGUAGE_TSX.into(),
                &[js, jsx, ts],
            )),
            Language::JavaScript | Language::Jsx => cached!(HighlightConfig::new(
                tree_sitter_javascript::LANGUAGE.into(),
                &[js, jsx],
            )),
            Language::Json => cached!(HighlightConfig::new(
                tree_sitter_json::LANGUAGE.into(),
                &[tree_sitter_json::HIGHLIGHTS_QUERY],
            )),
            Language::Rust => cached!(HighlightConfig::new(
                tree_sitter_rust::LANGUAGE.into(),
                &[tree_sitter_rust::HIGHLIGHTS_QUERY],
            )),
            Language::Css => cached!(HighlightConfig::new(
                tree_sitter_css::LANGUAGE.into(),
                &[tree_sitter_css::HIGHLIGHTS_QUERY],
            )),
            // Only the block grammar: the inline grammar needs a second parser per document and
            // injected ranges, which is not worth it for README-style files.
            Language::Markdown => cached!(HighlightConfig::new(
                tree_sitter_md::LANGUAGE.into(),
                &[tree_sitter_md::HIGHLIGHT_QUERY_BLOCK],
            )),
            Language::Plain => None,
        }
    }
}

/// Maps a query capture name like `function.method` to a color class.
pub(crate) fn kind_for_capture(name: &str) -> Option<HlKind> {
    let kind = match name {
        "comment.documentation" => HlKind::DocComment,
        "variable.builtin" | "constant.builtin" | "boolean" => HlKind::Builtin,
        "variable.parameter" => HlKind::Parameter,
        "function.macro" => HlKind::Macro,
        "type.builtin" => HlKind::Type,
        "string.special.key" => HlKind::Property,
        "text.title" => HlKind::Title,
        "text.literal" => HlKind::String,
        "text.uri" | "text.reference" => HlKind::Link,
        "punctuation.special" => HlKind::Operator,
        "none" | "embedded" | "spell" => return None,
        _ => {
            let head = name.split('.').next().unwrap_or(name);
            match head {
                "keyword" | "import" | "charset" | "media" | "keyframes" | "supports"
                | "conditional" | "repeat" | "include" | "exception" | "storageclass" => {
                    HlKind::Keyword
                }
                "string" | "character" => HlKind::String,
                "escape" => HlKind::Escape,
                "number" | "float" => HlKind::Number,
                "comment" => HlKind::Comment,
                "function" | "method" => HlKind::Function,
                "constructor" | "type" | "namespace" | "module" => HlKind::Type,
                "property" | "field" => HlKind::Property,
                "constant" => HlKind::Constant,
                "variable" | "label" => HlKind::Variable,
                "operator" => HlKind::Operator,
                "punctuation" => HlKind::Punctuation,
                "tag" => HlKind::Tag,
                "attribute" => HlKind::Attribute,
                _ => return None,
            }
        }
    };
    Some(kind)
}
