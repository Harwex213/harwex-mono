//! Where the caret sits in a `package.json`: a dependency name or its version string.
//!
//! A small scanner over the text before the caret, not a JSON parser: it only tracks the
//! object nesting and the last key, and it accepts broken text (an unclosed string while the
//! user types).

use std::ops::Range;

/// The dependency sections that get completion.
pub const SECTIONS: [&str; 4] = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Slot {
    /// A key of a dependency section: a package name.
    Name,
    /// The value of the dependency `package`: a version range.
    Version { package: String },
}

/// The string under the caret, in a dependency section.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Site {
    pub slot: Slot,
    /// Char range between the quotes. For an unclosed string it ends where the typed token ends.
    pub content: Range<usize>,
    /// The string has its closing quote on the same line.
    pub closed: bool,
    /// The text from the opening quote to the caret.
    pub prefix: String,
}

struct Container {
    is_object: bool,
    /// The key this container is the value of.
    name: Option<String>,
    /// The last key read in this object.
    key: Option<String>,
    /// A `:` came after the last key: the next string is a value.
    in_value: bool,
}

/// The dependency string around char index `caret` of `text`, if any.
pub fn site_at(text: &str, caret: usize) -> Option<Site> {
    let chars: Vec<char> = text.chars().collect();
    if caret > chars.len() {
        return None;
    }
    let mut stack: Vec<Container> = Vec::new();
    let mut string_start: Option<usize> = None;
    let mut buf = String::new();
    let mut escaped = false;
    for (i, &c) in chars[..caret].iter().enumerate() {
        if let Some(_start) = string_start {
            if escaped {
                escaped = false;
                buf.push(c);
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' || c == '\n' {
                string_start = None;
                if let Some(top) = stack.last_mut() {
                    if top.is_object && !top.in_value {
                        top.key = Some(std::mem::take(&mut buf));
                    } else if c == '\n' && top.is_object {
                        // A line break ends a broken value: JSON strings never span lines, and
                        // the next line starts the next entry.
                        top.in_value = false;
                        top.key = None;
                    }
                }
                buf.clear();
            } else {
                buf.push(c);
            }
            continue;
        }
        match c {
            '"' => {
                string_start = Some(i + 1);
                buf.clear();
            }
            '{' | '[' => {
                let name = stack.last().filter(|t| t.is_object && t.in_value).and_then(|t| t.key.clone());
                stack.push(Container { is_object: c == '{', name, key: None, in_value: false });
            }
            '}' | ']' => {
                stack.pop();
            }
            ':' => {
                if let Some(top) = stack.last_mut() {
                    top.in_value = true;
                }
            }
            ',' => {
                if let Some(top) = stack.last_mut() {
                    top.in_value = false;
                    top.key = None;
                }
            }
            _ => {}
        }
    }
    let start = string_start?;
    // The root object, then a dependency section object, then the string.
    if stack.len() != 2 || !stack[0].is_object || !stack[1].is_object {
        return None;
    }
    let section = &stack[1];
    if !section.name.as_deref().is_some_and(|n| SECTIONS.contains(&n)) {
        return None;
    }
    let slot = if section.in_value { Slot::Version { package: section.key.clone()? } } else { Slot::Name };
    let (end, closed) = string_end(&chars, caret);
    Some(Site { slot, content: start..end, closed, prefix: chars[start..caret].iter().collect() })
}

/// The closing quote at or after `from` on the same line, or the end of the typed token.
fn string_end(chars: &[char], from: usize) -> (usize, bool) {
    let mut escaped = false;
    for (i, &c) in chars.iter().enumerate().skip(from) {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            '"' => return (i, true),
            '\n' => break,
            _ => {}
        }
    }
    let end = chars[from..].iter().position(|c| c.is_whitespace() || matches!(c, ',' | '}' | ']' | ':')).map_or(chars.len(), |n| from + n);
    (end, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The site at the `|` in `text`.
    fn at(text: &str) -> Option<Site> {
        let caret = text.chars().position(|c| c == '|').expect("caret mark");
        let clean: String = text.chars().filter(|&c| c != '|').collect();
        site_at(&clean, caret)
    }

    #[test]
    fn version_of_a_dependency() {
        let s = at("{\n  \"dependencies\": {\n    \"lodash\": \"^4.1|7.0\"\n  }\n}").expect("site");
        assert_eq!(s.slot, Slot::Version { package: "lodash".into() });
        assert_eq!(s.prefix, "^4.1");
        assert!(s.closed);
        assert_eq!(s.content.end - s.content.start, "^4.17.0".len());
    }

    #[test]
    fn name_in_each_section() {
        for section in SECTIONS {
            let s = at(&format!("{{\"name\": \"x\", \"{section}\": {{\"a\": \"1\", \"re|\"}}}}")).expect(section);
            assert_eq!(s.slot, Slot::Name);
            assert_eq!(s.prefix, "re");
        }
    }

    #[test]
    fn outside_dependency_strings() {
        assert_eq!(at("{\"name\": \"lo|\"}"), None);
        assert_eq!(at("{\"scripts\": {\"lo|\": \"x\"}}"), None);
        assert_eq!(at("{\"dependencies\": {\"lodash\": |\"1\"}}"), None);
        assert_eq!(at("{\"dependencies\": {\"lodash\": \"1\"|}}"), None);
        // Nested deeper (an `overrides`-like object under dependencies).
        assert_eq!(at("{\"dependencies\": {\"a\": {\"b|\": \"1\"}}}"), None);
        assert_eq!(at("{\"x\": {\"dependencies\": {\"a|\": \"1\"}}}"), None);
    }

    #[test]
    fn unclosed_string_while_typing() {
        let s = at("{\n  \"devDependencies\": {\n    \"react\": \"^1|\n  }\n}").expect("site");
        assert_eq!(s.slot, Slot::Version { package: "react".into() });
        assert!(!s.closed);
        assert_eq!(s.prefix, "^1");
        let s = at("{\n  \"devDependencies\": {\n    \"rea|\n  }\n}").expect("site");
        assert_eq!(s.slot, Slot::Name);
        // A broken line above does not shift the next key.
        let s = at("{\n  \"dependencies\": {\n    \"a\": \"1,\n    \"b\": \"|\"\n  }\n}").expect("site");
        assert_eq!(s.slot, Slot::Version { package: "b".into() });
    }

    #[test]
    fn scoped_and_escaped_names() {
        let s = at("{\"dependencies\": {\"@types/node\": \"2|\"}}").expect("site");
        assert_eq!(s.slot, Slot::Version { package: "@types/node".into() });
        let s = at("{\"dependencies\": {\"a\\\"b\": \"|\"}}").expect("site");
        assert_eq!(s.slot, Slot::Version { package: "a\"b".into() });
    }
}
