import type { Point } from "../hex/layout";
import {
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
} from "../tuning";

const TAU = Math.PI * 2;

const STILL: Point = { x: 0, y: 0 };

/** Zero slope at both ends, so the fade never starts or stops with a visible kick. */
function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

/**
 * The ambient drift of the island while the camera is at rest.
 *
 * The offset is in screen pixels and is applied on top of the camera transform,
 * so it stays the same size at every zoom level. Whoever draws with it must
 * subtract it again when turning a screen point back into a world point, or
 * picking drifts away from the picture.
 *
 * The clock runs whether or not the drift is showing. Interaction only pulls the
 * weight down to zero, it never rewinds the phase, so a fade-in always picks the
 * motion up where the sines happen to be instead of restarting them.
 */
class IdleFloat {
  private phase = 0;
  private weight = 0;
  private resting = 0;

  /** True while any drift is visible, so the caller knows to keep drawing. */
  get active(): boolean {
    return this.weight > 0;
  }

  /** Advances the clock by `delta` seconds. `atRest` is false while anything moves the camera. */
  update(delta: number, atRest: boolean): void {
    this.phase += delta;
    if (!atRest) {
      this.resting = 0;
      this.weight = Math.max(0, this.weight - delta / IDLE_FLOAT_FADE_OUT);
      return;
    }
    this.resting += delta;
    if (this.resting < IDLE_FLOAT_SETTLE_DELAY) {
      return;
    }
    this.weight = Math.min(1, this.weight + delta / IDLE_FLOAT_FADE_IN);
  }

  /** Screen-pixel offset for this frame. */
  offset(): Point {
    if (this.weight <= 0) {
      return STILL;
    }
    const gain = smoothstep(this.weight);
    const rise = IDLE_FLOAT_RISE_AMPLITUDE * Math.sin((TAU * this.phase) / IDLE_FLOAT_RISE_PERIOD);
    const wobble =
      IDLE_FLOAT_WOBBLE_AMPLITUDE *
      Math.sin((TAU * this.phase) / IDLE_FLOAT_WOBBLE_PERIOD + IDLE_FLOAT_WOBBLE_PHASE);
    const sway =
      IDLE_FLOAT_SWAY_AMPLITUDE * Math.sin((TAU * this.phase) / IDLE_FLOAT_SWAY_PERIOD + IDLE_FLOAT_SWAY_PHASE);
    return {
      x: sway * gain,
      y: (rise + wobble) * gain,
    };
  }
}

export { IdleFloat };
