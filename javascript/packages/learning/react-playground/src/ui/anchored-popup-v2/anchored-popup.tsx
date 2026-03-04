import { FC, memo, ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { router } from "@/ui/router-di.ts";
import classes from "./anchored-popup.module.css";

const useClickOutside = <T extends HTMLElement>(
  handler: (event: MouseEvent) => void,
  shouldUseParentNode = false,
  shouldExclude: (target: T) => boolean = () => false,
) => {
  const ref = useRef<T>(null);

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (!ref.current) {
        return;
      }

      const target = event.target as T;

      if (shouldExclude(target)) {
        return;
      }

      const current = shouldUseParentNode ? ref.current.parentNode : ref.current;

      if (current && !current.contains(target)) {
        handler(event);
      }
    },
    [handler, shouldUseParentNode],
  );

  useEffect(
    () => {
      document.addEventListener("mousedown", handleClickOutside);

      return () => document.removeEventListener("mousedown", handleClickOutside);
    },
    [handleClickOutside],
  );

  return ref;
};

// ── AnchoredPopup ────────────────────────────────────────────────────────────

interface IAnchoredPopupProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: VoidFunction;
  marginTop?: number;
  marginBottom?: number;
  place?: "center" | "left";
  children: ReactNode;
}

const AnchoredPopup: FC<IAnchoredPopupProps> = ({
  anchorRef,
  onClose,
  marginTop = 0,
  marginBottom = 0,
  place = "center",
  children,
}) => {
  const overlayRef = useClickOutside<HTMLDivElement>(onClose);

  // Close when anchor leaves the visible viewport zone.
  useEffect(
    () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }

      const io = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) {
            onClose();
          }
        },
        {
          threshold: 0,
          rootMargin: `-${marginTop}px 0px -${marginBottom}px 0px`,
        },
      );
      io.observe(anchor);

      return () => io.disconnect();
    },
    [anchorRef, onClose, marginTop, marginBottom],
  );

  return (
    <div
      ref={overlayRef}
      className={`${classes.overlay} ${place === "left" ? classes.overlayLeft : classes.overlayCenter}`}
    >
      {children}
    </div>
  );
};
AnchoredPopup.displayName = "AnchoredPopup";

// ── Usage / Demo ─────────────────────────────────────────────────────────────

const AnchoredPopupUsage: FC = memo(() => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className={`${classes.variables} ${classes.page}`}>
      <h2>Anchored Popup</h2>

      <p className={classes.description}>
        Click the button below to toggle a popup that stays anchored to it.
        Scroll the page or resize the window — the popup follows the anchor.
        Click outside to dismiss.
      </p>

      <div className={classes.scrollArea}>
        <div className={classes.spacer}/>

        <div className={classes.anchorContainer}>
          <button
            ref={anchorRef}
            className={classes.anchor}
            onClick={() => setOpen((prev) => !prev)}
          >
            Toggle Popup
          </button>

          {open && (
            <AnchoredPopup
              anchorRef={anchorRef}
              onClose={() => setOpen(false)}
              marginTop={100}
              marginBottom={100}
            >
              <div className={classes.popup}>
                <p className={classes.popupTitle}>Anchored content</p>
                <p className={classes.popupText}>
                  This popup repositions itself when the anchor moves, resizes
                  with its content, and closes when the anchor scrolls out of
                  view.
                </p>
              </div>
            </AnchoredPopup>
          )}
        </div>

        <div className={classes.spacer}/>
      </div>
    </div>
  );
});
AnchoredPopupUsage.displayName = "AnchoredPopupUsage";

router.registerRoute("/anchored-popup-v2", AnchoredPopupUsage);
