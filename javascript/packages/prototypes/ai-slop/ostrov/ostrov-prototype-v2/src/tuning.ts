/**
 * Local feel tunables.
 *
 * These live here, not in `@hw/ostrov-prototype-v2-config`, because the config
 * package is owned by another change right now. Every constant below is a
 * candidate for the config schema later; see the report note next to each group.
 */

/* --- Idle float ------------------------------------------------------------
 *
 * The island drifts gently while nothing is happening. The offset is in SCREEN
 * pixels, applied after the camera transform, so the drift covers the same
 * distance on screen at every zoom level. A world-space offset would grow with
 * the scale and read as a bounce when zoomed in.
 *
 * Two sines with unrelated periods are summed on the vertical axis and a third,
 * slower and smaller one moves the horizontal axis, so the motion never repeats
 * on an obvious beat.
 */

/** Peak of the main vertical drift, in screen pixels. */
const IDLE_FLOAT_RISE_AMPLITUDE = 4.2;

/** Period of the main vertical drift, in seconds. */
const IDLE_FLOAT_RISE_PERIOD = 6.4;

/** Peak of the second vertical sine that breaks up the main one, in screen pixels. */
const IDLE_FLOAT_WOBBLE_AMPLITUDE = 1.3;

/** Period of that second vertical sine, in seconds. Deliberately not a factor of the main one. */
const IDLE_FLOAT_WOBBLE_PERIOD = 2.7;

/** Phase offset of the second vertical sine, in radians. */
const IDLE_FLOAT_WOBBLE_PHASE = 2.1;

/** Peak of the horizontal sway, in screen pixels. Smaller than the rise, so the motion reads as vertical. */
const IDLE_FLOAT_SWAY_AMPLITUDE = 2.1;

/** Period of the horizontal sway, in seconds. */
const IDLE_FLOAT_SWAY_PERIOD = 9.3;

/** Phase offset of the horizontal sway, in radians. */
const IDLE_FLOAT_SWAY_PHASE = 0.7;

/** How long the camera must be at rest before the float starts fading in, in seconds. */
const IDLE_FLOAT_SETTLE_DELAY = 0.22;

/** Time from a dead-still island to full drift, in seconds. */
const IDLE_FLOAT_FADE_IN = 1.1;

/** Time from full drift back to dead still once the input starts, in seconds. */
const IDLE_FLOAT_FADE_OUT = 0.3;

/* --- Wheel zoom easing -----------------------------------------------------
 *
 * A wheel notch animates the scale to its target instead of applying it at
 * once. Only the wheel: a two-finger pinch tracks the fingers and stays direct.
 */

/** Length of the eased ride to the new scale, in seconds. */
const ZOOM_EASE_DURATION = 0.16;

export {
  IDLE_FLOAT_FADE_IN,
  IDLE_FLOAT_FADE_OUT,
  IDLE_FLOAT_RISE_AMPLITUDE,
  IDLE_FLOAT_RISE_PERIOD,
  IDLE_FLOAT_SETTLE_DELAY,
  IDLE_FLOAT_SWAY_AMPLITUDE,
  IDLE_FLOAT_SWAY_PERIOD,
  IDLE_FLOAT_SWAY_PHASE,
  IDLE_FLOAT_WOBBLE_AMPLITUDE,
  IDLE_FLOAT_WOBBLE_PERIOD,
  IDLE_FLOAT_WOBBLE_PHASE,
  ZOOM_EASE_DURATION,
};
