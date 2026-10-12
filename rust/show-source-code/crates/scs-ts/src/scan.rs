//! Finds module specifiers (`from "x"`, `import "x"`, `import("x")`, `require("x")`) and their
//! positions. Only a light tokenizer: comments and strings are skipped so that quotes inside
//! them do not confuse it. It does not resolve anything; tsserver does.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Specifier {
    pub text: String,
    /// 0-based line of the first char inside the quotes.
    pub line: usize,
    /// 0-based column of that char, in UTF-16 units (tsserver's unit).
    pub col_utf16: usize,
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Word(String),
    Punct(char),
    Value,
}

pub fn scan_imports(text: &str) -> Vec<Specifier> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let (mut i, mut line, mut col) = (0usize, 0usize, 0usize);
    let (mut prev1, mut prev2) = (Tok::Value, Tok::Value);
    // Advances one char, keeping line and UTF-16 column.
    macro_rules! bump {
        () => {{
            let c = chars[i];
            i += 1;
            if c == '\n' {
                line += 1;
                col = 0;
            } else {
                col += c.len_utf16();
            }
        }};
    }
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c.is_whitespace() {
            bump!();
        } else if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i] != '\n' {
                bump!();
            }
        } else if c == '/' && next == Some('*') {
            bump!();
            bump!();
            while i < chars.len() && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                bump!();
            }
            if i < chars.len() {
                bump!();
                bump!();
            }
        } else if c == '"' || c == '\'' || c == '`' {
            let (start_line, start_col) = (line, col + 1);
            bump!();
            let mut s = String::new();
            while i < chars.len() && chars[i] != c && !(c != '`' && chars[i] == '\n') {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    bump!();
                }
                s.push(chars[i]);
                bump!();
            }
            if i < chars.len() {
                bump!();
            }
            let is_spec = c != '`'
                && match (&prev2, &prev1) {
                    (_, Tok::Word(w)) if w == "from" || w == "import" => true,
                    (Tok::Word(w), Tok::Punct('(')) if w == "import" || w == "require" => true,
                    _ => false,
                };
            if is_spec {
                out.push(Specifier { text: s, line: start_line, col_utf16: start_col });
            }
            prev2 = std::mem::replace(&mut prev1, Tok::Value);
        } else if c.is_alphanumeric() || c == '_' || c == '$' {
            let mut w = String::new();
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '$') {
                w.push(chars[i]);
                bump!();
            }
            prev2 = std::mem::replace(&mut prev1, Tok::Word(w));
        } else {
            bump!();
            prev2 = std::mem::replace(&mut prev1, Tok::Punct(c));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(src: &str) -> Vec<String> {
        scan_imports(src).into_iter().map(|s| s.text).collect()
    }

    #[test]
    fn finds_every_import_form() {
        let src = r#"
import a from "a";
import { b } from '@s/b';
import "side-effect";
export * from "./re";
export { c } from "c/deep";
const d = await import("d");
const e = require('e');
import type { F } from "f";
"#;
        assert_eq!(texts(src), ["a", "@s/b", "side-effect", "./re", "c/deep", "d", "e", "f"]);
    }

    #[test]
    fn ignores_comments_strings_and_properties() {
        let src = r#"
// import x from "commented";
/* import y from "block" */
const s = "from 'not-this'";
const o = { from: "nope", import: "no" };
const t = `import z from "tpl"`;
"#;
        assert!(texts(src).is_empty(), "{:?}", texts(src));
    }

    #[test]
    fn positions_are_utf16_and_point_inside_the_quotes() {
        let src = "const ü = 1; // 😀\nimport a from \"pkg\";";
        let s = &scan_imports(src)[0];
        assert_eq!((s.line, s.col_utf16), (1, 15));
        let src = "/* 😀 */ import a from \"pkg\";";
        assert_eq!(scan_imports(src)[0].col_utf16, 24);
    }
}
