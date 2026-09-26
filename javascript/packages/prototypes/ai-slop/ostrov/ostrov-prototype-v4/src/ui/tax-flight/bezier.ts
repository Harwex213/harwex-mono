import type { TScreenPoint } from "../../store/ui-state";

/**
 * The two pure functions the tax flights are drawn with. They hold no state and
 * touch no signal, so the layer can call them once per glyph per frame.
 */

const CUBE = 3;
const HALF = 0.5;
const EASE_SCALE = 4;

/** A point on the quadratic bezier `from → control → to` at parameter `t`. */
const quadPoint = (
  from: TScreenPoint,
  control: TScreenPoint,
  to: TScreenPoint,
  t: number,
): TScreenPoint => {
  const inverse = 1 - t;
  const fromWeight = inverse * inverse;
  const controlWeight = 2 * inverse * t;
  const toWeight = t * t;

  return {
    x: fromWeight * from.x + controlWeight * control.x + toWeight * to.x,
    y: fromWeight * from.y + controlWeight * control.y + toWeight * to.y,
  };
};

/** Slow out of the hex, fast in the middle, slow into the chip. */
const easeInOutCubic = (t: number): number => {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < HALF) {
    return EASE_SCALE * clamped * clamped * clamped;
  }

  return 1 - Math.pow(-2 * clamped + 2, CUBE) / 2;
};

export { easeInOutCubic, quadPoint };
