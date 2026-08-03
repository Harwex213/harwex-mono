import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import type { Bounds } from "./hex-layout";
import styles from "./hex-canvas.module.css";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

// Leaves a small margin around the content when the view is fitted.
const FIT_PADDING = 0.94;

// How much the fitted view is zoomed past "whole grid on screen", which is what
// sets the on-screen size of a hex. `HEX_SIZE` cannot do it: fitting divides it
// straight back out, so a bigger world only ever gets a smaller scale. Above 1
// the grid overflows the canvas and the user pans to reach the rest.
const FIT_ZOOM = 1.5;

// A pointer that travelled further than this counts as a pan, not a click.
const CLICK_SLOP = 4;

type View = {
  x: number;
  y: number;
  k: number;
};

type HexCanvasHandle = {
  fit: () => void;
};

type HexCanvasProps = {
  children: ReactNode;
  handleRef?: Ref<HexCanvasHandle>;
  onCellClick?: (key: string) => void;
  onCellHover?: (key: string | null) => void;
  world: Bounds;
};

// The SVG carries no `viewBox`, so one user unit is one CSS pixel and the whole
// pan/zoom lives in a single group transform. Screen and world coordinates then
// differ by nothing but that transform, which keeps the wheel math short.
function HexCanvas({ children, handleRef, onCellClick, onCellHover, world }: HexCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const pannedRef = useRef(false);
  const touchedRef = useRef(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  // State, not just `pannedRef`, because the cursor is driven from a class and
  // that needs a render. Only set once the gesture has passed the click slop,
  // so a press that turns out to be a click never flashes the grab cursor.
  const [panning, setPanning] = useState(false);

  const fit = useCallback(() => {
    touchedRef.current = false;
    const svg = svgRef.current;
    if (svg === null) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const k = clamp(
      Math.min(rect.width / world.width, rect.height / world.height) * FIT_PADDING * FIT_ZOOM,
      MIN_SCALE,
      MAX_SCALE,
    );

    setView({
      k,
      x: (rect.width - world.width * k) / 2 - world.x * k,
      y: (rect.height - world.height * k) / 2 - world.y * k,
    });
  }, [world]);

  useImperativeHandle(handleRef, () => ({ fit }), [fit]);

  // Fit once the canvas has its first real size, and again on resize — but
  // only while the view is untouched, so a resize never throws away a pan the
  // user set up by hand.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!touchedRef.current) {
        fit();
      }
    });
    observer.observe(svg);

    return () => {
      observer.disconnect();
    };
  }, [fit]);

  // React attaches wheel listeners passively, so zooming has to own the event
  // itself to stop the page from scrolling underneath the canvas.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) {
      return;
    }

    // An arrow constant, not a declaration: TypeScript keeps the null check on
    // `svg` only for closures created after it.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      touchedRef.current = true;

      const rect = svg.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      setView((current) => {
        const k = clamp(current.k * Math.exp(-event.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
        const ratio = k / current.k;
        // Keep the world point under the cursor pinned to the cursor.
        return {
          k,
          x: pointerX - (pointerX - current.x) * ratio,
          y: pointerY - (pointerY - current.y) * ratio,
        };
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      svg.removeEventListener("wheel", onWheel);
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) {
      return;
    }

    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    pannedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) {
      pannedRef.current = true;
      touchedRef.current = true;
      // React bails out when the value is unchanged, so calling this on every
      // move of the drag costs one render at the start and nothing after.
      setPanning(true);
    }

    drag.x = event.clientX;
    drag.y = event.clientY;
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // Clicks are read off the group instead of per-cell handlers: the canvas
  // already knows whether the gesture turned into a pan, and a pan must not
  // select whatever hex it happened to end on.
  function onClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (pannedRef.current || onCellClick === undefined) {
      return;
    }

    const key = (event.target as SVGElement).dataset?.cellKey;
    if (key !== undefined) {
      onCellClick(key);
    }
  }

  // Read off the group for the same reason as clicks, and reported per hex
  // rather than on every move so crossing one costs a single call.
  function onPointerOver(event: ReactPointerEvent<SVGSVGElement>) {
    if (onCellHover === undefined) {
      return;
    }

    const key = (event.target as SVGElement).dataset?.cellKey;
    // Undefined in the gaps between hexes and outside the grid. Holding the
    // last cell there keeps the readout from blinking as the pointer crosses a
    // gap; `onPointerLeave` is what actually clears it.
    if (key !== undefined) {
      onCellHover(key);
    }
  }

  function onPointerLeave() {
    onCellHover?.(null);
  }

  return (
    <svg
      className={panning ? `${styles.canvas} ${styles.panning}` : styles.canvas}
      onClick={onClick}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      onPointerOver={onPointerOver}
      onPointerUp={onPointerUp}
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform={`translate(${view.x.toFixed(2)} ${view.y.toFixed(2)}) scale(${view.k.toFixed(4)})`}>
        {children}
      </g>
    </svg>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export { HexCanvas };
export type { HexCanvasHandle };
