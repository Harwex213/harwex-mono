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
    C,
    Cpp,
    CSharp,
    Java,
    Kotlin,
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
            "c" => Language::C,
            // `.h` goes to C++: Unreal and most current headers are C++, and the C++ grammar
            // reads plain C headers well enough for highlighting.
            "h" | "cc" | "cpp" | "cxx" | "c++" | "hh" | "hpp" | "hxx" | "h++" | "inl" | "ipp"
            | "tpp" => Language::Cpp,
            "cs" | "csx" => Language::CSharp,
            "java" => Language::Java,
            "kt" | "kts" => Language::Kotlin,
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
            Language::C => "C",
            Language::Cpp => "C++",
            Language::CSharp => "C#",
            Language::Java => "Java",
            Language::Kotlin => "Kotlin",
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
            | Language::Json
            | Language::C
            | Language::Cpp
            | Language::CSharp
            | Language::Java
            | Language::Kotlin => Some(("//", "")),
            Language::Css => Some(("/*", "*/")),
            Language::Markdown | Language::Plain => None,
        }
    }

    pub(crate) fn default_indent_width(self) -> usize {
        match self {
            Language::Rust
            | Language::Plain
            | Language::Markdown
            | Language::C
            | Language::Cpp
            | Language::CSharp
            | Language::Java
            | Language::Kotlin => 4,
            _ => 2,
        }
    }

    /// Compiled grammar + highlight query, built once per process and shared by every document.
    pub(crate) fn highlight_config(self) -> Option<&'static HighlightConfig> {
        macro_rules! cached {
            () => {{
                static CELL: OnceLock<Option<HighlightConfig>> = OnceLock::new();
                CELL.get_or_init(|| {
                    let (language, queries) = self.grammar()?;
                    HighlightConfig::new(language, queries)
                })
                .as_ref()
            }};
        }
        match self {
            Language::TypeScript => cached!(),
            Language::Tsx => cached!(),
            Language::JavaScript | Language::Jsx => cached!(),
            Language::Json => cached!(),
            Language::Rust => cached!(),
            Language::Css => cached!(),
            Language::Markdown => cached!(),
            Language::C => cached!(),
            Language::Cpp => cached!(),
            Language::CSharp => cached!(),
            Language::Java => cached!(),
            Language::Kotlin => cached!(),
            Language::Plain => None,
        }
    }

    /// The grammar and the highlight query sources, in the order `HighlightConfig::new` joins
    /// them. On equal nodes the later pattern wins (see `highlight::paint`).
    fn grammar(self) -> Option<(tree_sitter::Language, &'static [&'static str])> {
        const JS: &str = tree_sitter_javascript::HIGHLIGHT_QUERY;
        const JSX: &str = tree_sitter_javascript::JSX_HIGHLIGHT_QUERY;
        const TS: &str = tree_sitter_typescript::HIGHLIGHTS_QUERY;
        const C: &str = tree_sitter_c::HIGHLIGHT_QUERY;
        let grammar: (tree_sitter::Language, &'static [&'static str]) = match self {
            // The TS query only lists what TS adds on top of JS, so JS goes first. The C++ query
            // lists only what C++ adds on top of C in the same way.
            Language::TypeScript => (
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
                &[JS, TS],
            ),
            Language::Tsx => (tree_sitter_typescript::LANGUAGE_TSX.into(), &[JS, JSX, TS]),
            Language::JavaScript | Language::Jsx => {
                (tree_sitter_javascript::LANGUAGE.into(), &[JS, JSX])
            }
            Language::Json => (
                tree_sitter_json::LANGUAGE.into(),
                &[tree_sitter_json::HIGHLIGHTS_QUERY],
            ),
            Language::Rust => (
                tree_sitter_rust::LANGUAGE.into(),
                &[tree_sitter_rust::HIGHLIGHTS_QUERY],
            ),
            Language::Css => (
                tree_sitter_css::LANGUAGE.into(),
                &[tree_sitter_css::HIGHLIGHTS_QUERY],
            ),
            // Only the block grammar: the inline grammar needs a second parser per document and
            // injected ranges, which is not worth it for README-style files.
            Language::Markdown => (
                tree_sitter_md::LANGUAGE.into(),
                &[tree_sitter_md::HIGHLIGHT_QUERY_BLOCK],
            ),
            Language::C => (tree_sitter_c::LANGUAGE.into(), &[C, C_EXTRA]),
            Language::Cpp => (
                tree_sitter_cpp::LANGUAGE.into(),
                &[C, tree_sitter_cpp::HIGHLIGHT_QUERY, C_EXTRA, CPP_EXTRA],
            ),
            Language::CSharp => (
                tree_sitter_c_sharp::LANGUAGE.into(),
                &[tree_sitter_c_sharp::HIGHLIGHTS_QUERY, CSHARP_EXTRA],
            ),
            Language::Java => (
                tree_sitter_java::LANGUAGE.into(),
                &[tree_sitter_java::HIGHLIGHTS_QUERY, JAVA_EXTRA],
            ),
            Language::Kotlin => (
                tree_sitter_kotlin_sg::LANGUAGE.into(),
                &[tree_sitter_kotlin_sg::HIGHLIGHTS_QUERY, KOTLIN_EXTRA],
            ),
            Language::Plain => return None,
        };
        Some(grammar)
    }
}

// Our additions to the grammar crates' own queries. They come last, so they win on equal nodes.

/// C and C++: literals the C query leaves plain or colors oddly (a char as a number), the
/// keywords and directives the C query misses, and macro names. A call whose name is in capitals,
/// with optional `_Word` parts, is a macro by convention (`UPROPERTY(...)`, `GENERATED_BODY()`,
/// `DECLARE_DELEGATE_OneParam(...)`). Without a `;` after it the next declaration can parse as a
/// function named like the macro, so a function declarator gets the same rule.
const C_EXTRA: &str = r##"
(char_literal) @string
(escape_sequence) @string.escape
[(true) (false)] @constant.builtin
[
 "#elifdef"
 "#elifndef"
] @keyword
[
 "goto" "register" "restrict" "__restrict__" "_Atomic" "_Noreturn" "noreturn" "thread_local"
 "_Alignas" "_Alignof" "alignof" "offsetof" "_Generic" "asm" "__asm__" "__attribute__"
 "__declspec" "__inline" "__extension__"
] @keyword
(preproc_def name: (identifier) @function.macro)
(preproc_function_def name: (identifier) @function.macro)
((call_expression function: (identifier) @function.macro)
 (#match? @function.macro "^[A-Z][A-Z0-9]*(_[A-Z0-9][A-Za-z0-9]*)*$"))
((function_declarator declarator: (identifier) @function.macro)
 (#match? @function.macro "^[A-Z][A-Z0-9]*(_[A-Z0-9][A-Za-z0-9]*)*$"))
"##;

/// C++ keywords the C++ query misses, and the shapes an Unreal class header takes after error
/// recovery: `UCLASS(...)` has no `;`, so `class MYGAME_API AMyActor : ... { ... }` parses as a
/// function named `AMyActor` that returns `class MYGAME_API`, and `public:` becomes a label.
const CPP_EXTRA: &str = r##"
["operator" "decltype" "static_assert" "alignas"] @keyword
((type_identifier) @function.macro (#match? @function.macro "^[A-Z][A-Z0-9_]*_API$"))
(function_definition type: (class_specifier) declarator: (identifier) @type)
((statement_identifier) @keyword (#any-of? @keyword "public" "protected" "private"))
(raw_string_literal) @string
(user_defined_literal (number_literal)) @number
"##;

/// C#: plain and generic calls, preprocessor directives, `[Attribute]` names with a namespace.
const CSHARP_EXTRA: &str = r##"
(invocation_expression function: (identifier) @function)
(invocation_expression function: (generic_name (identifier) @function))
(invocation_expression
  (member_access_expression name: (generic_name (identifier) @function)))
[
 "#define" "#elif" "#else" "#endif" "#endregion" "#error" "#if" "#line" "#nullable"
 "#pragma" "#region" "#undef" "#warning"
] @keyword
(attribute name: (qualified_name (identifier) @attribute))
"##;

/// Java: the `@` of an annotation in the annotation's color, not as an operator.
const JAVA_EXTRA: &str = r##"
(marker_annotation "@" @attribute)
(annotation "@" @attribute)
"##;

/// Kotlin: the `package` keyword, and the name of a function with modifiers. The Kotlin query
/// wants the name as the first child, but `@JvmStatic` or `private` come before it.
const KOTLIN_EXTRA: &str = r##"
(package_header "package" @keyword)
(function_declaration (simple_identifier) @function)
"##;

/// Maps a query capture name like `function.method` to a color class.
pub(crate) fn kind_for_capture(name: &str) -> Option<HlKind> {
    let kind = match name {
        "comment.documentation" => HlKind::DocComment,
        "variable.builtin" | "constant.builtin" | "boolean" => HlKind::Builtin,
        "variable.parameter" => HlKind::Parameter,
        "function.macro" | "function.special" => HlKind::Macro,
        "string.escape" => HlKind::Escape,
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
                "parameter" => HlKind::Parameter,
                "operator" => HlKind::Operator,
                "punctuation" | "delimiter" => HlKind::Punctuation,
                "tag" => HlKind::Tag,
                "attribute" => HlKind::Attribute,
                _ => return None,
            }
        }
    };
    Some(kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `HighlightConfig::new` drops a pattern that names a node the grammar lacks. Our own
    /// queries and the C query reused for C++ must compile whole, or colors vanish silently.
    #[test]
    fn new_language_queries_compile_whole() {
        for lang in [
            Language::C,
            Language::Cpp,
            Language::CSharp,
            Language::Java,
            Language::Kotlin,
        ] {
            let (language, queries) = lang.grammar().expect("has a grammar");
            if let Err(err) = tree_sitter::Query::new(&language, &queries.join("\n")) {
                panic!("{lang:?}: {err}");
            }
        }
    }
}
