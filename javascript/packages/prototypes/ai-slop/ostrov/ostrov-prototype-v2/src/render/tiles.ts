import { config } from "@hw/ostrov-prototype-v2-config";
import { HEX_DIRECTIONS } from "../hex/coords";
import type { Point } from "../hex/layout";
import { WALL_DEPTH, WALL_EDGES } from "../hex/layout";
import type { Tile } from "../map/island";
import { createRng, hashCoords } from "../map/rng";
import { decorationOverflows, drawDecoration } from "./decor";
import type { FogPaint } from "./fogTint";
import { mix, shade } from "./palette";

/** Light comes from the upper left, so the down-left faces are the bright ones. */
const EDGE_LIGHT: Record<number, number> = {
  0: 0.88,
  1: 0.97,
  2: 1.1,
};

const BOTTOM_STEPS = 4;

type NeighbourLookup = (q: number, r: number) => boolean;

function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index]!.x, points[index]!.y);
  }
  ctx.closePath();
}

/**
 * Cliff faces. Only the three downward edges can be seen, and only where the
 * island has no neighbour to hide them.
 *
 * `paint` carries the colours already mixed for this tile's fog level, so a
 * remembered cliff costs the same as a lit one.
 */
function drawWalls(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  corners: readonly Point[],
  hasNeighbour: NeighbourLookup,
  paint: FogPaint,
): void {
  const style = paint.style;
  for (const edge of WALL_EDGES) {
    const offset = HEX_DIRECTIONS[edge]!;
    if (hasNeighbour(tile.q + offset.q, tile.r + offset.r)) {
      continue;
    }
    const from = corners[edge]!;
    const to = corners[(edge + 1) % 6]!;
    const rng = createRng(hashCoords(tile.q, tile.r, edge + 17));

    const polygon: Point[] = [from, to];
    const depths: number[] = [];
    for (let step = 0; step <= BOTTOM_STEPS; step += 1) {
      depths.push(WALL_DEPTH * (0.88 + rng() * 0.22));
    }
    for (let step = BOTTOM_STEPS; step >= 0; step -= 1) {
      const t = step / BOTTOM_STEPS;
      polygon.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t + depths[step]!,
      });
    }

    const light = EDGE_LIGHT[edge] ?? 1;
    const topY = Math.min(from.y, to.y);
    const gradient = ctx.createLinearGradient(0, topY, 0, topY + WALL_DEPTH * 1.15);
    gradient.addColorStop(0, shade(mix(style.wall, paint.rockTop, 0.7), light));
    gradient.addColorStop(0.3, shade(mix(style.wall, paint.rockBottom, 0.55), light));
    gradient.addColorStop(1, shade(paint.rockBottom, light * 0.96));

    tracePath(ctx, polygon);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Soil lip right under the top face.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = shade(style.rim, light);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(to.x, to.y + 6);
    ctx.lineTo(from.x, from.y + 6);
    ctx.closePath();
    ctx.fill();

    // Rock banding: a couple of strata across the face plus vertical fissures.
    ctx.strokeStyle = "rgba(12, 28, 40, 0.16)";
    ctx.lineWidth = 3;
    for (let band = 0; band < 2; band += 1) {
      const drop = WALL_DEPTH * (0.3 + band * 0.3 + rng() * 0.1);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y + drop);
      ctx.lineTo((from.x + to.x) / 2, (from.y + to.y) / 2 + drop + (rng() - 0.5) * 6);
      ctx.lineTo(to.x, to.y + drop * (0.9 + rng() * 0.2));
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(10, 26, 38, 0.28)";
    ctx.lineWidth = 1.8;
    for (let stripe = 1; stripe < 4; stripe += 1) {
      const t = stripe / 4 + (rng() - 0.5) * 0.12;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      ctx.beginPath();
      ctx.moveTo(x, y + 7);
      ctx.lineTo(x + (rng() - 0.5) * 5, y + WALL_DEPTH * (0.55 + rng() * 0.4));
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Top face: flat terrain colour, a hint of form, then the stylised decoration.
 *
 * The decoration is the live detail of the tile, so it is the first thing the
 * fog takes away: it fades out with `paint.decorAlpha` and is skipped outright
 * once that reaches zero, which is what leaves a remembered island as terrain
 * without a single tree, cairn or drift on it.
 */
function drawTop(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  centre: Point,
  corners: readonly Point[],
  paint: FogPaint,
): void {
  const style = paint.style;
  tracePath(ctx, corners);
  ctx.fillStyle = style.top;
  ctx.fill();

  const topY = corners[4]!.y;
  const bottomY = corners[1]!.y;
  const form = ctx.createLinearGradient(centre.x, topY, centre.x, bottomY);
  form.addColorStop(0, "rgba(255, 255, 255, 0.16)");
  form.addColorStop(0.55, "rgba(255, 255, 255, 0)");
  form.addColorStop(1, "rgba(24, 48, 68, 0.14)");
  ctx.fillStyle = form;
  ctx.fill();

  if (paint.decorAlpha > 0) {
    ctx.save();
    if (paint.decorAlpha < 1) {
      ctx.globalAlpha = paint.decorAlpha;
    }
    if (!decorationOverflows(tile)) {
      tracePath(ctx, corners);
      ctx.clip();
    }
    drawDecoration(ctx, tile, centre);
    ctx.restore();
  }

  tracePath(ctx, corners);
  ctx.strokeStyle = shade(style.rim, 0.96);
  ctx.lineWidth = config.render.tileRimWidth;
  ctx.stroke();
}

export type { NeighbourLookup };
export { drawTop, drawWalls, tracePath };
