import type { ProvinceLayer } from "../../../domain/index";

// The canvas copy of the province layer, so the renderer can `drawImage` it
// under the view transform. The layer itself is pure; each frame this copy takes
// the layer's dirty rectangle and uploads only those pixels.

class LayerCanvas {
  readonly layer: ProvinceLayer;
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;

  private readonly ctx: CanvasRenderingContext2D;

  constructor(layer: ProvinceLayer) {
    this.layer = layer;
    this.width = layer.width;
    this.height = layer.height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = layer.width;
    this.canvas.height = layer.height;

    const ctx = this.canvas.getContext("2d");

    if (!ctx) {
      throw new Error("2d canvas context unavailable");
    }

    this.ctx = ctx;

    // A new copy starts from the whole layer, whatever was written before it
    // existed. The pending dirty rectangle is covered by that and dropped.
    layer.takeDirty();
    this.upload({ x: 0, y: 0, w: layer.width, h: layer.height });
  }

  sync(): void {
    const rect = this.layer.takeDirty();

    if (rect) {
      this.upload(rect);
    }
  }

  private upload(rect: { x: number; y: number; w: number; h: number }): void {
    if (rect.w <= 0 || rect.h <= 0) {
      return;
    }

    const words = this.layer.readRect(rect);
    // Two views over one buffer, so the byte order the canvas expects and the
    // word order of the layer agree on any machine.
    const bytes = new Uint8ClampedArray(words.buffer as ArrayBuffer);

    this.ctx.putImageData(new ImageData(bytes, rect.w, rect.h), rect.x, rect.y);
  }
}

export { LayerCanvas };
