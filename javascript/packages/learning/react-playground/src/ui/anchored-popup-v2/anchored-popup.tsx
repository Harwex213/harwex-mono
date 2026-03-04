import { FC, memo, ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

// ── Portal ───────────────────────────────────────────────────────────────────

const portalRoot = document.getElementById("portal-root") ?? document.body;

const Portal: FC<{ children: ReactNode }> = ({ children }) =>
  createPortal(children, portalRoot);

// ── AnchoredPopup ────────────────────────────────────────────────────────────

interface IAnchoredPopupProps<T extends HTMLElement = HTMLElement> {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: VoidFunction;
  marginTop?: number;
  marginBottom?: number;
  translateLeft?: number;
  place?: "center" | "left";
  children: (props: { childRef: React.RefCallback<T>; }) => ReactNode;
}

const AnchoredPopup = <T extends HTMLElement = HTMLElement>({
                                                              anchorRef,
                                                              onClose,
                                                              marginTop = 0,
                                                              marginBottom = 0,
                                                              translateLeft = 0,
                                                              place = "center",
                                                              children,
                                                            }: IAnchoredPopupProps<T>) => {
  const childRef = useClickOutside<T>(onClose);

  // Cached overlay dimensions — updated by ResizeObserver to avoid reflow
  // on every position recalculation.
  const cachedSize = useRef({ width: 0, height: 0 });

  // Holds the active ResizeObserver so the callback-ref can disconnect/reconnect
  // when the DOM node changes (Portal double-render: first null, then real node).
  const roRef = useRef<ResizeObserver | null>(null);

  // Inline ref — no useCallback, no memoisation overhead. Always reflects the
  // latest props because it is reassigned on every render before any async
  // handler can read it.
  const updatePositionRef = useRef<(anchorRect?: DOMRect) => void>(null);
  updatePositionRef.current = (anchorRect?: DOMRect) => {
    const anchor = anchorRef.current;
    const el = childRef.current;
    if (!anchor || !el) {
      return;
    }

    // Accept a pre-read rect to avoid a second reflow when the caller already
    // has one (e.g. attachOverlayObserver reads el + anchor rects together).
    const rect = anchorRect ?? anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (
      rect.right <= 0 ||
      rect.left >= vw ||
      (place === "left" && rect.left < 0) ||
      rect.bottom <= marginTop ||
      rect.top >= vh - marginBottom
    ) {
      onClose();
      return;
    }

    const { width: elWidth, height: elHeight } = cachedSize.current;

    // --- Horizontal placement ---
    let left: number;
    if (place === "left") {
      left = rect.left - translateLeft;
      el.style.maxWidth = `${Math.max(0, vw - left)}px`;
      left = Math.max(0, left);
    } else {
      el.style.maxWidth = "";
      left = rect.left + (rect.width / 2) - (elWidth / 2) - translateLeft;
      left = Math.min(Math.max(0, left), Math.max(0, vw - elWidth));
    }

    // --- Vertical placement — center on anchor, clamp to safe zone ---
    const maxTop = Math.max(marginTop, vh - elHeight - marginBottom);
    const top = Math.min(
      Math.max(marginTop, rect.top + (rect.height / 2) - (elHeight / 2)),
      maxTop,
    );

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };

  // --- Overlay ResizeObserver via callback ref ---
  //
  // Portal renders null on first commit, then re-renders with the real node.
  // useLayoutEffect with a plain ref would fire with el=null on the first
  // commit and never re-run because ref identity never changes.
  //
  // A callback ref fires synchronously when React attaches/detaches the DOM
  // node, so we always subscribe exactly when the element becomes available.
  //
  // attachOverlayObserver is stable (no deps change its identity) which is
  // intentional — React must not detach/re-attach the ref on every render.
  // Props changes are handled transparently via updatePositionRef (always current).
  const attachOverlayObserver = useRef<React.RefCallback<T>>(null);
  attachOverlayObserver.current = (el: T | null) => {
    // Sync plain ref so useClickOutside keeps working.
    (childRef as React.MutableRefObject<T | null>).current = el;

    // Disconnect any previous observer (node detached or changed).
    roRef.current?.disconnect();
    roRef.current = null;

    if (!el) {
      return;
    }

    // Invariant styles — set once on attach, not on every position update.
    el.style.position = "fixed";
    el.style.margin = "0";
    el.style.zIndex = "9999";

    // Read both el and anchor rects in one batch to avoid two separate reflows.
    const bcr = el.getBoundingClientRect();
    const anchorRect = anchorRef.current?.getBoundingClientRect();

    // Mutate existing object to avoid GC pressure from creating a new one.
    cachedSize.current.width = bcr.width;
    cachedSize.current.height = bcr.height;

    // Only position immediately if the element already has layout.
    // If content is still loading (width/height === 0), ResizeObserver
    // will fire once dimensions are known and position correctly then,
    // avoiding a visible jump from a 0-size placement.
    if ((bcr.width > 0 || bcr.height > 0) && anchorRect) {
      updatePositionRef.current(anchorRect);
    }

    const ro = new ResizeObserver(([entry]) => {
      // Mutate existing object — avoids allocating a new {width, height} on
      // every resize event (reduces GC pressure during rapid content changes).
      const borderBox = entry.borderBoxSize?.[0];
      if (borderBox) {
        cachedSize.current.width = borderBox.inlineSize;
        cachedSize.current.height = borderBox.blockSize;
      } else {
        const r = entry.target.getBoundingClientRect();
        cachedSize.current.width = r.width;
        cachedSize.current.height = r.height;
      }
      updatePositionRef.current();
    });
    ro.observe(el, { box: "border-box" });
    roRef.current = ro;
  };

  // Stable wrapper that React uses as the actual ref callback.
  // Indirects through attachOverlayObserver.current so the function passed to
  // JSX never changes identity (no detach/re-attach on re-render) while still
  // always calling the latest version of the logic above.
  const stableRefCallback = useRef<React.RefCallback<T>>(
    (el) => attachOverlayObserver.current(el),
  );

  // Disconnect observer on unmount.
  useEffect(
    () => () => {
      roRef.current?.disconnect();
    },
    [],
  );

  // --- Anchor tracking ---
  useEffect(
    () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }

      let rafId = 0;

      const scheduleUpdate = () => {
        if (rafId) {
          return;
        }
        rafId = window.requestAnimationFrame(() => {
          rafId = 0;
          updatePositionRef.current();
        });
      };

      const anchorRo = new ResizeObserver(scheduleUpdate);
      anchorRo.observe(anchor);

      window.addEventListener("scroll", scheduleUpdate, { passive: true, capture: true });
      window.addEventListener("resize", scheduleUpdate, { passive: true });

      // Close popup when anchor leaves the safe viewport zone.
      // IntersectionObserver handles close-on-exit; scheduleUpdate is not
      // called from here to avoid a race where both fire onClose for the
      // same anchor-leaving event.
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

      return () => {
        window.removeEventListener("scroll", scheduleUpdate, { capture: true });
        window.removeEventListener("resize", scheduleUpdate);
        anchorRo.disconnect();
        io.disconnect();
        if (rafId) {
          window.cancelAnimationFrame(rafId);
        }
      };
    },
    [anchorRef, onClose, marginTop, marginBottom],
  );

  return (
    <Portal>
      {children({ childRef: stableRefCallback.current })}
    </Portal>
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

        <button
          ref={anchorRef}
          className={classes.anchor}
          onClick={() => setOpen((prev) => !prev)}
        >
          Toggle Popup
        </button>

        <div className={classes.spacer}/>
      </div>

      {open && (
        <AnchoredPopup<HTMLDivElement>
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          marginTop={100}
          marginBottom={100}
        >
          {({ childRef }) => (
            <div className={classes.popup} ref={childRef}>
              <p className={classes.popupTitle}>Anchored content</p>
              <p className={classes.popupText}>
                This popup repositions itself when the anchor moves, resizes
                with its content, and closes when the anchor scrolls out of
                view.
              </p>
            </div>
          )}
        </AnchoredPopup>
      )}
    </div>
  );
});
AnchoredPopupUsage.displayName = "AnchoredPopupUsage";

router.registerRoute("/anchored-popup-v2", AnchoredPopupUsage);