//! Version ordering and the rows of the version completion list.

use std::cmp::Ordering;
use std::collections::HashSet;

/// Rows above this are not built: nobody scrolls through thousands of nightly builds.
pub const MAX_ITEMS: usize = 500;

/// A package's versions and dist-tags, as the registry lists them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PackageInfo {
    /// Newest first (`sort_desc`).
    pub versions: Vec<String>,
    /// `(tag, version)`: `latest` first, then `next`, then the rest by name.
    pub dist_tags: Vec<(String, String)>,
}

impl PackageInfo {
    pub fn new(mut versions: Vec<String>, mut dist_tags: Vec<(String, String)>) -> PackageInfo {
        sort_desc(&mut versions);
        dist_tags.sort_by(|a, b| tag_rank(&a.0).cmp(&tag_rank(&b.0)).then_with(|| a.0.cmp(&b.0)));
        PackageInfo { versions, dist_tags }
    }
}

fn tag_rank(tag: &str) -> u8 {
    match tag {
        "latest" => 0,
        "next" => 1,
        _ => 2,
    }
}

/// One completion row: `label` is the inserted text, `detail` the dim text on the right.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub label: String,
    pub detail: String,
}

/// A semver version, split for ordering. Text that is not semver orders below every version.
#[derive(Debug, PartialEq, Eq)]
struct Semver<'a> {
    core: [u64; 3],
    pre: Option<&'a str>,
}

fn parse(v: &str) -> Option<Semver<'_>> {
    let v = v.split('+').next().unwrap_or(v);
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let core = [parts.next()??, parts.next()??, parts.next()??];
    if parts.next().is_some() {
        return None;
    }
    Some(Semver { core, pre })
}

/// semver precedence of two pre-release strings (`alpha.10` > `alpha.9`).
fn cmp_pre(a: &str, b: &str) -> Ordering {
    let mut ia = a.split('.');
    let mut ib = b.split('.');
    loop {
        match (ia.next(), ib.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) => {
                let o = match (x.parse::<u64>(), y.parse::<u64>()) {
                    (Ok(x), Ok(y)) => x.cmp(&y),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    (Err(_), Err(_)) => x.cmp(y),
                };
                if o != Ordering::Equal {
                    return o;
                }
            }
        }
    }
}

fn cmp_versions(a: &str, b: &str) -> Ordering {
    match (parse(a), parse(b)) {
        (Some(x), Some(y)) => x.core.cmp(&y.core).then_with(|| match (x.pre, y.pre) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(p), Some(q)) => cmp_pre(p, q),
        }),
        (Some(_), None) => Ordering::Greater,
        (None, Some(_)) => Ordering::Less,
        (None, None) => a.cmp(b),
    }
}

/// Newest first, by semver precedence.
pub fn sort_desc(versions: &mut [String]) {
    versions.sort_by(|a, b| cmp_versions(b, a));
}

fn is_prerelease(v: &str) -> bool {
    parse(v).is_some_and(|s| s.pre.is_some())
}

/// The rows for a version string that starts with `typed`.
///
/// The dist-tags come first, each as `^v`, `~v` and `v` (or only with the range operator the
/// user typed). Then every version, newest first, with the typed operator. Pre-releases show
/// only behind a dist-tag or once the typed text has a `-`.
pub fn version_items(info: &PackageInfo, typed: &str) -> Vec<Item> {
    let op_len = typed.find(|c: char| !matches!(c, '^' | '~' | '>' | '<' | '=' | ' ')).unwrap_or(typed.len());
    let (op, rest) = typed.split_at(op_len);
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |items: &mut Vec<Item>, label: String, detail: String| {
        if items.len() < MAX_ITEMS && seen.insert(label.clone()) {
            items.push(Item { label, detail });
        }
    };
    for (tag, v) in &info.dist_tags {
        if !v.starts_with(rest) {
            continue;
        }
        if op.is_empty() {
            for o in ["^", "~", ""] {
                push(&mut items, format!("{o}{v}"), tag.clone());
            }
        } else {
            push(&mut items, format!("{op}{v}"), tag.clone());
        }
    }
    let pre = rest.contains('-');
    for v in &info.versions {
        if !v.starts_with(rest) || (is_prerelease(v) && !pre) {
            continue;
        }
        let tags: Vec<&str> = info.dist_tags.iter().filter(|(_, t)| t == v).map(|(n, _)| n.as_str()).collect();
        push(&mut items, format!("{op}{v}"), tags.join(", "));
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn semver_order() {
        let mut v = s(&["1.0.0", "1.10.0", "1.2.0", "2.0.0-beta.10", "2.0.0-beta.9", "2.0.0-alpha", "2.0.0", "0.9.9", "garbage"]);
        sort_desc(&mut v);
        assert_eq!(v, s(&["2.0.0", "2.0.0-beta.10", "2.0.0-beta.9", "2.0.0-alpha", "1.10.0", "1.2.0", "1.0.0", "0.9.9", "garbage"]));
    }

    fn info() -> PackageInfo {
        PackageInfo::new(
            s(&["4.17.20", "4.17.21", "5.0.0-rc.1", "3.10.1", "4.2.0"]),
            vec![("next".into(), "5.0.0-rc.1".into()), ("latest".into(), "4.17.21".into())],
        )
    }

    fn labels(items: &[Item]) -> Vec<&str> {
        items.iter().map(|i| i.label.as_str()).collect()
    }

    #[test]
    fn tags_then_versions() {
        let items = version_items(&info(), "");
        assert_eq!(
            labels(&items),
            ["^4.17.21", "~4.17.21", "4.17.21", "^5.0.0-rc.1", "~5.0.0-rc.1", "5.0.0-rc.1", "4.17.20", "4.2.0", "3.10.1"]
        );
        assert_eq!(items[0].detail, "latest");
        assert_eq!(items[3].detail, "next");
    }

    #[test]
    fn typed_operator_and_prefix() {
        assert_eq!(labels(&version_items(&info(), "^4.1")), ["^4.17.21", "^4.17.20"]);
        assert_eq!(labels(&version_items(&info(), "~3")), ["~3.10.1"]);
        assert_eq!(labels(&version_items(&info(), "5.0.0-")), ["^5.0.0-rc.1", "~5.0.0-rc.1", "5.0.0-rc.1"]);
        assert_eq!(labels(&version_items(&info(), "4.2")), ["4.2.0"]);
        assert!(version_items(&info(), "9").is_empty());
    }
}
