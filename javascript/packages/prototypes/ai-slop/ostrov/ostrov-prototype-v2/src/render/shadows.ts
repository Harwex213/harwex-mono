import { config } from "@hw/ostrov-prototype-v2-config";
import { WALL_DEPTH } from "../hex/layout";
import type { Island } from "../map/world";
import { hexToRgb } from "./palette";

/**
 * The soft blot of shade under a floating island.
 *
 * It lives on the 2D canvas, under the tiles, and not on the WebGL cloud layer.
 * The cloud layer knows nothing about island silhouettes, so putting the shadow
 * there would mean uploading eighty rectangles a frame and reproducing the
 * camera transform in the shader — while on the 2D canvas the shadow is already
 * inside the same transform as the island it belongs to, which is what makes it
 * scale correctly with the zoom for free. It also has to be covered by whatever
 * island stands in front of it, and painting order on one canvas gives that.
 *
 * One shadow per island, not one per tile: at eighty islands the whole pass is
 * eighty stretched blits of a single small sprite, which costs the same at every
 * zoom and works unchanged on the coarse level-of-detail path.
 *
 * The sprite is drawn once into an offscreen canvas. A per-island radial
 * gradient would be a fresh gradient object eighty times a frame; a blit of a
 * prepared bitmap is one composite.
 */

/** Side of the sprite in pixels. It is only ever stretched, so it stays small. */
const SPRITE_SIZE = 128;

/** Light comes from the upper left — see `EDGE_LIGHT` in `tiles.ts`. */
let sprite: HTMLCanvasElement | null = null;

function buildSprite(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is not available");
  }
  const half = SPRITE_SIZE / 2;
  const rgb = hexToRgb(config.render.islandShadowColor);
  const core = Math.min(0.98, Math.max(0, 1 - config.render.islandShadowBlur));
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`);
  gradient.addColorStop(core, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.92)`);
  // Two stops across the feather rather than one: a straight linear ramp reads
  // as a flat disc with a hard-edged halo, and this leans the falloff towards
  // the outside so the blot keeps a soft body.
  gradient.addColorStop(core + (1 - core) * 0.45, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`);
  gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return canvas;
}

/**
 * Lays the island's shadow on the cloud below it.
 *
 * `level` is the island's fog level: a remembered island casts a fainter shadow
 * and an unexplored one is never handed to this function at all, because a
 * shadow with nothing above it would mark the position of an island the player
 * has not found.
 */
function drawIslandShadow(ctx: CanvasRenderingContext2D, island: Island, level: number): void {
  const knobs = config.render;
  const alpha = knobs.islandShadowOpacity * level;
  if (alpha <= 0.004) {
    return;
  }
  sprite = sprite ?? buildSprite();
  const bounds = island.bounds;
  // The top faces end where the cliff walls begin, so the footprint of the
  // island is its box minus the drop of the walls.
  const footHeight = Math.max(1, bounds.maxY - bounds.minY - WALL_DEPTH);
  const width = (bounds.maxX - bounds.minX) * knobs.islandShadowSpread;
  const height = footHeight * knobs.islandShadowSpread;
  // Anchored on the foot of the cliffs rather than on the middle of the island:
  // centred on the island the blot would sit entirely behind it and never be
  // seen at all, and what sells a floating volume is the shade that falls past
  // its own silhouette onto the cloud below.
  const centreX = (bounds.minX + bounds.maxX) / 2 + knobs.islandShadowOffsetX;
  const centreY = bounds.maxY + knobs.islandShadowOffsetY;
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, centreX - width / 2, centreY - height / 2, width, height);
  ctx.globalAlpha = 1;
}

export { drawIslandShadow };
