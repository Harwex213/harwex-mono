import { SECTOR_SIZE, WORLD_H, WORLD_W } from "../config";
import { mulberry32 } from "../rng";
import type { Sector } from "../types";
import type { World } from "../world";
import { PALETTE, TERRAIN_COLORS } from "./palette";

/** Bleed around the sector grid so coastlines are not clipped. */
const MARGIN = 56;

type LandLayer = {
  canvas: HTMLCanvasElement;
  margin: number;
};

let layer: LandLayer | null = null;

function landLayer(world: World): LandLayer {
  if (!layer) {
    const canvas = document.createElement("canvas");
    canvas.width = WORLD_W + MARGIN * 2;
    canvas.height = WORLD_H + MARGIN * 2;
    layer = { canvas, margin: MARGIN };
    world.landDirty = true;
  }
  if (world.landDirty) {
    paint(layer, world);
    world.landDirty = false;
  }
  return layer;
}

function paint(target: LandLayer, world: World): void {
  const ctx = target.canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
  ctx.translate(MARGIN, MARGIN);

  const visible = world.sectors.filter((sector) => sector.state !== "locked");
  for (const sector of visible) {
    coast(ctx, sector);
  }
  for (const sector of world.sectors) {
    if (sector.state === "locked") {
      drawLocked(ctx, sector);
      continue;
    }
    drawLand(ctx, sector);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function rectOf(sector: Sector): { x: number; y: number; size: number } {
  return { x: sector.col * SECTOR_SIZE, y: sector.row * SECTOR_SIZE, size: SECTOR_SIZE };
}

function alphaOf(sector: Sector): number {
  return sector.state === "owned" ? 1 : 0.35 + sector.attach * 0.65;
}

function coast(ctx: CanvasRenderingContext2D, sector: Sector): void {
  const rect = rectOf(sector);
  ctx.globalAlpha = alphaOf(sector) * 0.9;
  ctx.fillStyle = PALETTE.sandDark;
  ctx.fillRect(rect.x - 16, rect.y - 16, rect.size + 32, rect.size + 32);
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(rect.x - 9, rect.y - 9, rect.size + 18, rect.size + 18);
  ctx.globalAlpha = 1;
}

function drawLand(ctx: CanvasRenderingContext2D, sector: Sector): void {
  const rect = rectOf(sector);
  const colors = TERRAIN_COLORS[sector.terrain];
  ctx.globalAlpha = alphaOf(sector);

  ctx.fillStyle = colors.base;
  ctx.fillRect(rect.x, rect.y, rect.size, rect.size);

  const rng = mulberry32(sector.index * 7919 + 13);
  ctx.fillStyle = colors.shade;
  for (let i = 0; i < 90; i += 1) {
    const x = rect.x + rng() * rect.size;
    const y = rect.y + rng() * rect.size;
    const size = 3 + rng() * 9;
    ctx.globalAlpha = alphaOf(sector) * (0.1 + rng() * 0.18);
    ctx.fillRect(x, y, size, size * 0.6);
  }
  ctx.globalAlpha = alphaOf(sector);

  for (const item of sector.decor) {
    drawDecor(ctx, sector, item.x, item.y, item.size, item.variant);
  }

  if (sector.state === "contested") {
    ctx.strokeStyle = "rgba(255, 108, 108, 0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.strokeRect(rect.x + 2, rect.y + 2, rect.size - 4, rect.size - 4);
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

function drawLocked(ctx: CanvasRenderingContext2D, sector: Sector): void {
  const rect = rectOf(sector);
  const colors = TERRAIN_COLORS[sector.terrain];
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = colors.shade;
  ctx.fillRect(rect.x + 10, rect.y + 10, rect.size - 20, rect.size - 20);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = PALETTE.fog;
  ctx.fillRect(rect.x + 10, rect.y + 10, rect.size - 20, rect.size - 20);
  ctx.globalAlpha = 0.5;
  for (const item of sector.decor) {
    drawDecor(ctx, sector, item.x, item.y, item.size * 0.8, item.variant);
  }
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "rgba(150, 200, 230, 0.5)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 12]);
  ctx.strokeRect(rect.x + 10, rect.y + 10, rect.size - 20, rect.size - 20);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawDecor(
  ctx: CanvasRenderingContext2D,
  sector: Sector,
  x: number,
  y: number,
  size: number,
  variant: number,
): void {
  const colors = TERRAIN_COLORS[sector.terrain];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  ctx.beginPath();
  ctx.ellipse(0, 5, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  if (sector.terrain === "forest") {
    ctx.fillStyle = "#4a3524";
    ctx.fillRect(-2, -3, 4, 9);
    ctx.fillStyle = colors.decor;
    ctx.beginPath();
    ctx.moveTo(0, -18 - variant);
    ctx.lineTo(9, 2);
    ctx.lineTo(-9, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.beginPath();
    ctx.moveTo(0, -18 - variant);
    ctx.lineTo(9, 2);
    ctx.lineTo(2, 2);
    ctx.closePath();
    ctx.fill();
  } else if (sector.terrain === "crystal") {
    ctx.fillStyle = colors.decor;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(6, -2);
    ctx.lineTo(0, 5);
    ctx.lineTo(-6, -2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(6, -2);
    ctx.lineTo(0, -4);
    ctx.closePath();
    ctx.fill();
  } else if (sector.terrain === "ruins") {
    ctx.fillStyle = colors.decor;
    ctx.fillRect(-5, -14 - variant, 10, 18 + variant);
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.fillRect(1, -14 - variant, 4, 18 + variant);
  } else if (sector.terrain === "boss") {
    ctx.fillStyle = colors.decor;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(7, 4);
    ctx.lineTo(-7, 4);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = colors.decor;
    ctx.beginPath();
    ctx.ellipse(0, -2, 8, 6, variant, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.beginPath();
    ctx.ellipse(2, 0, 6, 4, variant, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export type { LandLayer };
export { landLayer, MARGIN };
