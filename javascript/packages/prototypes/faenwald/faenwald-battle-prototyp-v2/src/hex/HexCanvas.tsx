import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Bounds } from "./hex-layout";
import styles from "./hex-canvas.module.css";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

// Leaves a small margin around the content when the view is fitted.
const FIT_PADDING = 0.94;

const FIT_ZOOM = 1.8;

// A pointer that travelled further than this counts as a pan, not a click.
const CLICK_SLOP = 4;

// How long the view takes to travel to a point it has been sent to.
const CENTER_MS = 520;

// A journey shorter than this is already where it was going. Animating it would
// spend a fifth of a second saying nothing.
const CENTER_SLOP = 0.5;

// The view does not sit on the pointer. It closes half of the distance to the
// hand every this many milliseconds, which files off the corners of a gesture
// the pointer reports as steps. The lag is proportional to speed, so a careful
// drag still lands where it was aimed while a fast one reads as weight.
const PAN_FOLLOW_HALF_LIFE_MS = 30;

// The chase ends here. Halving a gap this small again would spend frames moving
// the board a fraction of a pixel.
const PAN_SETTLE_SLOP = 0.5;

// How much of the newest sample goes into the pan velocity. A single move can
// land a pixel off the line the hand is drawing, so the velocity is an average
// over the last few — but a stale one would launch the glide in the direction
// the gesture used to have.
const VELOCITY_BLEND = 0.3;

// The glide velocity halves every this many milliseconds. Speed is carried in
// pixels per millisecond throughout.
const GLIDE_HALF_LIFE_MS = 75;

// A release slower than this is a hand setting the board down, not a throw.
const GLIDE_LAUNCH_SPEED = 0.14;

// The glide ends here. Below a pixel every few frames the motion has stopped
// reading as motion and is only keeping a frame loop alive.
const GLIDE_STOP_SPEED = 0.02;

// A hand that has been still this long before letting go has already parked the
// board, whatever it was doing a moment earlier.
const VELOCITY_STALE_MS = 70;

// A frame this far from the last one means the tab was away or the main thread
// was blocked. Counted in full, that gap would teleport the board.
const MAX_FRAME_MS = 32;

type View = {
  x: number;
  y: number;
  k: number;
};

type HexCanvasHandle = {
  fit: () => void;
  // Slides the view until the world point sits in the middle of the canvas. The
  // zoom is left as the user set it — this answers "where is it", not "how close
  // do I want to be".
  centerOn: (x: number, y: number) => void;
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
  // `origin` is where the gesture started and never moves; `x`/`y` follow the
  // pointer so each move can apply its own delta. `vx`/`vy` are what the release
  // throws the view with, in pixels per millisecond.
  const dragRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    x: number;
    y: number;
    movedAt: number;
    vx: number;
    vy: number;
  } | null>(null);
  // The point the view is chasing, and the speed that point carries once the
  // hand has let go. Holding the hand and the throw in one place is what makes
  // the release smooth: the moment the pointer leaves changes only who moves
  // this point, and the view goes on closing on it either way.
  const panRef = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    gliding: boolean;
  } | null>(null);
  const pannedRef = useRef(false);
  const touchedRef = useRef(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  // The frame a running `centerOn` or glide has booked, so the next one — or a
  // hand on the canvas — can call it off. Two animations left running would each
  // set the view from their own start point and the board would shudder between
  // them.
  const frameRef = useRef<number | null>(null);
  // The view as last painted. `centerOn` needs the point it is travelling from,
  // and a functional update only hands that over once the frame is already
  // being worked out.
  const viewRef = useRef(view);
  // State, not just `pannedRef`, because the cursor is driven from a class and
  // that needs a render. Only set once the gesture has passed the click slop,
  // so a press that turns out to be a click never flashes the grab cursor.
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Drops everything that is moving the view on its own. Whoever calls this is
  // about to set the view themselves, and a chase left running would keep
  // pulling it back towards a point that no longer means anything.
  const stopTravel = useCallback(() => {
    panRef.current = null;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  // A frame booked by a canvas that is no longer on screen would set state on
  // an unmounted component.
  useEffect(() => stopTravel, [stopTravel]);

  const fit = useCallback(() => {
    stopTravel();
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
  }, [stopTravel, world]);

  // Slides the view to a world point over `CENTER_MS`, on a curve that leaves
  // quickly and arrives gently. The travel runs on its own frames rather than a
  // CSS transition: the group transform is rewritten on every pan and wheel
  // tick, and a transition on it would smear those into a lag as well.
  const centerOn = useCallback(
    (worldX: number, worldY: number) => {
      const svg = svgRef.current;
      if (svg === null) {
        return;
      }

      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }

      stopTravel();
      // The view has been aimed somewhere on purpose, so a later resize must
      // leave it alone the same way it leaves a pan alone.
      touchedRef.current = true;

      const from = viewRef.current;
      const targetX = rect.width / 2 - worldX * from.k;
      const targetY = rect.height / 2 - worldY * from.k;
      const dx = targetX - from.x;
      const dy = targetY - from.y;

      if (Math.abs(dx) < CENTER_SLOP && Math.abs(dy) < CENTER_SLOP) {
        return;
      }

      // A view that slides across the board is the whole point of the order, so
      // a reader who has asked for less motion is given the destination instead
      // of the journey.
      if (prefersReducedMotion()) {
        setView((current) => ({ ...current, x: targetX, y: targetY }));
        return;
      }

      let startedAt: number | null = null;

      const step = (now: number) => {
        // Timed from the first frame rather than from the call: the frame after
        // a heavy render can land well over a tick later, and counting that
        // wait as travel would drop the animation into its middle.
        startedAt ??= now;

        const progress = Math.min(1, (now - startedAt) / CENTER_MS);
        const eased = easeInOut(progress);
        setView((current) => ({
          ...current,
          x: from.x + dx * eased,
          y: from.y + dy * eased,
        }));

        frameRef.current = progress < 1 ? window.requestAnimationFrame(step) : null;
      };

      frameRef.current = window.requestAnimationFrame(step);
    },
    [stopTravel],
  );

  // Runs the whole pan: the view closes on the point in `panRef` while the hand
  // drags that point around, and then while the throw carries it. Both halves
  // integrate a rate per frame rather than easing along a known distance the way
  // `centerOn` does, because neither one knows where it will end up.
  //
  // Calling this again while it is already running does nothing, so every move
  // of the drag can ask for it without booking a second loop.
  const runPan = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }

    let previous: number | null = null;

    const step = (now: number) => {
      const pan = panRef.current;
      if (pan === null) {
        frameRef.current = null;
        return;
      }

      // The first frame has no elapsed time to spend, so it only marks the
      // clock. Measuring from the call instead would count the wait for that
      // frame as travel the hand never made.
      if (previous === null) {
        previous = now;
        frameRef.current = window.requestAnimationFrame(step);
        return;
      }

      const elapsed = Math.min(now - previous, MAX_FRAME_MS);
      previous = now;

      if (pan.gliding) {
        pan.x += pan.vx * elapsed;
        pan.y += pan.vy * elapsed;
        const decay = 0.5 ** (elapsed / GLIDE_HALF_LIFE_MS);
        pan.vx *= decay;
        pan.vy *= decay;
        // The throw is spent. The view is still short of the point it was
        // aimed at, so the chase below carries on and lands it.
        if (Math.hypot(pan.vx, pan.vy) < GLIDE_STOP_SPEED) {
          pan.gliding = false;
        }
      }

      // The view is read a frame behind, because the update below has not been
      // painted yet. The gap only decides whether to book another frame, and the
      // branch that takes it lands the view exactly either way.
      const settled =
        !pan.gliding &&
        Math.abs(pan.x - viewRef.current.x) < PAN_SETTLE_SLOP &&
        Math.abs(pan.y - viewRef.current.y) < PAN_SETTLE_SLOP;

      if (settled) {
        setView((current) => ({ ...current, x: pan.x, y: pan.y }));
        // A hand still holding the board has caught up with it, which happens
        // whenever it pauses mid-drag. The point it was aiming at is kept so the
        // next move can add to it, and only the loop needs starting again —
        // otherwise a held pointer would spend a frame a tick going nowhere.
        if (dragRef.current === null) {
          panRef.current = null;
        }
        frameRef.current = null;
        return;
      }

      const follow = 1 - 0.5 ** (elapsed / PAN_FOLLOW_HALF_LIFE_MS);
      setView((current) => ({
        ...current,
        x: current.x + (pan.x - current.x) * follow,
        y: current.y + (pan.y - current.y) * follow,
      }));

      frameRef.current = window.requestAnimationFrame(step);
    };

    frameRef.current = window.requestAnimationFrame(step);
  }, []);

  useImperativeHandle(handleRef, () => ({ centerOn, fit }), [centerOn, fit]);

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
      // The wheel is the user's hand on the view, and a travel in flight is
      // aiming the same two numbers somewhere else.
      stopTravel();
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
  }, [stopTravel]);

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) {
      return;
    }

    // A hand on the canvas outranks a travel in flight, whether the gesture
    // turns out to be a pan or a click: nothing on a board still sliding under
    // the pointer was clicked on purpose.
    stopTravel();

    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      movedAt: performance.now(),
      vx: 0,
      vy: 0,
    };
    // Seeded on the view rather than started as a chase: the loop only begins
    // once the gesture has passed the click slop, so a press that turns out to
    // be a click never books a frame.
    panRef.current = { gliding: false, vx: 0, vy: 0, x: viewRef.current.x, y: viewRef.current.y };
    pannedRef.current = false;
    // The pointer is deliberately not captured here. Capturing retargets the
    // compat `pointerup` and `click` to the SVG, and the click handler below
    // needs the hex under the cursor as the event target. A pan takes the
    // capture instead, once it is clear the gesture is not a click.
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    // Measured from where the gesture started, not from the previous move: a
    // slow drag covers plenty of ground in steps of a pixel or two, and per-move
    // deltas would never pass the slop.
    const travelX = Math.abs(event.clientX - drag.originX);
    const travelY = Math.abs(event.clientY - drag.originY);
    if (!pannedRef.current && (travelX > CLICK_SLOP || travelY > CLICK_SLOP)) {
      pannedRef.current = true;
      touchedRef.current = true;
      // React bails out when the value is unchanged, so calling this on every
      // move of the drag costs one render at the start and nothing after.
      setPanning(true);
      // Now that the gesture is a pan, capture it, so it keeps its moves when
      // the pointer runs off the canvas.
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;

    const now = performance.now();
    const elapsed = now - drag.movedAt;
    // Two moves can share a millisecond, and that pair carries no speed worth
    // reading — the next move measures across both of them instead.
    if (elapsed > 0) {
      drag.vx += (dx / elapsed - drag.vx) * VELOCITY_BLEND;
      drag.vy += (dy / elapsed - drag.vy) * VELOCITY_BLEND;
      drag.movedAt = now;
    }

    // A reader who has asked for less motion gets the board pinned to the
    // pointer: the chase is motion the hand did not draw, however small.
    if (prefersReducedMotion()) {
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      return;
    }

    const pan = panRef.current;
    if (pan === null) {
      // A wheel tick in the middle of the drag has taken the view over and
      // dropped the chase. Pick it up from wherever the zoom left the view.
      panRef.current = { gliding: false, vx: 0, vy: 0, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
    } else {
      pan.x += dx;
      pan.y += dy;
    }

    runPan();
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    const pan = panRef.current;
    dragRef.current = null;
    setPanning(false);
    // Only a pan ever took the capture.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    // A click never moved the board and has nothing to settle or carry on.
    if (!pannedRef.current) {
      panRef.current = null;
      return;
    }

    // Every path below this point leaves the chase running if it is short of
    // the point the hand left off at. Cutting it there would put a stop into
    // the one moment of the gesture the hand did not ask to be interrupted.
    if (pan === null) {
      return;
    }

    // A cancel is the browser taking the gesture away, not a throw. Neither is a
    // hand that had already parked the board before letting go, nor one that set
    // it down slowly. And the board carrying on after the hand has left is
    // exactly the motion a reader asking for less of it does not want.
    if (event.type !== "pointerup" || prefersReducedMotion()) {
      return;
    }

    if (performance.now() - drag.movedAt > VELOCITY_STALE_MS) {
      return;
    }

    if (Math.hypot(drag.vx, drag.vy) < GLIDE_LAUNCH_SPEED) {
      return;
    }

    pan.vx = drag.vx;
    pan.vy = drag.vy;
    pan.gliding = true;
    runPan();
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

// Cubic ease-in-out: the view is at rest at both ends of the journey and carries
// its speed through the middle. Nobody asked this travel to start, so it must
// not announce itself the way a jump to full speed does.
function easeInOut(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export { HexCanvas };
export type { HexCanvasHandle };
