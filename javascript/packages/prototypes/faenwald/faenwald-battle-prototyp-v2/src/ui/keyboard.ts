// Guards shared by every window-level shortcut on the battle page. A shortcut
// listens on `window`, so it hears keys the player never aimed at the board.

// The page has a chat box on it, so a letter typed into a field must not reach
// the board.
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

// A dialog or a drawer holds focus while it is open. A key pressed inside one
// belongs to it, not to the board behind it.
function isInOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.closest("[role=dialog], [role=alertdialog]") !== null;
}

// Which order a key press stands for, out of a table of them. The table is
// keyed by the lowercased name of a key: `w`, `escape`.
//
// The place on the keyboard is read first, and the letter the layout printed
// there second. `event.key` alone answers the layout: with a Russian one on, the
// physical W gives `ц`, and every shortcut goes silent until the player switches
// back. `event.code` names the place instead — the physical W is `KeyW` under
// every layout — so the same press finds the same order.
//
// The letter is still read, because `event.code` names the place by where it
// sits on a US keyboard. A player on Dvorak or AZERTY reads W off their own
// keycaps, and pressing the key that says W should give the order the card
// promises.
function matchShortcut<Action>(
  event: KeyboardEvent,
  shortcuts: Record<string, Action>,
): Action | undefined {
  const byPlace = shortcuts[keyName(event.code)];
  if (byPlace !== undefined) {
    return byPlace;
  }

  return shortcuts[event.key.toLowerCase()];
}

// What to call the place `event.code` names, in the same spelling the tables
// use. `KeyW` is the W key and `Digit1` is the 1 key, so both are stripped down
// to what is printed on them. Everything else — `Escape`, `Space`, the arrows —
// is already named after itself and only needs lowercasing.
function keyName(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter !== null) {
    return letter[1].toLowerCase();
  }

  const digit = /^Digit([0-9])$/.exec(code);
  if (digit !== null) {
    return digit[1];
  }

  return code.toLowerCase();
}

export { isInOverlay, isTyping, matchShortcut };
