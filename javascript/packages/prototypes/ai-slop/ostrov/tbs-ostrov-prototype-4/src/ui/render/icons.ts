import { TERRAIN_STYLE } from "./palette";
import type { TPoint } from "../../domain/hex/layout";
import type { TArmyKind, TStructureKind, TTile } from "../../domain/world/types";
import type { TFactionStyle } from "./palette";

/**
 * Hand-drawn marks rather than sprites: a few strokes per tile keep the map
 * legible at any hex size and keep the prototype free of assets.
 */

/** A stable `0..1` wobble per tile, so no two tiles decorate identically. */
const wobble = (key: string, salt: number): number => {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
};

const drawTree = (context: CanvasRenderingContext2D, x: number, y: number, height: number) => {
  context.beginPath();
  context.moveTo(x, y - height);
  context.lineTo(x + height * 0.42, y);
  context.lineTo(x - height * 0.42, y);
  context.closePath();
  context.fill();
};

const drawPeak = (context: CanvasRenderingContext2D, x: number, y: number, height: number) => {
  context.beginPath();
  context.moveTo(x - height * 0.75, y);
  context.lineTo(x, y - height);
  context.lineTo(x + height * 0.75, y);
  context.closePath();
  context.fill();
};

/** Trees, ridges, grass or waves, depending on what the tile is made of. */
const drawTerrainDetail = (context: CanvasRenderingContext2D, tile: TTile, centre: TPoint, size: number) => {
  const style = TERRAIN_STYLE[tile.terrain];
  context.fillStyle = style.detail;
  context.strokeStyle = style.detail;

  const jitterX = (wobble(tile.key, 1) - 0.5) * size * 0.2;
  const jitterY = (wobble(tile.key, 2) - 0.5) * size * 0.16;
  const x = centre.x + jitterX;
  const y = centre.y + jitterY;

  if (tile.terrain === "forest") {
    drawTree(context, x - size * 0.3, y + size * 0.3, size * 0.42);
    drawTree(context, x + size * 0.26, y + size * 0.24, size * 0.36);
    drawTree(context, x - size * 0.02, y + size * 0.5, size * 0.34);

    return;
  }

  if (tile.terrain === "mountain") {
    drawPeak(context, x - size * 0.24, y + size * 0.34, size * 0.56);
    drawPeak(context, x + size * 0.26, y + size * 0.38, size * 0.42);
    context.fillStyle = "rgba(255, 255, 255, 0.75)";
    drawPeak(context, x - size * 0.24, y - size * 0.06, size * 0.16);

    return;
  }

  if (tile.terrain === "meadow") {
    context.lineWidth = Math.max(1, size * 0.045);
    context.lineCap = "round";
    for (let index = 0; index < 3; index += 1) {
      const tickX = x + (index - 1) * size * 0.34;
      const tickY = y + size * 0.26 + (wobble(tile.key, index + 3) - 0.5) * size * 0.2;
      context.beginPath();
      context.moveTo(tickX, tickY);
      context.lineTo(tickX, tickY - size * 0.2);
      context.stroke();
    }

    return;
  }

  context.lineWidth = Math.max(1, size * 0.05);
  context.lineCap = "round";
  for (let index = 0; index < 2; index += 1) {
    const waveY = y + (index - 0.5) * size * 0.4;
    context.beginPath();
    context.moveTo(x - size * 0.34, waveY);
    context.quadraticCurveTo(x - size * 0.1, waveY - size * 0.14, x + size * 0.12, waveY);
    context.quadraticCurveTo(x + size * 0.26, waveY + size * 0.12, x + size * 0.4, waveY);
    context.stroke();
  }
};

/** The mark inside an army disc: a runner, a wall of spears, a lance. */
const drawUnitGlyph = (
  context: CanvasRenderingContext2D,
  kind: TArmyKind,
  centre: TPoint,
  radius: number,
  colour: string
) => {
  context.fillStyle = colour;
  context.strokeStyle = colour;
  context.lineWidth = Math.max(1.2, radius * 0.16);
  context.lineCap = "round";

  if (kind === "scout") {
    context.beginPath();
    context.moveTo(centre.x, centre.y - radius * 0.55);
    context.lineTo(centre.x + radius * 0.45, centre.y + radius * 0.45);
    context.lineTo(centre.x, centre.y + radius * 0.15);
    context.lineTo(centre.x - radius * 0.45, centre.y + radius * 0.45);
    context.closePath();
    context.fill();

    return;
  }

  if (kind === "spearman") {
    for (let index = -1; index <= 1; index += 1) {
      const x = centre.x + index * radius * 0.38;
      context.beginPath();
      context.moveTo(x, centre.y + radius * 0.5);
      context.lineTo(x, centre.y - radius * 0.5);
      context.stroke();
    }

    return;
  }

  context.beginPath();
  context.moveTo(centre.x, centre.y - radius * 0.62);
  context.lineTo(centre.x + radius * 0.5, centre.y);
  context.lineTo(centre.x, centre.y + radius * 0.62);
  context.lineTo(centre.x - radius * 0.5, centre.y);
  context.closePath();
  context.fill();
};

/** Walls and a banner for the city, tents and a fire for the camp. */
const drawStructure = (
  context: CanvasRenderingContext2D,
  kind: TStructureKind,
  centre: TPoint,
  size: number,
  style: TFactionStyle
) => {
  const scale = size * 0.5;
  // Every shape is outlined: cream tents on a white mountain peak are invisible
  // without a dark edge, and a settlement is the one thing that must be found.
  const outline = () => {
    context.fill();
    context.stroke();
  };

  context.save();
  context.strokeStyle = "rgba(10, 22, 30, 0.85)";
  context.lineWidth = Math.max(1, size * 0.045);
  context.lineJoin = "round";
  context.shadowColor = "rgba(6, 16, 24, 0.45)";
  context.shadowBlur = size * 0.18;
  context.shadowOffsetY = size * 0.06;

  if (kind === "city") {
    context.fillStyle = "#f2ead4";
    context.beginPath();
    context.rect(centre.x - scale * 0.82, centre.y - scale * 0.1, scale * 1.64, scale * 0.86);
    outline();

    for (let index = 0; index < 4; index += 1) {
      context.beginPath();
      context.rect(centre.x - scale * 0.82 + index * scale * 0.46, centre.y - scale * 0.44, scale * 0.3, scale * 0.36);
      outline();
    }

    context.shadowColor = "transparent";
    context.fillStyle = style.fill;
    context.beginPath();
    context.rect(centre.x - scale * 0.08, centre.y - scale * 1.1, scale * 0.12, scale * 0.7);
    outline();
    context.beginPath();
    context.moveTo(centre.x + scale * 0.04, centre.y - scale * 1.1);
    context.lineTo(centre.x + scale * 0.72, centre.y - scale * 0.9);
    context.lineTo(centre.x + scale * 0.04, centre.y - scale * 0.7);
    context.closePath();
    outline();

    context.restore();

    return;
  }

  context.fillStyle = "#e8d9c2";
  for (const offset of [-0.46, 0.42]) {
    context.beginPath();
    context.moveTo(centre.x + scale * offset, centre.y - scale * 0.62);
    context.lineTo(centre.x + scale * (offset + 0.5), centre.y + scale * 0.5);
    context.lineTo(centre.x + scale * (offset - 0.5), centre.y + scale * 0.5);
    context.closePath();
    outline();
  }

  context.shadowColor = "transparent";
  context.fillStyle = style.banner;
  context.beginPath();
  context.arc(centre.x, centre.y + scale * 0.24, scale * 0.22, 0, Math.PI * 2);
  outline();

  context.restore();
};

export { drawStructure, drawTerrainDetail, drawUnitGlyph };
