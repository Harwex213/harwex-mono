import { createRng } from "../map/rng";
import type { Camera } from "../state/camera";
import { SKY_BOTTOM, SKY_MID, SKY_TOP } from "./palette";

type Puff = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  warm: number;
};

/** Size of the wrapping cloud field, in background units. */
const FIELD_WIDTH = 2600;
const FIELD_HEIGHT = 1700;
const PUFF_COUNT = 120;
const PARALLAX = 0.22;

type PuffTone = "light" | "warm" | "shadow";

const PUFF_CORE: Record<PuffTone, string> = {
  light: "255, 255, 255",
  warm: "253, 244, 233",
  shadow: "116, 150, 178",
};

/** One soft blob, rasterised once and reused for every puff on screen. */
function createPuffSprite(tone: PuffTone): HTMLCanvasElement {
  const size = 256;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const rgb = PUFF_CORE[tone];
  gradient.addColorStop(0, `rgba(${rgb}, 1)`);
  gradient.addColorStop(0.42, `rgba(${rgb}, 0.7)`);
  gradient.addColorStop(0.72, `rgba(${rgb}, 0.22)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

function createPuffs(seed: number): Puff[] {
  const rng = createRng(seed);
  const puffs: Puff[] = [];
  for (let index = 0; index < PUFF_COUNT; index += 1) {
    puffs.push({
      x: rng() * FIELD_WIDTH,
      y: rng() * FIELD_HEIGHT,
      radius: 70 + rng() * 210,
      alpha: 0.22 + rng() * 0.62,
      warm: rng(),
    });
  }
  return puffs;
}

/**
 * Sky and clouds. The cloud field wraps, so panning never runs off the edge of
 * it, and it moves slower than the island to sell the depth.
 */
class Background {
  private readonly sprites: Record<PuffTone, HTMLCanvasElement> = {
    light: createPuffSprite("light"),
    warm: createPuffSprite("warm"),
    shadow: createPuffSprite("shadow"),
  };

  private readonly puffs = createPuffs(0x51a7d3);

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, camera: Camera): void {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, SKY_TOP);
    sky.addColorStop(0.45, SKY_MID);
    sky.addColorStop(1, SKY_BOTTOM);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const zoom = 0.55 + camera.scale * 0.45;
    const stepX = Math.max(FIELD_WIDTH * zoom, width + 900);
    const stepY = Math.max(FIELD_HEIGHT * zoom, height + 900);
    const shiftX = -camera.x * PARALLAX * camera.scale;
    const shiftY = -camera.y * PARALLAX * camera.scale;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (const puff of this.puffs) {
      const tone: PuffTone = puff.warm > 0.82 ? "warm" : puff.warm < 0.34 ? "shadow" : "light";
      const sprite = this.sprites[tone];
      const size = puff.radius * 2 * zoom;
      const baseX = wrap(puff.x * zoom + shiftX, stepX);
      const baseY = wrap(puff.y * zoom + shiftY, stepY);
      ctx.globalAlpha = puff.alpha;
      for (let ox = 0; ox <= 1; ox += 1) {
        for (let oy = 0; oy <= 1; oy += 1) {
          const x = baseX - ox * stepX;
          const y = baseY - oy * stepY;
          if (x + size < 0 || x - size > width || y + size < 0 || y - size > height) {
            continue;
          }
          ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
        }
      }
    }
    ctx.restore();

    // Soft halo so the island sits in a pool of light, as in the reference.
    const haloX = width / 2 - camera.x * camera.scale;
    const haloY = height / 2 - camera.y * camera.scale;
    const haloRadius = 620 * camera.scale;
    const halo = ctx.createRadialGradient(haloX, haloY, 0, haloX, haloY, haloRadius);
    halo.addColorStop(0, "rgba(255, 255, 255, 0.22)");
    halo.addColorStop(0.6, "rgba(255, 255, 255, 0.08)");
    halo.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);
  }
}

function wrap(value: number, step: number): number {
  return ((value % step) + step) % step;
}

export { Background };
