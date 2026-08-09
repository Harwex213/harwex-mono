import { config } from "@hw/ostrov-prototype-v2-config";

/**
 * Pan momentum: a smoothed reading of how fast the pointer was moving, and the
 * glide that reading launches when the pointer comes up.
 *
 * Speeds are screen pixels per second throughout. The caller divides by the
 * camera scale to turn a step into world units.
 */

/** Time constant of the velocity smoothing, in seconds. */
const SMOOTHING_TAU = 0.06;

/** A pointer that has been still for this long is released at rest. */
const STALE_SAMPLE = 0.09;

/** The glide ends below this speed, so it settles instead of creeping. */
const STOP_SPEED = 8;

type Velocity = {
  x: number;
  y: number;
};

/**
 * Exponential moving average of the pointer velocity. A single move event is
 * far too jittery to launch a glide with: one slow frame at the end of a fast
 * flick would kill the momentum, and one fast frame would double it.
 */
class PanVelocity {
  private x = 0;
  private y = 0;
  private stamp = 0;

  /** Drops the history and starts a fresh gesture at `time` (milliseconds). */
  reset(time: number): void {
    this.x = 0;
    this.y = 0;
    this.stamp = time;
  }

  /** Folds one pointer step, in screen pixels, into the average. */
  sample(dx: number, dy: number, time: number): void {
    // A one-millisecond floor keeps coalesced events with equal stamps finite.
    const delta = Math.max(1, time - this.stamp) / 1000;
    this.stamp = time;
    const weight = 1 - Math.exp(-delta / SMOOTHING_TAU);
    this.x += (dx / delta - this.x) * weight;
    this.y += (dy / delta - this.y) * weight;
  }

  /** Velocity to release with, aged by the time since the last move event. */
  release(time: number): Velocity {
    const idle = (time - this.stamp) / 1000;
    if (idle > STALE_SAMPLE) {
      return { x: 0, y: 0 };
    }
    const decay = Math.exp(-idle / SMOOTHING_TAU);
    return { x: this.x * decay, y: this.y * decay };
  }
}

/**
 * The glide itself. Decay is exponential in real elapsed time, so the same
 * flick travels the same distance at 60 Hz and at 120 Hz.
 */
class PanGlide {
  private x = 0;
  private y = 0;
  private running = false;

  get active(): boolean {
    return this.running;
  }

  /**
   * Starts a glide from a release velocity. A slow release starts nothing, and
   * a hard flick is capped so the island cannot be thrown off screen.
   */
  launch(velocity: Velocity): boolean {
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed < config.camera.panInertiaMinSpeed) {
      this.stop();
      return false;
    }
    const limit = Math.min(1, config.camera.panInertiaMaxSpeed / speed);
    this.x = velocity.x * limit;
    this.y = velocity.y * limit;
    this.running = true;
    return true;
  }

  stop(): void {
    this.x = 0;
    this.y = 0;
    this.running = false;
  }

  /**
   * Kills the momentum on the axes that have just run into a camera bound.
   *
   * Without this the glide keeps pushing against the clamp for as long as its
   * friction takes to run out: the camera cannot move, so the picture sits still
   * while the loop redraws it, and any wobble on the free axis reads as a stall.
   * A glide flicked into a corner loses both axes and ends there.
   */
  arrest(axisX: boolean, axisY: boolean): void {
    if (axisX) {
      this.x = 0;
    }
    if (axisY) {
      this.y = 0;
    }
    if (this.x === 0 && this.y === 0) {
      this.running = false;
    }
  }

  /**
   * Advances the glide by `delta` seconds and returns the screen-pixel step for
   * this frame, or null once it has come to rest.
   */
  step(delta: number): Velocity | null {
    if (!this.running || delta <= 0) {
      return null;
    }
    const friction = config.camera.panInertiaFriction;
    const decay = Math.exp(-friction * delta);
    // Integral of v(t) = v0 * exp(-friction * t) over the frame.
    const travel = (1 - decay) / friction;
    const step = { x: this.x * travel, y: this.y * travel };
    this.x *= decay;
    this.y *= decay;
    if (Math.hypot(this.x, this.y) < STOP_SPEED) {
      this.stop();
    }
    return step;
  }
}

export type { Velocity };
export { PanGlide, PanVelocity };
