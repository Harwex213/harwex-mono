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

export { isInOverlay, isTyping };
