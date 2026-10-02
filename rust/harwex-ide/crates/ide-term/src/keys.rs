//! Translation of egui key events into the byte sequences an xterm-256color program expects.
//!
//! Printable text arrives as `egui::Event::Text` and is written as-is by the view. This module
//! covers everything that egui reports only as a `Key` event: control keys, Ctrl+letter, Alt as
//! Meta and the macOS editing shortcuts that IDEA's terminal also provides.

use egui::{Key, Modifiers};

/// Terminal modes that change what a key sends.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct KeyMode {
    /// DECCKM: arrows and Home/End send SS3 (`ESC O A`) instead of CSI (`ESC [ A`).
    /// Readline ignores the difference, but vim and less depend on it.
    pub app_cursor: bool,
    /// Treat Option/Alt as Meta (prefix ESC). With it off, macOS Option produces its composed
    /// character through the Text event instead.
    pub alt_is_meta: bool,
}

/// xterm modifier parameter: 1 + shift + 2*alt + 4*ctrl. 1 means "no modifiers".
fn xterm_modifier(mods: Modifiers) -> u8 {
    1 + u8::from(mods.shift) + 2 * u8::from(mods.alt) + 4 * u8::from(mods.ctrl)
}

/// CSI or SS3 final-letter keys (arrows, Home, End, F1-F4).
fn letter_key(final_byte: char, mods: Modifiers, ss3: bool) -> Vec<u8> {
    let m = xterm_modifier(mods);
    if m > 1 {
        format!("\x1b[1;{m}{final_byte}").into_bytes()
    } else if ss3 {
        format!("\x1bO{final_byte}").into_bytes()
    } else {
        format!("\x1b[{final_byte}").into_bytes()
    }
}

/// `CSI n ~` keys (PageUp, Delete, F5-F12...).
fn tilde_key(n: u8, mods: Modifiers) -> Vec<u8> {
    let m = xterm_modifier(mods);
    if m > 1 {
        format!("\x1b[{n};{m}~").into_bytes()
    } else {
        format!("\x1b[{n}~").into_bytes()
    }
}

/// The ASCII character a key types without Shift, for keys where Ctrl or Alt combinations
/// are meaningful. egui reports logical keys, so this already follows the keyboard layout.
fn key_char(key: Key) -> Option<char> {
    let name = key.name();
    if name.len() == 1 {
        let c = name.chars().next()?;
        if c.is_ascii_alphanumeric() {
            return Some(c.to_ascii_lowercase());
        }
    }
    Some(match key {
        Key::Space => ' ',
        Key::OpenBracket => '[',
        Key::CloseBracket => ']',
        Key::Backslash => '\\',
        Key::Slash => '/',
        Key::Minus => '-',
        Key::Equals => '=',
        Key::Period => '.',
        Key::Comma => ',',
        Key::Semicolon => ';',
        Key::Quote => '\'',
        Key::Backtick => '`',
        _ => return None,
    })
}

/// The control byte for Ctrl+<c>, following the xterm conventions.
fn ctrl_byte(c: char, shift: bool) -> Option<u8> {
    Some(match c {
        'a'..='z' => c as u8 - b'a' + 1,
        ' ' | '2' | '`' => 0,
        '[' | '3' => 0x1b,
        '\\' | '4' => 0x1c,
        ']' | '5' => 0x1d,
        '6' => 0x1e,
        '-' if shift => 0x1f,
        '/' | '7' => 0x1f,
        '8' => 0x7f,
        _ => return None,
    })
}

fn with_meta(alt: bool, bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + 1);
    if alt {
        out.push(0x1b);
    }
    out.extend_from_slice(bytes);
    out
}

/// Bytes for a pressed key, or `None` when the key produces nothing here (plain printable keys
/// are handled through `Event::Text`, Cmd shortcuts belong to the application).
pub fn key_to_bytes(key: Key, mods: Modifiers, mode: KeyMode) -> Option<Vec<u8>> {
    let alt = mods.alt && mode.alt_is_meta;

    // macOS editing shortcuts, matching IDEA's and iTerm's "natural text editing".
    if mods.mac_cmd {
        return match key {
            Key::ArrowLeft => Some(vec![0x01]),  // Ctrl+A: beginning of line
            Key::ArrowRight => Some(vec![0x05]), // Ctrl+E: end of line
            Key::Backspace => Some(vec![0x15]),  // Ctrl+U: kill to line start
            _ => None,
        };
    }
    if mods.alt && !mods.ctrl && !mods.shift {
        match key {
            Key::ArrowLeft => return Some(b"\x1bb".to_vec()),
            Key::ArrowRight => return Some(b"\x1bf".to_vec()),
            Key::Backspace => return Some(b"\x1b\x7f".to_vec()),
            _ => {}
        }
    }

    let bytes = match key {
        Key::Enter => with_meta(alt, b"\r"),
        Key::Tab if mods.shift => b"\x1b[Z".to_vec(),
        Key::Tab => with_meta(alt, b"\t"),
        Key::Backspace if mods.ctrl => with_meta(alt, b"\x08"),
        Key::Backspace => with_meta(alt, b"\x7f"),
        Key::Escape => with_meta(alt, b"\x1b"),
        Key::ArrowUp => letter_key('A', mods, mode.app_cursor),
        Key::ArrowDown => letter_key('B', mods, mode.app_cursor),
        Key::ArrowRight => letter_key('C', mods, mode.app_cursor),
        Key::ArrowLeft => letter_key('D', mods, mode.app_cursor),
        Key::Home => letter_key('H', mods, mode.app_cursor),
        Key::End => letter_key('F', mods, mode.app_cursor),
        Key::Insert => tilde_key(2, mods),
        Key::Delete => tilde_key(3, mods),
        Key::PageUp => tilde_key(5, mods),
        Key::PageDown => tilde_key(6, mods),
        Key::F1 => letter_key('P', mods, true),
        Key::F2 => letter_key('Q', mods, true),
        Key::F3 => letter_key('R', mods, true),
        Key::F4 => letter_key('S', mods, true),
        Key::F5 => tilde_key(15, mods),
        Key::F6 => tilde_key(17, mods),
        Key::F7 => tilde_key(18, mods),
        Key::F8 => tilde_key(19, mods),
        Key::F9 => tilde_key(20, mods),
        Key::F10 => tilde_key(21, mods),
        Key::F11 => tilde_key(23, mods),
        Key::F12 => tilde_key(24, mods),
        _ => {
            let c = key_char(key)?;
            if mods.ctrl {
                with_meta(alt, &[ctrl_byte(c, mods.shift)?])
            } else if alt {
                // egui reports the unshifted key; Shift picks the upper-case letter.
                let c = if mods.shift {
                    c.to_ascii_uppercase()
                } else {
                    c
                };
                with_meta(true, c.to_string().as_bytes())
            } else {
                return None;
            }
        }
    };
    Some(bytes)
}

/// Wraps pasted text for the shell. Bracketed paste lets the shell insert the text as a whole
/// instead of executing each line. Without it, newlines become CR so each line is "typed".
pub fn paste_bytes(text: &str, bracketed: bool) -> Vec<u8> {
    let normalized = text.replace("\r\n", "\r").replace('\n', "\r");
    if bracketed {
        // A paste that contains the end marker could break out of the bracket and run commands.
        let safe = normalized.replace("\x1b[201~", "");
        let mut out = Vec::with_capacity(safe.len() + 12);
        out.extend_from_slice(b"\x1b[200~");
        out.extend_from_slice(safe.as_bytes());
        out.extend_from_slice(b"\x1b[201~");
        out
    } else {
        normalized.into_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NORMAL: KeyMode = KeyMode {
        app_cursor: false,
        alt_is_meta: true,
    };
    const APP: KeyMode = KeyMode {
        app_cursor: true,
        alt_is_meta: true,
    };

    fn mods(ctrl: bool, alt: bool, shift: bool) -> Modifiers {
        Modifiers {
            alt,
            ctrl,
            shift,
            mac_cmd: false,
            command: false,
        }
    }

    fn k(key: Key, m: Modifiers) -> Option<Vec<u8>> {
        key_to_bytes(key, m, NORMAL)
    }

    #[test]
    fn control_keys() {
        let none = Modifiers::NONE;
        assert_eq!(k(Key::Enter, none).unwrap(), b"\r");
        assert_eq!(k(Key::Backspace, none).unwrap(), b"\x7f");
        assert_eq!(k(Key::Tab, none).unwrap(), b"\t");
        assert_eq!(k(Key::Tab, mods(false, false, true)).unwrap(), b"\x1b[Z");
        assert_eq!(k(Key::Escape, none).unwrap(), b"\x1b");
        assert_eq!(k(Key::PageUp, none).unwrap(), b"\x1b[5~");
        assert_eq!(k(Key::PageDown, none).unwrap(), b"\x1b[6~");
        assert_eq!(k(Key::Delete, none).unwrap(), b"\x1b[3~");
        assert_eq!(k(Key::F1, none).unwrap(), b"\x1bOP");
        assert_eq!(k(Key::F5, none).unwrap(), b"\x1b[15~");
        assert_eq!(k(Key::F12, none).unwrap(), b"\x1b[24~");
    }

    #[test]
    fn arrows_follow_cursor_mode() {
        let none = Modifiers::NONE;
        assert_eq!(k(Key::ArrowUp, none).unwrap(), b"\x1b[A");
        assert_eq!(k(Key::ArrowLeft, none).unwrap(), b"\x1b[D");
        assert_eq!(k(Key::Home, none).unwrap(), b"\x1b[H");
        assert_eq!(k(Key::End, none).unwrap(), b"\x1b[F");
        assert_eq!(key_to_bytes(Key::ArrowUp, none, APP).unwrap(), b"\x1bOA");
        assert_eq!(key_to_bytes(Key::End, none, APP).unwrap(), b"\x1bOF");
        // Modified arrows always use the CSI 1;m form.
        assert_eq!(
            k(Key::ArrowUp, mods(true, false, false)).unwrap(),
            b"\x1b[1;5A"
        );
        assert_eq!(
            key_to_bytes(Key::ArrowDown, mods(false, false, true), APP).unwrap(),
            b"\x1b[1;2B"
        );
        assert_eq!(
            k(Key::Delete, mods(true, false, false)).unwrap(),
            b"\x1b[3;5~"
        );
    }

    #[test]
    fn ctrl_letters() {
        let ctrl = mods(true, false, false);
        assert_eq!(k(Key::C, ctrl).unwrap(), [0x03]);
        assert_eq!(k(Key::A, ctrl).unwrap(), [0x01]);
        assert_eq!(k(Key::Z, ctrl).unwrap(), [0x1a]);
        assert_eq!(k(Key::D, mods(true, false, true)).unwrap(), [0x04]);
        assert_eq!(k(Key::Space, ctrl).unwrap(), [0x00]);
        assert_eq!(k(Key::OpenBracket, ctrl).unwrap(), [0x1b]);
        assert_eq!(k(Key::Backslash, ctrl).unwrap(), [0x1c]);
        assert_eq!(k(Key::Backspace, ctrl).unwrap(), [0x08]);
        assert_eq!(k(Key::C, mods(true, true, false)).unwrap(), [0x1b, 0x03]);
    }

    #[test]
    fn alt_is_meta() {
        let alt = mods(false, true, false);
        assert_eq!(k(Key::B, alt).unwrap(), b"\x1bb");
        assert_eq!(k(Key::B, mods(false, true, true)).unwrap(), b"\x1bB");
        assert_eq!(k(Key::Num1, alt).unwrap(), b"\x1b1");
        assert_eq!(k(Key::Enter, alt).unwrap(), b"\x1b\r");
        assert_eq!(k(Key::ArrowLeft, alt).unwrap(), b"\x1bb");
        assert_eq!(k(Key::ArrowRight, alt).unwrap(), b"\x1bf");
        assert_eq!(k(Key::Backspace, alt).unwrap(), b"\x1b\x7f");
        let compose = KeyMode {
            app_cursor: false,
            alt_is_meta: false,
        };
        assert_eq!(key_to_bytes(Key::B, alt, compose), None);
    }

    #[test]
    fn plain_and_cmd_keys_are_left_to_others() {
        assert_eq!(k(Key::A, Modifiers::NONE), None);
        assert_eq!(k(Key::A, mods(false, false, true)), None);
        let cmd = Modifiers {
            mac_cmd: true,
            command: true,
            ..Modifiers::NONE
        };
        assert_eq!(k(Key::K, cmd), None);
        assert_eq!(k(Key::ArrowLeft, cmd).unwrap(), [0x01]);
        assert_eq!(k(Key::ArrowRight, cmd).unwrap(), [0x05]);
        assert_eq!(k(Key::Backspace, cmd).unwrap(), [0x15]);
    }

    #[test]
    fn paste() {
        assert_eq!(paste_bytes("a\nb", false), b"a\rb");
        assert_eq!(paste_bytes("a\r\nb", true), b"\x1b[200~a\rb\x1b[201~");
        assert_eq!(paste_bytes("x\x1b[201~rm", true), b"\x1b[200~xrm\x1b[201~");
    }
}
