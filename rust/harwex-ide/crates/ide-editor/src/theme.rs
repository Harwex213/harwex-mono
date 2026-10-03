//! Editor colors. The app builds its own theme from these fields; the constructors here are the
//! defaults for the example binary and for tests.

use std::hash::{DefaultHasher, Hash, Hasher};

use egui::Color32;

use crate::highlight::HlKind;

#[derive(Clone, Debug, PartialEq)]
pub struct EditorTheme {
    pub background: Color32,
    pub foreground: Color32,
    pub gutter_background: Color32,
    /// The line between the gutter and the text. Equal to the background when there is none.
    pub gutter_separator: Color32,
    pub line_number: Color32,
    pub line_number_current: Color32,
    pub current_line: Color32,
    pub selection: Color32,
    pub caret: Color32,
    pub link: Color32,
    pub annotation: Color32,
    pub mark_added: Color32,
    pub mark_modified: Color32,
    pub mark_deleted: Color32,
    /// Find bar: a match in the text, the current match while In Selection keeps the
    /// selection, the outline of an excluded match and the marks on the scrollbar.
    pub find_match: Color32,
    pub find_current: Color32,
    pub find_excluded: Color32,
    pub find_scroll_mark: Color32,
    /// Scrollbar marks of the carets when there are several.
    pub caret_scroll_mark: Color32,
    /// Find bar surfaces: the bar, its bottom line, the input fields and their borders (the
    /// focused one, and the fill of a query without matches).
    pub find_bar: Color32,
    pub find_bar_border: Color32,
    pub find_field: Color32,
    pub find_field_border: Color32,
    pub find_field_focus: Color32,
    pub find_field_no_match: Color32,
    /// Find bar text, dimmed text (hints, counter), icons, hover fill, an active toggle's fill
    /// and the error text of a bad regex.
    pub find_text: Color32,
    pub find_text_dim: Color32,
    pub find_icon: Color32,
    pub find_hover: Color32,
    pub find_toggle_on: Color32,
    pub find_error: Color32,
    /// Indexed by `HlKind as usize`.
    pub kinds: [Color32; HlKind::COUNT],
}

impl Default for EditorTheme {
    fn default() -> Self {
        EditorTheme::islands_dark()
    }
}

const fn hex(v: u32) -> Color32 {
    Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)
}

impl EditorTheme {
    /// IntelliJ IDEA 2025 "Islands Dark" (the New UI "Dark" editor scheme).
    pub const fn islands_dark() -> EditorTheme {
        let fg = hex(0xBCBEC4);
        let mut kinds = [fg; HlKind::COUNT];
        kinds[HlKind::Keyword as usize] = hex(0xCF8E6D);
        kinds[HlKind::String as usize] = hex(0x6AAB73);
        kinds[HlKind::Escape as usize] = hex(0xCF8E6D);
        kinds[HlKind::Number as usize] = hex(0x2AACB8);
        kinds[HlKind::Comment as usize] = hex(0x7A7E85);
        kinds[HlKind::DocComment as usize] = hex(0x5F826B);
        kinds[HlKind::Function as usize] = hex(0x56A8F5);
        kinds[HlKind::Macro as usize] = hex(0x56A8F5);
        kinds[HlKind::Type as usize] = hex(0x16BAAC);
        kinds[HlKind::Property as usize] = hex(0xC77DBB);
        kinds[HlKind::Constant as usize] = hex(0xC77DBB);
        kinds[HlKind::Builtin as usize] = hex(0xCF8E6D);
        kinds[HlKind::Tag as usize] = hex(0xD5B778);
        kinds[HlKind::Attribute as usize] = hex(0xBABABA);
        kinds[HlKind::Title as usize] = hex(0xCF8E6D);
        kinds[HlKind::Link as usize] = hex(0x548AF7);
        EditorTheme {
            background: hex(0x1E1F22),
            foreground: fg,
            gutter_background: hex(0x1E1F22),
            gutter_separator: hex(0x1E1F22),
            line_number: hex(0x4B5059),
            line_number_current: hex(0xA1A3AB),
            current_line: hex(0x26282E),
            selection: hex(0x214283),
            caret: hex(0xCED0D6),
            link: hex(0x548AF7),
            annotation: hex(0x868A91),
            mark_added: hex(0x549159),
            mark_modified: hex(0x375FAD),
            mark_deleted: hex(0x868A91),
            find_match: hex(0x32593D),
            find_current: hex(0x4C8A55),
            find_excluded: hex(0x868A91),
            find_scroll_mark: hex(0x6AAB73),
            caret_scroll_mark: hex(0xA1A3AB),
            find_bar: hex(0x2B2D30),
            find_bar_border: hex(0x393B40),
            find_field: hex(0x1E1F22),
            find_field_border: hex(0x4E5157),
            find_field_focus: hex(0x3574F0),
            find_field_no_match: hex(0x4A2B2B),
            find_text: hex(0xDFE1E5),
            find_text_dim: hex(0x868A91),
            find_icon: hex(0xCED0D6),
            find_hover: hex(0x393B40),
            find_toggle_on: hex(0x2E436E),
            find_error: hex(0xF0524F),
            kinds,
        }
    }

    /// The classic Darcula scheme.
    pub const fn darcula() -> EditorTheme {
        let fg = hex(0xA9B7C6);
        let mut kinds = [fg; HlKind::COUNT];
        kinds[HlKind::Keyword as usize] = hex(0xCC7832);
        kinds[HlKind::String as usize] = hex(0x6A8759);
        kinds[HlKind::Escape as usize] = hex(0xCC7832);
        kinds[HlKind::Number as usize] = hex(0x6897BB);
        kinds[HlKind::Comment as usize] = hex(0x808080);
        kinds[HlKind::DocComment as usize] = hex(0x629755);
        kinds[HlKind::Function as usize] = hex(0xFFC66D);
        kinds[HlKind::Macro as usize] = hex(0x4EADE5);
        kinds[HlKind::Type as usize] = hex(0x4EC9B0);
        kinds[HlKind::Property as usize] = hex(0x9876AA);
        kinds[HlKind::Constant as usize] = hex(0x9876AA);
        kinds[HlKind::Builtin as usize] = hex(0xCC7832);
        kinds[HlKind::Tag as usize] = hex(0xE8BF6A);
        kinds[HlKind::Attribute as usize] = hex(0xBABABA);
        kinds[HlKind::Title as usize] = hex(0xFFC66D);
        kinds[HlKind::Link as usize] = hex(0x287BDE);
        EditorTheme {
            background: hex(0x2B2B2B),
            foreground: fg,
            gutter_background: hex(0x313335),
            gutter_separator: hex(0x3C3F41),
            line_number: hex(0x606366),
            line_number_current: hex(0xA4A3A3),
            current_line: hex(0x323232),
            selection: hex(0x214283),
            caret: hex(0xBBBBBB),
            link: hex(0x589DF6),
            annotation: hex(0x8C8C8C),
            mark_added: hex(0x5A7A5A),
            mark_modified: hex(0x587283),
            mark_deleted: hex(0x656E76),
            find_match: hex(0x32593D),
            find_current: hex(0x4C8A55),
            find_excluded: hex(0x868A91),
            find_scroll_mark: hex(0x6AAB73),
            caret_scroll_mark: hex(0xA1A3AB),
            find_bar: hex(0x2B2D30),
            find_bar_border: hex(0x393B40),
            find_field: hex(0x1E1F22),
            find_field_border: hex(0x4E5157),
            find_field_focus: hex(0x3574F0),
            find_field_no_match: hex(0x4A2B2B),
            find_text: hex(0xDFE1E5),
            find_text_dim: hex(0x868A91),
            find_icon: hex(0xCED0D6),
            find_hover: hex(0x393B40),
            find_toggle_on: hex(0x2E436E),
            find_error: hex(0xF0524F),
            kinds,
        }
    }

    pub fn color(&self, kind: HlKind) -> Color32 {
        self.kinds[kind as usize]
    }

    /// The caret drawn while the editor has no keyboard focus.
    pub fn caret_unfocused(&self) -> Color32 {
        self.caret.gamma_multiply(0.4)
    }

    pub(crate) fn fingerprint(&self) -> u64 {
        let mut h = DefaultHasher::new();
        self.foreground.hash(&mut h);
        self.kinds.hash(&mut h);
        h.finish()
    }
}
