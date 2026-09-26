import type { Point, Rect } from "./layout";

type Insets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const chrome: Insets = {
  top: 100,
  right: 40,
  bottom: 160,
  left: 40,
};

const minScale = 0.15;
const maxScale = 4;

const clamp = (value: number, low: number, high: number): number => {
  return Math.min(high, Math.max(low, value));
};

// The zoom and pan of the canvas. The camera keeps a scale and an offset in CSS
// pixels; the diagram is painted in world units and never learns about either.
class Camera {
  #scale: number = 1;
  #x: number = 0;
  #y: number = 0;

  get scale(): number {
    return this.#scale;
  }

  apply(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.#x, this.#y);
    ctx.scale(this.#scale, this.#scale);
  }

  toWorld(point: Point): Point {
    return {
      x: (point.x - this.#x) / this.#scale,
      y: (point.y - this.#y) / this.#scale,
    };
  }

  panBy(dx: number, dy: number): void {
    this.#x += dx;
    this.#y += dy;
  }

  // The world point under the cursor stays under the cursor.
  zoomAt(point: Point, factor: number): void {
    const next = clamp(this.#scale * factor, minScale, maxScale);
    const applied = next / this.#scale;

    this.#x = point.x - (point.x - this.#x) * applied;
    this.#y = point.y - (point.y - this.#y) * applied;
    this.#scale = next;
  }

  zoomBy(factor: number, size: Point): void {
    this.zoomAt(
      {
        x: size.x / 2,
        y: size.y / 2,
      },
      factor,
    );
  }

  // The toolbar and the legend float above the canvas, so the fit keeps the
  // diagram inside what they leave free.
  fit(bounds: Rect, size: Point, insets: Insets = chrome): void {
    const width = Math.max(1, size.x - insets.left - insets.right);
    const height = Math.max(1, size.y - insets.top - insets.bottom);
    const scale = clamp(Math.min(width / bounds.width, height / bounds.height), minScale, 1.2);

    this.#scale = scale;
    this.#x = insets.left + width / 2 - (bounds.x + bounds.width / 2) * scale;
    this.#y = insets.top + height / 2 - (bounds.y + bounds.height / 2) * scale;
  }

  focus(rect: Rect, size: Point): void {
    this.#x = size.x / 2 - (rect.x + rect.width / 2) * this.#scale;
    this.#y = size.y / 2 - (rect.y + rect.height / 2) * this.#scale;
  }
}

export { Camera };
export type { Insets };
