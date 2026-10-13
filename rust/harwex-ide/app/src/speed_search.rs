//! IDEA's speed search, shared by the breadcrumb popups and the trees (Project, Commit, the Git
//! window's changed files): the name matcher, the highlighted name, the keys and the field that
//! shows the typed text.

use egui::{pos2, vec2, Color32, FontId, Id, Key, Painter, Rect, Sense, Stroke, Ui};

use crate::icons::{self, Icon};
use crate::theme;

/// Where `query` matches `name`, as char indices into `name`, or `None`.
/// Case is ignored. A contiguous match wins: the leftmost one that starts a word, else the
/// leftmost. Otherwise the query's chars match in order, each as early as possible.
pub fn matches(name: &str, query: &str) -> Option<Vec<usize>> {
    let fold = |c: char| c.to_lowercase().next().unwrap_or(c);
    let chars: Vec<char> = name.chars().collect();
    let low: Vec<char> = chars.iter().map(|&c| fold(c)).collect();
    let q: Vec<char> = query.chars().map(fold).collect();
    if q.is_empty() {
        return Some(Vec::new());
    }
    if q.len() <= low.len() {
        let starts: Vec<usize> = (0..=low.len() - q.len()).filter(|&i| low[i..i + q.len()] == q[..]).collect();
        let word_start = |i: usize| i == 0 || !chars[i - 1].is_alphanumeric() || (chars[i].is_uppercase() && chars[i - 1].is_lowercase());
        if let Some(&i) = starts.iter().find(|&&i| word_start(i)).or(starts.first()) {
            return Some((i..i + q.len()).collect());
        }
    }
    let mut out = Vec::with_capacity(q.len());
    let mut at = 0;
    for c in q {
        let i = at + low[at..].iter().position(|&l| l == c)?;
        out.push(i);
        at = i + 1;
    }
    Some(out)
}

/// A name with the matched chars (`hits`, sorted) highlighted.
pub fn name_job(name: &str, hits: &[usize], font: FontId, color: Color32) -> egui::text::LayoutJob {
    let mut job = egui::text::LayoutJob::default();
    let plain = egui::TextFormat { font_id: font.clone(), color, ..Default::default() };
    let matched = egui::TextFormat { font_id: font, color: theme::T.text_bright, background: theme::T.match_text.gamma_multiply(0.45), ..Default::default() };
    let mut run = String::new();
    let mut run_hit = false;
    for (i, c) in name.chars().enumerate() {
        let hit = hits.binary_search(&i).is_ok();
        if hit != run_hit && !run.is_empty() {
            job.append(&std::mem::take(&mut run), 0.0, if run_hit { matched.clone() } else { plain.clone() });
        }
        run_hit = hit;
        run.push(c);
    }
    job.append(&run, 0.0, if run_hit { matched } else { plain });
    job
}

/// The width a field needs for `text`: the search icon, the text, the caret and a margin.
pub fn field_width(painter: &Painter, text: &str, font: FontId) -> f32 {
    22.0 + painter.layout_no_wrap(text.to_string(), font, theme::T.text_bright).size().x + 10.0
}

/// Paints the speed search field into `field`: the typed text and a caret, drawn red when
/// nothing matches. The caller gives it the a11y node `Speed search <text>`.
pub fn paint_field(painter: &Painter, field: Rect, text: &str, found: bool, font: FontId) {
    let t = &theme::T;
    painter.rect_filled(field, t.radius.row, t.input_bg);
    painter.rect_stroke(field, t.radius.row, Stroke::new(1.0_f32, if found { t.accent } else { t.error }), egui::StrokeKind::Inside);
    let cy = field.center().y;
    icons::paint(painter, Rect::from_center_size(pos2(field.min.x + 11.0, cy), vec2(12.0, 12.0)), Icon::Search, t.text_dim);
    let galley = painter.layout_no_wrap(text.to_string(), font, if found { t.text_bright } else { t.error });
    let x = field.min.x + 22.0;
    let caret_x = (x + galley.size().x + 1.0).min(field.max.x - 4.0);
    painter.with_clip_rect(field.shrink(2.0)).galley(pos2(x, cy - galley.size().y / 2.0), galley, t.text_bright);
    painter.line_segment([pos2(caret_x, cy - 6.0), pos2(caret_x, cy + 6.0)], Stroke::new(1.0_f32, t.text_bright));
}

/// What the speed search keys of a tree asked for this frame.
#[derive(Default)]
pub struct Keys {
    /// The text changed: move to the best match.
    pub changed: bool,
    pub up: bool,
    pub down: bool,
    /// Enter acts on the selected row (the tree's own Enter) and ends the search.
    pub enter: bool,
}

impl Keys {
    /// Whether the selection should move to a match this frame.
    pub fn moves(&self) -> bool {
        self.changed || self.up || self.down
    }
}

/// The speed search keys of a focused tree, like IDEA. Typed text starts or extends the
/// search. While it runs, Backspace edits it, Escape clears it and Up/Down move between the
/// matches. Enter is only read, so the tree's own Enter still acts. Call it before the tree's
/// own keys: they read Backspace, Escape and the arrows too.
pub fn take_keys(ui: &Ui, search: &mut String) -> Keys {
    let none = egui::Modifiers::NONE;
    ui.input_mut(|i| {
        let mut out = Keys::default();
        // Text typed with Cmd, Ctrl or Alt belongs to a shortcut (Alt+C types "ç" on macOS).
        if !(i.modifiers.command || i.modifiers.ctrl || i.modifiers.alt) {
            i.events.retain(|e| match e {
                egui::Event::Text(t) => {
                    for c in t.chars().filter(|c| !c.is_control()) {
                        // A search never starts with a space.
                        if !(search.is_empty() && c.is_whitespace()) {
                            search.push(c);
                            out.changed = true;
                        }
                    }
                    false
                }
                _ => true,
            });
        }
        if search.is_empty() {
            return out;
        }
        if i.consume_key(none, Key::Escape) {
            search.clear();
            return out;
        }
        if i.consume_key(none, Key::Backspace) {
            search.pop();
            out.changed = true;
        }
        // consume_key ignores an extra Shift; Shift+arrows still extend the selection.
        if !i.modifiers.shift {
            out.up = i.consume_key(none, Key::ArrowUp);
            out.down = i.consume_key(none, Key::ArrowDown);
        }
        out.enter = i.key_pressed(Key::Enter);
        out
    })
}

/// The match the selection moves to. `hits` are the matching rows in display order, `cur` is
/// the selected row. After a text change the selected row stays while it matches, else the
/// first match is taken. Up/Down go to the previous/next match and wrap around. `None` when
/// nothing matches.
pub fn step(hits: &[usize], cur: Option<usize>, keys: &Keys) -> Option<usize> {
    let (&first, &last) = (hits.first()?, hits.last()?);
    Some(if keys.up {
        cur.and_then(|c| hits.iter().rev().find(|&&i| i < c).copied()).unwrap_or(last)
    } else if keys.down {
        cur.and_then(|c| hits.iter().find(|&&i| i > c).copied()).unwrap_or(first)
    } else {
        cur.filter(|c| hits.contains(c)).unwrap_or(first)
    })
}

/// A tree's field is at least this wide, so a short text does not look lost.
const FIELD_MIN_W: f32 = 120.0;

/// Paints a tree's speed search field over the left part of `row` (a row that is not a tree
/// item: the root row, a toolbar), with the a11y node `Speed search <text>`. The node takes
/// clicks, so a press on the field never reaches a button under it.
pub fn tree_field(ui: &Ui, row: Rect, text: &str, found: bool, id: Id) {
    let t = &theme::T;
    let font = t.ui_font();
    ui.painter().rect_filled(row, 0.0, t.island_bg);
    let w = field_width(ui.painter(), text, font.clone()).max(FIELD_MIN_W).min(row.width() - 8.0);
    let field = Rect::from_min_size(pos2(row.min.x + 4.0, row.min.y + 1.0), vec2(w, row.height() - 2.0));
    paint_field(ui.painter(), field, text, found, font);
    let node = ui.interact(row, id, Sense::click());
    crate::util::label_widget(&node, egui::WidgetType::TextEdit, format!("Speed search {text}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_like_idea() {
        assert_eq!(matches("util.ts", ""), Some(vec![]));
        assert_eq!(matches("App.ts", "app"), Some(vec![0, 1, 2]), "case is ignored");
        // A contiguous match at a word start beats an earlier one inside a word.
        assert_eq!(matches("snapshot_shot.rs", "shot"), Some(vec![9, 10, 11, 12]));
        assert_eq!(matches("reshaped", "shape"), Some(vec![2, 3, 4, 5, 6]), "leftmost without a word start");
        assert_eq!(matches("myFileName", "name"), Some(vec![6, 7, 8, 9]), "camel hump");
        // Chars in order, not contiguous.
        assert_eq!(matches("tsconfig.json", "tcj"), Some(vec![0, 2, 9]));
        assert_eq!(matches("util.ts", "x"), None);
        assert_eq!(matches("ab", "ba"), None, "order matters");
    }

    #[test]
    fn step_stays_moves_and_wraps() {
        let typed = Keys { changed: true, ..Keys::default() };
        let up = Keys { up: true, ..Keys::default() };
        let down = Keys { down: true, ..Keys::default() };
        assert_eq!(step(&[], Some(1), &typed), None);
        assert_eq!(step(&[2, 5, 9], Some(5), &typed), Some(5), "a matching row stays");
        assert_eq!(step(&[2, 5, 9], Some(4), &typed), Some(2), "else the first match");
        assert_eq!(step(&[2, 5, 9], Some(5), &down), Some(9));
        assert_eq!(step(&[2, 5, 9], Some(9), &down), Some(2), "Down wraps");
        assert_eq!(step(&[2, 5, 9], Some(2), &up), Some(9), "Up wraps");
        assert_eq!(step(&[2, 5, 9], None, &down), Some(2));
    }
}
