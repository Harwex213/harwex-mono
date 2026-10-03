import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Keeps keyboard focus inside a modal dialog while it is open. Tab and
 * Shift+Tab wrap around the dialog's focusable elements. When the dialog
 * closes, focus goes back to the element that had it before the dialog opened.
 * The dialog focuses its own first element; the hook does not.
 */
const useFocusTrap = (dialogRef: RefObject<HTMLElement | null>) => {
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;

    return () => {
      const target = returnFocusRef.current;
      if (target instanceof HTMLElement && target.isConnected) {
        target.focus();
      }
    };
  }, []);

  const onTrapKeyDown = (event: ReactKeyboardEvent) => {
    const dialog = dialogRef.current;
    if (event.key !== "Tab" || !dialog) {
      return;
    }

    // A roving group keeps only one member in the tab order.
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.tabIndex >= 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();

      return;
    }

    const active = document.activeElement;
    const isInside = active instanceof Node && dialog.contains(active);

    if (event.shiftKey && (active === first || !isInside)) {
      event.preventDefault();
      last.focus();

      return;
    }

    if (!event.shiftKey && (active === last || !isInside)) {
      event.preventDefault();
      first.focus();
    }
  };

  return onTrapKeyDown;
};

export { useFocusTrap };
