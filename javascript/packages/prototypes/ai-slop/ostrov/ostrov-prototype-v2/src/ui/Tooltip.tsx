import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The tooltip both panels use.
 *
 * It is mounted on `document.body` rather than inside the panel that opened it.
 * A panel carries a `backdrop-filter`, and a filter makes an element the
 * containing block of even its `position: fixed` children — a tooltip left
 * inside one would be clipped by the panel edge. On the body it is free to reach
 * across the screen.
 *
 * It prefers the side of the anchor with more room, and is clamped on both axes,
 * so a tile in a corner still gets a whole tooltip. The first pass is a
 * measurement rather than a picture, so it is laid out hidden and shown once it
 * knows where it goes.
 */

/** How far the tooltip sits from the tile it describes, in pixels. */
const TIP_GAP = 10;

/** How close the tooltip may come to the edge of the viewport, in pixels. */
const TIP_MARGIN = 8;

/** Which way the tooltip leans off its anchor. */
type TipSide = "left" | "above";

type TooltipProps = {
  /** Screen box of the control the tooltip belongs to. */
  anchor: DOMRect;
  /** `left` puts it beside the anchor, `above` puts it over it. */
  side?: TipSide;
  children: React.ReactNode;
};

function placeBeside(anchor: DOMRect, box: DOMRect): { left: number; top: number } {
  let left = anchor.left - box.width - TIP_GAP;
  if (left < TIP_MARGIN) {
    left = anchor.right + TIP_GAP;
  }
  const wanted = anchor.top + anchor.height / 2 - box.height / 2;
  return { left, top: wanted };
}

function placeAbove(anchor: DOMRect, box: DOMRect): { left: number; top: number } {
  let top = anchor.top - box.height - TIP_GAP;
  if (top < TIP_MARGIN) {
    top = anchor.bottom + TIP_GAP;
  }
  return { left: anchor.left + anchor.width / 2 - box.width / 2, top };
}

function Tooltip({ anchor, side = "left", children }: TooltipProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const box = node.getBoundingClientRect();
    const wanted = side === "above" ? placeAbove(anchor, box) : placeBeside(anchor, box);
    setPlace({
      left: Math.max(TIP_MARGIN, Math.min(wanted.left, window.innerWidth - box.width - TIP_MARGIN)),
      top: Math.max(TIP_MARGIN, Math.min(wanted.top, window.innerHeight - box.height - TIP_MARGIN)),
    });
  }, [anchor, side]);

  return createPortal(
    <div
      ref={ref}
      className="build-tip"
      role="tooltip"
      style={{
        left: `${place?.left ?? 0}px`,
        top: `${place?.top ?? 0}px`,
        visibility: place ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export type { TipSide };
export { Tooltip };
