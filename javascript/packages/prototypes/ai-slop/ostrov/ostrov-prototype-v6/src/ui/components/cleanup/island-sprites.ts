import { getBiome } from "../../../core/biomes";
import { HEX_ART } from "../../../core/hex-art";
import { HEX_SIZE, hexBounds, hexToPixel } from "../../../core/hex";
import { groundSeed, renderIslandGround } from "../../ground/render-island-ground";
import type { TCleanupHex, TCleanupSide } from "../../../core/cleanup-level";

/**
 * Every island of the cleanup scene baked once into bitmaps. The island is a
 * rigid body that never rotates, so one image per island is enough: the frame
 * loop only moves it.
 *
 * The ground comes from the same painter as the island page, with the same
 * seed for the player's island, so it looks exactly like the build phase. The
 * sprites use the island page's sizes: they must match `island-canvas.tsx`.
 */

/** Must match DEAD_SPAN of `island-canvas.tsx`. */
const DEAD_SPAN = HEX_SIZE * 0.8;
/** Bitmap pixels per world unit. The camera zooms to 1.8 at most. */
const DENSITY = 2;
/** Room around the hexes for the keel and the shadow blur. */
const MARGIN = HEX_SIZE * 0.9;
/** How far the rock keel hangs below the ground, in world units. */
const KEEL_DEPTH = HEX_SIZE * 1.25;
const KEEL_STEPS = 9;
/** Each step down the keel shrinks toward the island centre, so it tapers. */
const KEEL_TAPER = 0.045;
const SHADOW_BLUR = 64;
/** Ink of the antique map: every rim, outline and hatch line. */
const INK = "#2a1f14";
const PLAYER_RIM = INK;
const ENEMY_RIM = "#4a1a10";
const STRONGHOLD_RING = "#d8b45c";
const TOXIC_TINT = "#9bff4f";
const SQRT_3 = Math.sqrt(3);

type TIslandSprite = {
  /** Keel, ground, grid, tint and sprites, in one image. */
  readonly body: HTMLCanvasElement;
  /** The soft dark shape the island casts on the clouds far below. */
  readonly shadow: HTMLCanvasElement;
  /** The body as one fog-coloured shape, for an island that falls away. */
  readonly silhouette: HTMLCanvasElement;
  /** World rectangle of all three images, relative to the island origin. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const images = new Map<string, Promise<HTMLImageElement>>();

const loadImage = (src: string) => {
  const cached = images.get(src);
  if (cached) {
    return cached;
  }

  const promise = new Promise<HTMLImageElement>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(image);
    image.src = src;
  });
  images.set(src, promise);

  return promise;
};

const hexPath = (context: CanvasRenderingContext2D, x: number, y: number, size: number) => {
  for (let corner = 0; corner < 6; corner += 1) {
    const angle = ((60 * corner - 30) * Math.PI) / 180;
    const cx = x + size * Math.cos(angle);
    const cy = y + size * Math.sin(angle);
    if (corner === 0) {
      context.moveTo(cx, cy);
    } else {
      context.lineTo(cx, cy);
    }
  }

  context.closePath();
};

/** The union of all hexes as one path. Every hex winds the same way. */
const silhouettePath = (context: CanvasRenderingContext2D, hexes: readonly TCleanupHex[], size: number, dy = 0) => {
  context.beginPath();
  for (const hex of hexes) {
    const center = hexToPixel(hex.q, hex.r, HEX_SIZE);
    hexPath(context, center.x, center.y + dy, size);
  }
};

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * DENSITY));
  canvas.height = Math.max(1, Math.ceil(height * DENSITY));

  return canvas;
};

/**
 * The ground of the island. It is the one place that paints terrain, so a new
 * ground painter only changes this function. Without WebGL2 the hexes fall
 * back to their flat biome colours.
 */
const drawIslandGround = async (
  context: CanvasRenderingContext2D,
  hexes: readonly TCleanupHex[],
  seedKey: string,
  rimColor: string,
) => {
  const ground = await renderIslandGround(hexes, {
    seed: groundSeed(seedKey),
    density: DENSITY,
    rimColor,
  }).catch(() => null);

  if (ground) {
    context.drawImage(ground.canvas, ground.x, ground.y, ground.width, ground.height);
    ground.canvas.width = 0;

    return;
  }

  for (const hex of hexes) {
    const center = hexToPixel(hex.q, hex.r, HEX_SIZE);
    context.beginPath();
    hexPath(context, center.x, center.y, HEX_SIZE + 0.5);
    context.fillStyle = getBiome(hex.biome).color;
    context.fill();
  }

  silhouettePath(context, hexes, HEX_SIZE);
  context.strokeStyle = rimColor;
  context.lineWidth = 3.5;
  context.stroke();
};

const drawSprites = async (context: CanvasRenderingContext2D, hexes: readonly TCleanupHex[]) => {
  for (const hex of hexes) {
    const center = hexToPixel(hex.q, hex.r, HEX_SIZE);

    if (hex.toxicity > 0) {
      context.beginPath();
      hexPath(context, center.x, center.y, HEX_SIZE);
      context.globalAlpha = Math.min(1, hex.toxicity / 160);
      context.fillStyle = TOXIC_TINT;
      context.fill();
      context.globalAlpha = 1;
    }

    // The faint hex grid, so the island still reads as hexes.
    context.beginPath();
    hexPath(context, center.x, center.y, HEX_SIZE - 1);
    context.strokeStyle = "rgba(10, 16, 12, 0.22)";
    context.lineWidth = 1.2;
    context.stroke();

    if (hex.dead) {
      const skull = await loadImage(HEX_ART.dead);
      context.drawImage(skull, center.x - DEAD_SPAN / 2, center.y - DEAD_SPAN / 2, DEAD_SPAN, DEAD_SPAN);
    }

    // Buildings and the stronghold are not baked: they take damage and fall
    // in battle, so the renderer draws them every frame (`drawStructures`).
    if (hex.stronghold) {
      context.beginPath();
      hexPath(context, center.x, center.y, HEX_SIZE - 4 / SQRT_3);
      context.strokeStyle = STRONGHOLD_RING;
      context.lineWidth = 4;
      context.stroke();
    }
  }
};

/**
 * The rock under the island: stacked slices of the silhouette, each lower one
 * smaller and darker, so the island hangs over the void like a keel. Ink
 * hatching shades it, and an ink line traces its outer edge.
 */
const drawKeel = (context: CanvasRenderingContext2D, hexes: readonly TCleanupHex[], centerX: number, centerY: number) => {
  const slice = (step: number) => {
    const t = step / KEEL_STEPS;
    const shrink = 1 - KEEL_TAPER * step;
    context.save();
    context.translate(centerX, centerY + KEEL_DEPTH * t);
    context.scale(shrink, shrink);
    context.translate(-centerX, -centerY);
    silhouettePath(context, hexes, HEX_SIZE * 0.97);
    context.restore();
  };

  for (let step = KEEL_STEPS; step >= 1; step -= 1) {
    const t = step / KEEL_STEPS;
    // Sepia rock: warm near the ground, darker toward the tip.
    const shade = Math.round(150 - t * 70);
    slice(step);
    context.fillStyle = `rgb(${shade}, ${Math.round(shade * 0.78)}, ${Math.round(shade * 0.55)})`;
    context.fill();
    context.lineWidth = 1.3;
    context.strokeStyle = "rgba(42, 31, 20, 0.55)";
    context.stroke();
  }

  // Hatching over the whole keel, denser toward its tip.
  context.save();
  context.beginPath();
  for (let step = KEEL_STEPS; step >= 1; step -= 1) {
    slice(step);
  }

  silhouettePath(context, hexes, HEX_SIZE * 0.97, KEEL_DEPTH * 0.98);
  context.clip();
  context.strokeStyle = "rgba(42, 31, 20, 0.55)";
  context.lineWidth = 1.2;
  const bounds = hexBounds(hexes, HEX_SIZE);
  context.beginPath();
  for (let x = bounds.minX - KEEL_DEPTH * 2; x < bounds.maxX + KEEL_DEPTH; x += 7) {
    context.moveTo(x, bounds.minY);
    context.lineTo(x + (bounds.maxY - bounds.minY + KEEL_DEPTH) * 0.6, bounds.maxY + KEEL_DEPTH);
  }

  context.stroke();
  context.restore();

  // The tip of the keel, inked.
  slice(KEEL_STEPS);
  context.lineWidth = 2.2;
  context.strokeStyle = INK;
  context.stroke();
};

/** Bakes one island. `seedKey` must be the island page's seed for the player's island. */
const bakeIsland = async (hexes: readonly TCleanupHex[], side: TCleanupSide, seedKey: string): Promise<TIslandSprite> => {
  const bounds = hexBounds(hexes, HEX_SIZE);
  const x = bounds.minX - MARGIN;
  const y = bounds.minY - MARGIN;
  const width = bounds.maxX - bounds.minX + MARGIN * 2;
  const height = bounds.maxY - bounds.minY + MARGIN * 2 + KEEL_DEPTH;
  const rim = side === "player" ? PLAYER_RIM : ENEMY_RIM;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  const body = createCanvas(width, height);
  const context = body.getContext("2d");
  if (!context) {
    throw new Error("No 2D context for an island sprite");
  }

  context.setTransform(DENSITY, 0, 0, DENSITY, -x * DENSITY, -y * DENSITY);
  drawKeel(context, hexes, centerX, centerY);
  await drawIslandGround(context, hexes, seedKey, rim);

  // A second, thin ink line around the coast, as the map draws every shore.
  silhouettePath(context, hexes, HEX_SIZE * 1.035);
  context.lineWidth = 1.2;
  context.strokeStyle = "rgba(42, 31, 20, 0.6)";
  context.stroke();

  await drawSprites(context, hexes);

  const shadow = createCanvas(width, height);
  const shadowContext = shadow.getContext("2d");
  if (shadowContext) {
    shadowContext.setTransform(DENSITY, 0, 0, DENSITY, -x * DENSITY, -y * DENSITY);
    shadowContext.filter = `blur(${SHADOW_BLUR}px)`;
    shadowContext.fillStyle = "rgba(8, 10, 12, 1)";
    silhouettePath(shadowContext, hexes, HEX_SIZE * 0.92);
    shadowContext.fill();
  }

  const silhouette = createCanvas(width, height);
  const silhouetteContext = silhouette.getContext("2d");
  if (silhouetteContext) {
    silhouetteContext.drawImage(body, 0, 0);
    silhouetteContext.globalCompositeOperation = "source-in";
    silhouetteContext.fillStyle = "#262c2f";
    silhouetteContext.fillRect(0, 0, silhouette.width, silhouette.height);
  }

  return { body, shadow, silhouette, x, y, width, height };
};

const releaseSprite = (sprite: TIslandSprite) => {
  sprite.body.width = 0;
  sprite.shadow.width = 0;
  sprite.silhouette.width = 0;
};

export type { TIslandSprite };
export { bakeIsland, loadImage, releaseSprite };
