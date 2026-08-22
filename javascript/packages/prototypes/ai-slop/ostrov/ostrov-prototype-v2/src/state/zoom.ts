import type { Camera } from "./camera";
import { clampScale, screenToWorld } from "./camera";
import { ZOOM_EASE_DURATION } from "../tuning";

/** Below this the two scales are the same number and there is nothing to animate. */
const SCALE_EPSILON = 1e-6;

/** Light ease-in-out: zero slope at both ends, no overshoot. */
function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

/**
 * The eased ride a wheel notch takes the scale on.
 *
 * The animation is written as a fixed anchor rather than as a camera tween. It
 * keeps the world point that sat under the cursor plus the screen point it sat
 * at, and rebuilds the whole camera from the scale of the moment on every frame.
 * That way the anchor holds on every intermediate frame, not just the last one,
 * which a straight interpolation of the two end cameras would not give.
 *
 * Scale is interpolated geometrically, because a wheel notch is a multiplier:
 * two notches of the same size have to feel like the same step at any zoom.
 *
 * A two-finger pinch never comes through here. A pinch already tracks the
 * fingers frame by frame, so easing it would only add lag.
 */
class ZoomEase {
  private running = false;
  private elapsed = 0;
  private fromScale = 1;
  private toScale = 1;
  private anchorX = 0;
  private anchorY = 0;
  private worldX = 0;
  private worldY = 0;

  get active(): boolean {
    return this.running;
  }

  /** The scale the ride is heading for, whether or not one is running. */
  target(camera: Camera): number {
    return this.running ? this.toScale : camera.scale;
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Aims at `factor` times the scale this ride was already heading for, so wheel
   * events fired back to back accumulate instead of cancelling each other. The
   * ride restarts from wherever the camera is right now, which is what keeps a
   * retarget mid-flight smooth.
   *
   * `floatX` and `floatY` are the idle-float offset currently on screen. The
   * anchor is taken in the same space the picture is drawn in, so the world
   * point under the cursor is the one the user is actually looking at.
   */
  retarget(
    camera: Camera,
    width: number,
    height: number,
    px: number,
    py: number,
    floatX: number,
    floatY: number,
    factor: number,
  ): void {
    const goal = clampScale(this.target(camera) * factor);
    if (Math.abs(goal - camera.scale) < SCALE_EPSILON) {
      this.toScale = goal;
      this.running = false;
      return;
    }
    const anchor = screenToWorld(camera, width, height, px - floatX, py - floatY);
    this.worldX = anchor.x;
    this.worldY = anchor.y;
    this.anchorX = px;
    this.anchorY = py;
    this.fromScale = camera.scale;
    this.toScale = goal;
    this.elapsed = 0;
    this.running = true;
  }

  /**
   * Advances the ride by `delta` seconds and returns the camera for this frame,
   * or null once it has arrived. The float offset is passed in again so the
   * anchor keeps holding while the drift fades out underneath the zoom.
   */
  step(delta: number, width: number, height: number, floatX: number, floatY: number): Camera | null {
    if (!this.running || delta < 0) {
      return null;
    }
    this.elapsed += delta;
    const progress = Math.min(1, this.elapsed / ZOOM_EASE_DURATION);
    const eased = smoothstep(progress);
    const scale = progress >= 1 ? this.toScale : this.fromScale * (this.toScale / this.fromScale) ** eased;
    if (progress >= 1) {
      this.running = false;
    }
    return {
      x: this.worldX - (this.anchorX - floatX - width / 2) / scale,
      y: this.worldY - (this.anchorY - floatY - height / 2) / scale,
      scale,
    };
  }
}

export { ZoomEase };
