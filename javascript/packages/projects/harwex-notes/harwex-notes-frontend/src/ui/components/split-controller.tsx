import { useRef, useState } from "react";
import type { FC, KeyboardEvent, PointerEvent } from "react";

// A key press is a coarse tool, so one press moves the divider by more than one pixel.
const KEYBOARD_STEP_PX = 16;

type TSplitOrientation = "vertical" | "horizontal";

// Which key grows the panel depends on where the panel is: a vertical divider stands
// between columns and sizes the left one, a horizontal divider stands between rows and
// sizes the top one.
const KEY_DIRECTIONS: Readonly<Record<TSplitOrientation, Readonly<Record<string, number>>>> = {
  vertical: { ArrowLeft: -1, ArrowRight: 1 },
  horizontal: { ArrowUp: -1, ArrowDown: 1 },
};

type TSplitControllerProps = {
  // The divider carries no text, so a screen reader reads this in its place.
  label: string;
  max: number;
  min: number;
  onResize: (size: number) => void;
  orientation?: TSplitOrientation;
  // The size of the panel the divider sizes, in pixels.
  size: number;
};

// Where the drag started: the pointer coordinate at the press and the size the panel had
// then. Every move is measured from the press, so a drag that runs past `min` and comes
// back follows the pointer instead of trailing the clamped sizes.
type TPress = {
  coordinate: number;
  size: number;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const SplitController: FC<TSplitControllerProps> = ({
  label,
  max,
  min,
  onResize,
  orientation = "vertical",
  size,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const pressRef = useRef<TPress | null>(null);

  const readCoordinate = (event: PointerEvent<HTMLDivElement>) => {
    return orientation === "vertical" ? event.clientX : event.clientY;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Only the primary button drags. A middle click belongs to the panels behind.
    if (event.button !== 0) {
      return;
    }

    pressRef.current = { coordinate: readCoordinate(event), size };

    // The capture keeps the moves arriving here while the pointer travels over the panels
    // on either side, so the drag needs no window listeners and no cleanup effect.
    event.currentTarget.setPointerCapture(event.pointerId);

    setIsDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (press === null) {
      return;
    }

    const moved = readCoordinate(event) - press.coordinate;

    onResize(clamp(press.size + moved, min, max));
  };

  // The browser releases the capture on pointer up and on every interruption it decides
  // for itself, and each of those ends the drag.
  const handleLostPointerCapture = () => {
    pressRef.current = null;

    setIsDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      onResize(min);

      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onResize(max);

      return;
    }

    const direction = KEY_DIRECTIONS[orientation][event.key];
    if (direction === undefined) {
      return;
    }

    // The arrow keys scroll the page otherwise.
    event.preventDefault();

    onResize(clamp(size + direction * KEYBOARD_STEP_PX, min, max));
  };

  const className = ["split", `split--${orientation}`, isDragging ? "split--dragging" : null]
    .filter((token) => token !== null)
    .join(" ");

  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={size}
      className={className}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      role="separator"
      tabIndex={0}
    >
      <span className="split__line" />
    </div>
  );
};

export { SplitController };
export type { TSplitControllerProps, TSplitOrientation };
