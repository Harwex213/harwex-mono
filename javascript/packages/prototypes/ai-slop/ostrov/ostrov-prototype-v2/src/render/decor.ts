import type { Point } from "../hex/layout";
import { HEX_SIZE, SQUASH } from "../hex/layout";
import type { Tile } from "../map/island";
import type { Rng } from "../map/rng";
import { createRng } from "../map/rng";

const SQRT3_HALF = Math.sqrt(3) / 2;

/**
 * Uniform points inside the hex top face, expressed as world offsets from the
 * tile centre. `inset` keeps decoration clear of the rim.
 */
function scatter(rng: Rng, count: number, inset: number): Point[] {
  const points: Point[] = [];
  let guard = 0;
  while (points.length < count && guard < count * 40) {
    guard += 1;
    const x = rng() * 2 - 1;
    const y = (rng() * 2 - 1) * SQRT3_HALF;
    if (SQRT3_HALF * 2 * Math.abs(x) + Math.abs(y) > SQRT3_HALF * 2) {
      continue;
    }
    points.push({
      x: x * HEX_SIZE * inset,
      y: y * HEX_SIZE * SQUASH * inset,
    });
  }
  return points;
}

function fillEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrass(ctx: CanvasRenderingContext2D, centre: Point, rng: Rng): void {
  ctx.fillStyle = "rgba(112, 158, 52, 0.45)";
  for (const point of scatter(rng, 4, 0.6)) {
    fillEllipse(ctx, centre.x + point.x, centre.y + point.y, 12 + rng() * 16, (7 + rng() * 9) * SQUASH * 1.6);
  }
  for (const point of scatter(rng, 4, 0.68)) {
    const x = centre.x + point.x;
    const y = centre.y + point.y;
    const size = 5 + rng() * 4;
    ctx.fillStyle = "#4f7d2a";
    fillEllipse(ctx, x, y, size, size * 0.66);
    ctx.fillStyle = "#6ea23a";
    fillEllipse(ctx, x - size * 0.18, y - size * 0.26, size * 0.72, size * 0.44);
  }
  ctx.strokeStyle = "#5e8f2b";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  for (const point of scatter(rng, 9, 0.76)) {
    const x = centre.x + point.x;
    const y = centre.y + point.y;
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x - 4.5, y - 6);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.5, y - 8);
    ctx.moveTo(x + 3, y);
    ctx.lineTo(x + 5, y - 5.5);
    ctx.stroke();
  }
  ctx.fillStyle = "#f6f3c6";
  for (const point of scatter(rng, 5, 0.7)) {
    fillEllipse(ctx, centre.x + point.x, centre.y + point.y - 4, 1.8, 1.8);
  }
}

function drawSnow(ctx: CanvasRenderingContext2D, centre: Point, rng: Rng): void {
  ctx.fillStyle = "rgba(190, 213, 229, 0.5)";
  for (const point of scatter(rng, 3, 0.55)) {
    fillEllipse(ctx, centre.x + point.x, centre.y + point.y, 14 + rng() * 20, (8 + rng() * 10) * SQUASH * 1.6);
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  for (const point of scatter(rng, 6, 0.75)) {
    fillEllipse(ctx, centre.x + point.x, centre.y + point.y, 2 + rng() * 2, 1.4 + rng());
  }
  for (const point of scatter(rng, 2, 0.7)) {
    const x = centre.x + point.x;
    const y = centre.y + point.y;
    ctx.fillStyle = "#8d9aa4";
    fillEllipse(ctx, x, y, 5 + rng() * 3, 3 + rng() * 2);
    ctx.fillStyle = "#b9c6cf";
    fillEllipse(ctx, x - 1, y - 1.5, 3.5, 2);
  }
}

function drawIce(ctx: CanvasRenderingContext2D, centre: Point, rng: Rng): void {
  ctx.fillStyle = "rgba(226, 243, 249, 0.75)";
  for (const point of scatter(rng, 3, 0.5)) {
    fillEllipse(ctx, centre.x + point.x, centre.y + point.y, 18 + rng() * 18, (10 + rng() * 10) * SQUASH * 1.7);
  }
  // Cracks branch out of a few hubs in short segments; long straight lines read
  // as origami folds rather than ice.
  const hubs = scatter(rng, 3, 0.5);
  const branches: Point[][] = [];
  for (const hub of hubs) {
    const arms = 3 + Math.floor(rng() * 2);
    for (let arm = 0; arm < arms; arm += 1) {
      let angle = rng() * Math.PI * 2;
      let x = hub.x;
      let y = hub.y;
      const path: Point[] = [{ x, y }];
      const steps = 2 + Math.floor(rng() * 2);
      for (let step = 0; step < steps; step += 1) {
        angle += (rng() - 0.5) * 0.9;
        const length = 7 + rng() * 11;
        x += Math.cos(angle) * length;
        y += Math.sin(angle) * length * SQUASH;
        path.push({ x, y });
      }
      branches.push(path);
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let pass = 0; pass < 2; pass += 1) {
    ctx.strokeStyle = pass === 0 ? "rgba(126, 165, 187, 0.42)" : "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = pass === 0 ? 2.6 : 1.2;
    for (const path of branches) {
      ctx.beginPath();
      ctx.moveTo(centre.x + path[0]!.x, centre.y + path[0]!.y);
      for (let index = 1; index < path.length; index += 1) {
        ctx.lineTo(centre.x + path[index]!.x, centre.y + path[index]!.y);
      }
      ctx.stroke();
    }
  }
}

function drawSand(ctx: CanvasRenderingContext2D, centre: Point, rng: Rng): void {
  ctx.fillStyle = "rgba(202, 187, 152, 0.45)";
  for (const point of scatter(rng, 3, 0.55)) {
    fillEllipse(ctx, centre.x + point.x, centre.y + point.y, 16 + rng() * 18, (9 + rng() * 9) * SQUASH * 1.7);
  }
  for (const point of scatter(rng, 5, 0.72)) {
    const x = centre.x + point.x;
    const y = centre.y + point.y;
    const size = 4 + rng() * 4;
    ctx.fillStyle = "#9d8f74";
    fillEllipse(ctx, x, y, size, size * 0.62);
    ctx.fillStyle = "#cabb98";
    fillEllipse(ctx, x - size * 0.2, y - size * 0.28, size * 0.72, size * 0.42);
  }
  for (const point of scatter(rng, 4, 0.7)) {
    const x = centre.x + point.x;
    const y = centre.y + point.y;
    ctx.fillStyle = "#b07a45";
    fillEllipse(ctx, x, y - 1.5, 4 + rng() * 2, 2.8 + rng() * 1.4);
    ctx.fillStyle = "#cf9a5e";
    fillEllipse(ctx, x - 1, y - 3, 2.4, 1.7);
  }
}

const CONIFER_GREENS: readonly string[] = ["#2c5c42", "#356b4a", "#25513c", "#3f7a53"];
const CONIFER_WARM: readonly string[] = ["#a5623a", "#c08243", "#8f5a3c", "#b8955c"];

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, rng: Rng): void {
  const warm = rng() < 0.26;
  const palette = warm ? CONIFER_WARM : CONIFER_GREENS;
  const body = palette[Math.floor(rng() * palette.length)] ?? "#2c5c42";
  const height = 34 * scale;
  const width = 13 * scale;

  ctx.fillStyle = "rgba(90, 110, 125, 0.28)";
  fillEllipse(ctx, x, y + 1, width * 0.85, width * 0.36);

  ctx.fillStyle = "#6a4a33";
  ctx.fillRect(x - 1.4 * scale, y - height * 0.24, 2.8 * scale, height * 0.26);

  for (let tier = 0; tier < 3; tier += 1) {
    const spread = width * (1 - tier * 0.22);
    const base = y - height * (0.18 + tier * 0.24);
    const tip = base - height * 0.4;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x, tip);
    ctx.lineTo(x + spread, base);
    ctx.lineTo(x - spread, base);
    ctx.closePath();
    ctx.fill();
    // A dusting of snow on the lit side, not a repaint of half the tree.
    ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
    ctx.beginPath();
    ctx.moveTo(x - spread * 0.06, tip + height * 0.06);
    ctx.lineTo(x - spread * 0.34, base);
    ctx.lineTo(x - spread * 0.06, base);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "#ffffff";
  fillEllipse(ctx, x, y - height * 0.99, 1.7 * scale, 1.4 * scale);
}

function drawForest(ctx: CanvasRenderingContext2D, centre: Point, rng: Rng): void {
  drawSnow(ctx, centre, rng);
  const spots = scatter(rng, 13 + Math.floor(rng() * 5), 0.8);
  spots.sort((left, right) => left.y - right.y);
  for (const spot of spots) {
    drawTree(ctx, centre.x + spot.x, centre.y + spot.y, 0.85 + rng() * 0.55, rng);
  }
}

/** Draws the stylised, deterministic contents of one tile's top face. */
function drawDecoration(ctx: CanvasRenderingContext2D, tile: Tile, centre: Point): void {
  const rng = createRng(tile.seed);
  ctx.save();
  switch (tile.terrain) {
    case "grass":
      drawGrass(ctx, centre, rng);
      break;
    case "snow":
      drawSnow(ctx, centre, rng);
      break;
    case "ice":
      drawIce(ctx, centre, rng);
      break;
    case "sand":
      drawSand(ctx, centre, rng);
      break;
    case "forest":
      drawForest(ctx, centre, rng);
      break;
  }
  ctx.restore();
}

/** Terrain whose decoration is allowed to poke out above the tile rim. */
function decorationOverflows(tile: Tile): boolean {
  return tile.terrain === "forest";
}

export { decorationOverflows, drawDecoration, scatter };
