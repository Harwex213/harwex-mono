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
    Glsl,
    Yaml,
    Dockerfile,
    /// `.conf`, `.ini`, `.properties`, `.env` and similar `key = value` files. No grammar fits
    /// them all, so `conf.rs` colors each line on its own.
    Conf,
    Plain,
}

impl Language {
    /// tree-sitter-yaml's scanner keeps rows in `int16_t`. Past this line its row compare
    /// wraps, and the rest of the file parses as one error node. Longer YAML files (lockfiles)
    /// get no tree and are colored line by line (`conf::yaml_spans`).
    pub const YAML_MAX_TREE_LINES: usize = 32_767;

    /// Whether a document of this language with `line_count` lines is colored by a line lexer
    /// (`conf.rs`) instead of a tree.
    pub(crate) fn line_lexed(self, line_count: usize) -> bool {
        match self {
            Language::Conf => true,
            Language::Yaml => line_count > Language::YAML_MAX_TREE_LINES,
            _ => false,
        }
    }

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
            "glsl" | "vert" | "frag" | "geom" | "comp" | "tesc" | "tese" => Language::Glsl,
            "yaml" | "yml" => Language::Yaml,
            "dockerfile" | "containerfile" => Language::Dockerfile,
            "conf" | "cfg" | "ini" | "properties" | "env" | "editorconfig" | "gitconfig" | "npmrc" => {
                Language::Conf
            }
            _ => {
                // Dotfiles like `.eslintrc` or `tsconfig` variants without an extension.
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let lower = name.to_ascii_lowercase();
                match name {
                    ".babelrc" | ".eslintrc" | ".prettierrc" => Language::Json,
                    ".clang-format" | ".clang-tidy" | ".yamllint" => Language::Yaml,
                    ".env" | ".editorconfig" | ".gitconfig" | ".gitmodules" | ".npmrc" | ".yarnrc" => {
                        Language::Conf
                    }
                    // `.env.local`, `.env.production`: the extension is the environment name.
                    _ if name.starts_with(".env.") => Language::Conf,
                    // `Dockerfile.dev`: the extension is the variant name.
                    _ if lower == "dockerfile"
                        || lower == "containerfile"
                        || lower.starts_with("dockerfile.")
                        || lower.starts_with("containerfile.") =>
                    {
                        Language::Dockerfile
                    }
                    // The C++ standard library headers have no extension (`c++/v1/vector`).
                    _ if ext.is_empty() && path.components().any(|c| c.as_os_str() == "c++") => Language::Cpp,
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
            Language::Glsl => "GLSL",
            Language::Yaml => "YAML",
            Language::Dockerfile => "Dockerfile",
            Language::Conf => "Config",
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
            | Language::Kotlin
            | Language::Glsl => Some(("//", "")),
            Language::Css => Some(("/*", "*/")),
            Language::Yaml | Language::Dockerfile | Language::Conf => Some(("#", "")),
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
            | Language::Kotlin
            | Language::Glsl
            | Language::Dockerfile
            | Language::Conf => 4,
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
            Language::Glsl => cached!(),
            Language::Yaml => cached!(),
            Language::Dockerfile => cached!(),
            Language::Conf | Language::Plain => None,
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
                &[tree_sitter_json::HIGHLIGHTS_QUERY, JSON_EXTRA],
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
                &[tree_sitter_md::HIGHLIGHT_QUERY_BLOCK, MARKDOWN_EXTRA],
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
            // The grammar crate's own query is written for Neovim (`#lua-match?`, which tree-sitter
            // here ignores, so every identifier would match it), so only the C query plus ours.
            Language::Glsl => (tree_sitter_glsl::LANGUAGE_GLSL.into(), &[C, C_EXTRA, GLSL_EXTRA]),
            Language::Yaml => (
                tree_sitter_yaml::LANGUAGE.into(),
                &[tree_sitter_yaml::HIGHLIGHTS_QUERY, YAML_EXTRA],
            ),
            // The shell after `RUN` stays plain: the grammar's query injects bash, and a document
            // here has one parser.
            Language::Dockerfile => (
                tree_sitter_containerfile::LANGUAGE.into(),
                &[tree_sitter_containerfile::HIGHLIGHTS_QUERY, DOCKERFILE_EXTRA],
            ),
            Language::Conf | Language::Plain => return None,
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

/// GLSL on top of the C query: storage and precision qualifiers, `layout`, the extension
/// directive, and the `gl_` built-in variables. Vector, matrix and sampler types are type names
/// to the grammar, so they already get the type color.
const GLSL_EXTRA: &str = r##"
[
 "in" "out" "inout" "uniform" "shared" "layout" "attribute" "varying" "buffer" "coherent"
 "readonly" "writeonly" "precision" "highp" "mediump" "lowp" "centroid" "sample" "patch"
 "smooth" "flat" "noperspective" "invariant" "precise" "subroutine"
] @keyword
(extension_storage_class) @keyword
(extension_behavior) @keyword
(preproc_extension directive: (preproc_directive) @keyword)
(qualifier . (identifier) @attribute)
((identifier) @variable.builtin (#match? @variable.builtin "^gl_"))
"##;

/// JSON keys in the property color, as in IDEA. The grammar's query marks a key as
/// `string.special.key` first and then every `(string)` as a string, and the later pattern wins
/// on the same node, so the key needs a rule after both.
const JSON_EXTRA: &str = r##"
(pair key: (string) @property)
"##;

/// YAML: keys in the JSON key color, also keys that look like a number or a boolean (`1:`,
/// `true:`); anchors and aliases with their `&`/`*` as one token; tags, directives and the
/// document markers as keywords; escapes. The grammar's query paints `&`, `*`,
/// `---` and `...` as plain punctuation and anchors as labels, which have no color here.
const YAML_EXTRA: &str = r##"
(escape_sequence) @string.escape
(block_mapping_pair key: (flow_node (plain_scalar (_) @property)))
(flow_pair key: (flow_node (plain_scalar (_) @property)))
(flow_pair key: (flow_node [(double_quote_scalar) (single_quote_scalar)] @property))
[(anchor) (alias) (anchor_name) (alias_name)] @type
(anchor "&" @type)
(alias "*" @type)
(tag) @keyword
["---" "..."] @keyword
[(yaml_directive) (tag_directive) (reserved_directive)] @keyword
"##;

/// Dockerfile: `$VAR` and `${VAR}` as one token in any case (the grammar's query colors only
/// upper-case names and leaves `$`, `{`, `}` plain), whole flags like `--from=builder` (the
/// grammar's flag name is a hidden token, so the query cannot reach it alone), the stage name
/// after `AS`, and the heredoc markers. The grammar's heredoc markers are labels, which have no
/// color here.
const DOCKERFILE_EXTRA: &str = r##"
(expansion) @constant
(expansion ["$" "{" "}"] @constant)
(expansion (variable) @constant)
[(param) (mount_param)] @property
(image_alias) @type
[(heredoc_marker) (heredoc_end)] @keyword
"##;

/// Markdown: the nodes whose text may hold `inline code`. The block grammar has no code spans,
/// so `highlight_lines` finds them inside these nodes itself (`highlight::CODE_SCOPE`).
const MARKDOWN_EXTRA: &str = r##"
(inline) @_code_scope
(pipe_table_cell) @_code_scope
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
            Language::Glsl,
            Language::Json,
            Language::Markdown,
            Language::Yaml,
            Language::Dockerfile,
        ] {
            let (language, queries) = lang.grammar().expect("has a grammar");
            if let Err(err) = tree_sitter::Query::new(&language, &queries.join("\n")) {
                panic!("{lang:?}: {err}");
            }
        }
    }

    #[test]
    fn std_headers_without_extension_are_cpp() {
        assert_eq!(Language::from_path(Path::new("/sdk/usr/include/c++/v1/vector")), Language::Cpp);
        assert_eq!(Language::from_path(Path::new("/p/include/vector")), Language::Plain);
        assert_eq!(Language::from_path(Path::new("/p/c++/README.md")), Language::Markdown);
    }
}
