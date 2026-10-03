import type { Rect } from "../src/geometry";
import type { Preview } from "./pages";

const padding = 28;
const checkerStep = 8;

// A checkerboard, so an asset painted in the darkest palette color stays visible.
const paintBackdrop = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void => {
  ctx.save();
  ctx.fillStyle = "#2a3340";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#222a36";

  for (let y = 0; y < height; y += checkerStep) {
    for (let x = 0; x < width; x += checkerStep) {
      const odd = (x / checkerStep + y / checkerStep) % 2 === 1;

      if (odd) {
        ctx.fillRect(x, y, checkerStep, checkerStep);
      }
    }
  }

  ctx.restore();
};

const paintFrameOutline = (ctx: CanvasRenderingContext2D, bounds: Rect): void => {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(242, 246, 250, 0.35)";
  ctx.strokeRect(bounds.x - 0.5, bounds.y - 0.5, bounds.width + 1, bounds.height + 1);
  ctx.restore();
};

const paint = (canvas: HTMLCanvasElement, preview: Preview): void => {
  const ratio = window.devicePixelRatio || 1;
  const width = preview.size.width + padding * 2;
  const height = preview.size.height + padding * 2;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas 2d context is not available");
  }

  ctx.scale(ratio, ratio);
  paintBackdrop(ctx, width, height);

  const bounds: Rect = {
    x: padding,
    y: padding,
    width: preview.size.width,
    height: preview.size.height,
  };

  preview.draw(ctx, bounds);
  paintFrameOutline(ctx, bounds);
};

const createTile = (preview: Preview): HTMLElement => {
  const tile = document.createElement("article");
  tile.className = "tile";

  const title = document.createElement("h2");
  title.textContent = preview.title;

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${preview.size.width} × ${preview.size.height}`;

  const canvas = document.createElement("canvas");
  paint(canvas, preview);

  tile.append(title, meta, canvas);

  return tile;
};

export { createTile };
