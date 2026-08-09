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

/* --- Building placement and construction -----------------------------------
 *
 * `buildTimeSec` in the config is balance time, not demo time: the castle takes
 * ten minutes. The prototype divides it, so the whole flow fits in one look.
 */

/** Divisor applied to `buildTimeSec`. The castle's 600 s becomes 6 s. */
const BUILD_TIME_SPEEDUP = 100;

/** Floor on a sped-up build, in seconds, so a cheap building still reads as built. */
const BUILD_TIME_MIN_SEC = 2.5;

/** Length of the confirmation beat played where a building was just laid, in seconds. */
const PLACEMENT_BEAT_SEC = 0.62;

/** Length of the beat played when a structure finishes, in seconds. */
const COMPLETION_BEAT_SEC = 0.95;

/** Opacity of the placement preview drawn under the cursor. */
const GHOST_ALPHA = 0.55;

/** Period of the marching dashes around the previewed hex, in seconds. */
const GHOST_DASH_PERIOD = 1.6;

/** Overall size of the drawn buildings, as a multiple of the hex-sized default. */
const BUILDING_ART_SCALE = 0.8;

/** Period of one flag wave, in seconds. */
const FLAG_WAVE_PERIOD = 1.35;

/**
 * Seconds the sawmill wheel takes to turn once.
 *
 * It replaces the chimney smoke as the idle cue of a working building: smoke is
 * a pale blob over pale stone and reads as nothing at map zoom, while a turning
 * disc is legible even when the building is thirty pixels tall.
 */
const WHEEL_SPIN_PERIOD = 5.2;

/** Period of the slow brightness pulse of the lit windows, in seconds. */
const WINDOW_GLOW_PERIOD = 4.7;

/** Period of one up-and-down trip of the construction hoist, in seconds. */
const HOIST_PERIOD = 1.7;

/* --- Hauling ---------------------------------------------------------------
 *
 * A producer sends its output to the castle as a crate that walks the road.
 * Speed, spacing, carried amount and the production speed-up are the designer's
 * and live in the `economy` group of the config; what is left here is the shape
 * of the crate and the beat it lands on.
 */

/** Floor on the pause between two parcels, in seconds, whatever the speed-up asks for. */
const PARCEL_MIN_INTERVAL_SEC = 0.2;

/** Half-width of a crate, in world units. Roughly a third of a hex. */
const PARCEL_SIZE = 11;

/** How far above the ground the crate rides, in world units. */
const PARCEL_LIFT = 13;

/** Peak of the carried bob, in world units. */
const PARCEL_BOB_AMPLITUDE = 2.6;

/** Period of that bob, in seconds. */
const PARCEL_BOB_PERIOD = 0.62;

/** Length of the beat played at the castle when a parcel lands, in seconds. */
const DELIVERY_BEAT_SEC = 0.85;

/** How far the credited amount floats up over that beat, in world units. */
const DELIVERY_RISE = 46;

export {
  BUILDING_ART_SCALE,
  BUILD_TIME_MIN_SEC,
  BUILD_TIME_SPEEDUP,
  COMPLETION_BEAT_SEC,
  DELIVERY_BEAT_SEC,
  DELIVERY_RISE,
  FLAG_WAVE_PERIOD,
  GHOST_ALPHA,
  GHOST_DASH_PERIOD,
  HOIST_PERIOD,
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
  PARCEL_BOB_AMPLITUDE,
  PARCEL_BOB_PERIOD,
  PARCEL_LIFT,
  PARCEL_MIN_INTERVAL_SEC,
  PARCEL_SIZE,
  PLACEMENT_BEAT_SEC,
  WHEEL_SPIN_PERIOD,
  WINDOW_GLOW_PERIOD,
  ZOOM_EASE_DURATION,
};
