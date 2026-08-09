import type { BuildingId } from "../buildings/catalog";
import { CASTLE_ID } from "../buildings/catalog";
import type { Point } from "../hex/layout";
import { HEX_SIZE, SQUASH, hexCorners } from "../hex/layout";
import {
  BUILDING_ART_SCALE,
  COMPLETION_BEAT_SEC,
  FLAG_WAVE_PERIOD,
  GHOST_ALPHA,
  GHOST_DASH_PERIOD,
  HOIST_PERIOD,
  PLACEMENT_BEAT_SEC,
  SMOKE_PUFFS,
  SMOKE_RISE_PERIOD,
  WINDOW_GLOW_PERIOD,
} from "../tuning";
import type { PlacedBuilding } from "../state/buildings";
import { withAlpha } from "./palette";

/**
 * Procedural buildings, drawn on the same 2D canvas as the tiles.
 *
 * Everything below is written in "art units" with the tile's own centre at the
 * origin and negative y pointing up, then scaled by `UNIT` on the way out. One
 * art unit equals one world unit at the default hex size, so a building keeps
 * its proportions when the designer changes `hex.size` in the config.
 *
 * Horizontal planes — the plinth, the flat top of a block, the dust ring — are
 * squashed by `SQUASH`, the same way a hex top face is, so a building sits in
 * the island's projection instead of on top of it. Vertical faces are not
 * squashed: the camera looks at the island from a low angle, so walls keep
 * their full height.
 *
 * Every animated value is a function of absolute time, never of a per-frame
 * increment, so the motion is the same at 60 Hz and at 120 Hz.
 */

const TAU = Math.PI * 2;

const UNIT = (HEX_SIZE / 64) * BUILDING_ART_SCALE;

const STONE_TOP = "#eef4f9";
const STONE_LIT = "#dce5ed";
const STONE_MID = "#bfcbd8";
const STONE_DARK = "#8b9bab";
const STONE_LINE = "rgba(46, 68, 90, 0.26)";
const ROOF_TOP = "#e0787c";
const ROOF_LIT = "#cd5a62";
const ROOF_DARK = "#8c3540";
const WOOD = "#8a6242";
const WOOD_DARK = "rgba(92, 63, 39, 0.75)";

/** Life of a finished building. `alive` is 0 while the site is still going up. */
type Life = {
  /** Wall-clock seconds. Only differences matter, so any monotonic clock does. */
  time: number;
  alive: number;
};

type BuildingArt = {
  /** Height from the tile face to the top of the structure, in art units. */
  height: number;
  draw: (ctx: CanvasRenderingContext2D, life: Life) => void;
  /**
   * Closed outline of the structure, wound once and never crossing itself, so a
   * fill with the even-odd rule punches exactly one hole. The territory border
   * is clipped against it, which keeps the blue line from cutting the walls.
   */
  silhouette: readonly Point[];
  /** Half-width of the construction site, for the scaffolding and the reveal clip. */
  siteHalfWidth: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function fillEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU);
  ctx.fill();
}

/**
 * One stone block: a lit-to-shaded front face plus the sliver of its flat top
 * that the low camera angle shows. Returns the y of that top, which is where a
 * roof or a row of merlons goes.
 */
function drawBlock(ctx: CanvasRenderingContext2D, cx: number, width: number, height: number, depth: number): number {
  const top = -height;
  const cap = depth * SQUASH;
  const left = cx - width / 2;

  const face = ctx.createLinearGradient(left, 0, left + width, 0);
  face.addColorStop(0, STONE_LIT);
  face.addColorStop(0.5, STONE_MID);
  face.addColorStop(1, STONE_DARK);
  ctx.fillStyle = face;
  ctx.fillRect(left, top, width, height);

  ctx.fillStyle = STONE_TOP;
  ctx.fillRect(left, top - cap, width, cap);

  ctx.strokeStyle = STONE_LINE;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let course = 1; course * 14 < height; course += 1) {
    const y = top + course * 14;
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
  }
  ctx.stroke();
  ctx.strokeRect(left, top - cap, width, height + cap);

  return top - cap;
}

/** Battlements along the top of a block. */
function drawMerlons(ctx: CanvasRenderingContext2D, cx: number, capTop: number, width: number, count: number): void {
  const step = width / (count * 2 - 1);
  ctx.strokeStyle = STONE_LINE;
  ctx.lineWidth = 1;
  for (let index = 0; index < count; index += 1) {
    const x = cx - width / 2 + index * step * 2;
    ctx.fillStyle = STONE_MID;
    ctx.fillRect(x, capTop - 9, step, 9);
    ctx.strokeRect(x, capTop - 9, step, 9);
    ctx.fillStyle = STONE_TOP;
    ctx.fillRect(x, capTop - 10.6, step, 2);
  }
}

/** Conical tower roof. Returns the y of its apex. */
function drawRoof(ctx: CanvasRenderingContext2D, cx: number, capTop: number, width: number, height: number): number {
  const apex = capTop - height;
  const half = width / 2 + 4;
  ctx.beginPath();
  ctx.moveTo(cx, apex);
  ctx.lineTo(cx + half, capTop);
  ctx.lineTo(cx - half, capTop);
  ctx.closePath();
  const shading = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  shading.addColorStop(0, ROOF_TOP);
  shading.addColorStop(0.5, ROOF_LIT);
  shading.addColorStop(1, ROOF_DARK);
  ctx.fillStyle = shading;
  ctx.fill();
  ctx.strokeStyle = "rgba(62, 24, 30, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  return apex;
}

/** Narrow arched window. `glow` runs 0..1 and drives how warmly it is lit. */
function drawWindow(ctx: CanvasRenderingContext2D, x: number, baseY: number, glow: number): void {
  const width = 6.4;
  const height = 12;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, baseY);
  ctx.lineTo(x - width / 2, baseY - height + width / 2);
  ctx.arc(x, baseY - height + width / 2, width / 2, Math.PI, 0);
  ctx.lineTo(x + width / 2, baseY);
  ctx.closePath();
  ctx.fillStyle = `rgba(255, 209, 116, ${0.28 + 0.62 * glow})`;
  ctx.fill();
  ctx.strokeStyle = "rgba(58, 46, 32, 0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Rock the structure stands on, so it never looks pasted onto the tile. */
function drawPlinth(ctx: CanvasRenderingContext2D, rx: number, ry: number): void {
  ctx.fillStyle = "rgba(28, 50, 70, 0.26)";
  fillEllipse(ctx, 3, 6, rx * 0.94, ry * 0.88);
  ctx.fillStyle = "#93a2af";
  fillEllipse(ctx, 0, 2, rx, ry);
  ctx.fillStyle = "#c2cdda";
  fillEllipse(ctx, 0, -1.5, rx * 0.93, ry * 0.84);
}

function drawGate(ctx: CanvasRenderingContext2D, alive: number): void {
  const width = 26;
  const height = 34;
  ctx.beginPath();
  ctx.moveTo(-width / 2, 0);
  ctx.lineTo(-width / 2, -height + width / 2);
  ctx.arc(0, -height + width / 2, width / 2, Math.PI, 0);
  ctx.lineTo(width / 2, 0);
  ctx.closePath();
  ctx.fillStyle = "#4a3524";
  ctx.fill();
  ctx.strokeStyle = "#7a5c3c";
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(20, 12, 6, 0.45)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let plank = -1; plank <= 1; plank += 1) {
    ctx.moveTo(plank * 7, 0);
    ctx.lineTo(plank * 7, -height);
  }
  ctx.stroke();
  ctx.restore();
  if (alive > 0) {
    ctx.fillStyle = `rgba(255, 205, 120, ${0.3 * alive})`;
    fillEllipse(ctx, 0, -3, width * 0.4, 5);
  }
}

function drawChimney(ctx: CanvasRenderingContext2D, x: number, baseY: number): number {
  const top = baseY - 15;
  ctx.fillStyle = STONE_MID;
  ctx.fillRect(x - 4, top, 8, 15);
  ctx.fillStyle = "#6f7d8b";
  ctx.fillRect(x - 5, top - 3, 10, 3.4);
  ctx.strokeStyle = STONE_LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 4, top, 8, 15);
  return top - 3;
}

function drawSmoke(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  for (let puff = 0; puff < SMOKE_PUFFS; puff += 1) {
    const phase = (time / SMOKE_RISE_PERIOD + puff / SMOKE_PUFFS) % 1;
    const rise = phase * 82;
    // A steady lean on top of the wobble, so the column leaves the roofline for
    // open sky instead of hanging over pale stone where it cannot be seen.
    const drift = Math.sin(phase * 4.2 + puff) * 4 + phase * 26;
    const radius = 6 + phase * 20;
    // The `min` fades a puff in over its first fifth, so none of them pops out
    // of the chimney at full size.
    const alpha = 0.5 * (1 - phase * 0.85) * Math.min(1, phase * 5);
    ctx.fillStyle = `rgba(176, 190, 205, ${alpha})`;
    fillEllipse(ctx, x + drift, y - rise, radius, radius * 0.86);
  }
}

function drawFlag(ctx: CanvasRenderingContext2D, apexY: number, time: number): void {
  const topY = apexY - 21;
  ctx.strokeStyle = "#4d5a66";
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, apexY + 3);
  ctx.lineTo(0, topY);
  ctx.stroke();
  ctx.fillStyle = "#ffd479";
  fillEllipse(ctx, 0, topY - 3, 3.2, 3.2);

  const phase = (TAU * time) / FLAG_WAVE_PERIOD;
  const near = 4.6 * Math.sin(phase);
  const far = 3.4 * Math.sin(phase + 1.2);
  const top = topY + 3;
  const bottom = topY + 18;
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.bezierCurveTo(10, top + near, 20, top - near, 28, top + far);
  ctx.lineTo(28, bottom + far);
  ctx.bezierCurveTo(20, bottom - near, 10, bottom + near, 0, bottom);
  ctx.closePath();
  ctx.fillStyle = "#d3504d";
  ctx.fill();
  ctx.strokeStyle = "rgba(88, 24, 24, 0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(255, 212, 121, 0.9)";
  ctx.fillRect(0, top + 5.5 + far * 0.4, 28, 3);
  ctx.restore();
}

const CASTLE_KEEP_HEIGHT = 96;
const CASTLE_KEEP_DEPTH = 30;
const CASTLE_HALL_HEIGHT = 46;
const CASTLE_HALL_DEPTH = 26;

function drawCastle(ctx: CanvasRenderingContext2D, life: Life): void {
  const glow = life.alive * (0.55 + 0.45 * Math.sin((TAU * life.time) / WINDOW_GLOW_PERIOD));

  drawPlinth(ctx, 62, 15);

  // Back to front: the keep stands behind the two towers, the great hall in front of all three.
  const keepCap = drawBlock(ctx, 0, 48, CASTLE_KEEP_HEIGHT, CASTLE_KEEP_DEPTH);
  const keepApex = drawRoof(ctx, 0, keepCap, 48, 34);

  const leftCap = drawBlock(ctx, -44, 26, 76, 20);
  drawRoof(ctx, -44, leftCap, 26, 26);
  const rightCap = drawBlock(ctx, 44, 26, 64, 20);
  drawRoof(ctx, 44, rightCap, 26, 24);

  const hallCap = drawBlock(ctx, 0, 86, CASTLE_HALL_HEIGHT, CASTLE_HALL_DEPTH);
  drawMerlons(ctx, 0, hallCap, 86, 7);

  drawGate(ctx, life.alive);
  drawWindow(ctx, -13, -58, glow);
  drawWindow(ctx, 13, -58, glow);
  drawWindow(ctx, 0, -88, glow);
  drawWindow(ctx, -44, -34, glow);
  drawWindow(ctx, -44, -62, glow);
  drawWindow(ctx, 44, -30, glow);
  drawWindow(ctx, -30, -20, glow * 0.7);
  drawWindow(ctx, 30, -20, glow * 0.7);

  // The chimney sits in the gap between the keep and the right tower, which is
  // the one column of open sky above the roofline.
  const chimneyTop = drawChimney(ctx, 29, hallCap);
  if (life.alive > 0) {
    drawSmoke(ctx, 29, chimneyTop, life.time);
    drawFlag(ctx, keepApex, life.time);
  }
}

/**
 * Outline of the castle, traced once round. The numbers follow the blocks drawn
 * above: tower caps at -88 and -76, the hall cap at -62, the keep roof apex at -148.
 */
const CASTLE_SILHOUETTE: readonly Point[] = [
  { x: -62, y: 14 },
  { x: -62, y: -6 },
  { x: -57, y: -6 },
  { x: -57, y: -88 },
  { x: -61, y: -88 },
  { x: -44, y: -114 },
  { x: -27, y: -88 },
  { x: -31, y: -88 },
  { x: -31, y: -62 },
  { x: -28, y: -62 },
  { x: -28, y: -114 },
  { x: 0, y: -148 },
  { x: 28, y: -114 },
  { x: 28, y: -76 },
  { x: 27, y: -76 },
  { x: 44, y: -100 },
  { x: 61, y: -76 },
  { x: 57, y: -76 },
  { x: 57, y: -6 },
  { x: 62, y: -6 },
  { x: 62, y: 14 },
];

const CASTLE_ART: BuildingArt = {
  height: 148,
  draw: drawCastle,
  silhouette: CASTLE_SILHOUETTE,
  siteHalfWidth: 62,
};

/**
 * Placeholder for every building that is not the castle: a stone cottage under
 * a wooden gable. It shares the whole flow — ghost, beat, scaffolding, idle
 * smoke — so the panel is never a dead end.
 */
function drawCottage(ctx: CanvasRenderingContext2D, life: Life): void {
  const glow = life.alive * (0.55 + 0.45 * Math.sin((TAU * life.time) / WINDOW_GLOW_PERIOD));
  drawPlinth(ctx, 30, 8);
  const cap = drawBlock(ctx, 0, 44, 30, 18);

  const apex = cap - 22;
  ctx.beginPath();
  ctx.moveTo(0, apex);
  ctx.lineTo(27, cap);
  ctx.lineTo(-27, cap);
  ctx.closePath();
  const shading = ctx.createLinearGradient(-27, 0, 27, 0);
  shading.addColorStop(0, "#a4794f");
  shading.addColorStop(0.5, WOOD);
  shading.addColorStop(1, "#5f4128");
  ctx.fillStyle = shading;
  ctx.fill();
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = "#4a3524";
  ctx.fillRect(-6, -18, 12, 18);
  ctx.strokeStyle = "#7a5c3c";
  ctx.lineWidth = 1.8;
  ctx.strokeRect(-6, -18, 12, 18);
  drawWindow(ctx, -14, -12, glow);
  drawWindow(ctx, 14, -12, glow);

  const chimneyTop = drawChimney(ctx, 14, cap - 4);
  if (life.alive > 0) {
    drawSmoke(ctx, 14, chimneyTop, life.time);
  }
}

const COTTAGE_SILHOUETTE: readonly Point[] = [
  { x: -30, y: 8 },
  { x: -30, y: -4 },
  { x: -27, y: -4 },
  { x: -27, y: -41 },
  { x: 0, y: -63 },
  { x: 27, y: -41 },
  { x: 30, y: -4 },
  { x: 30, y: 8 },
];

const COTTAGE_ART: BuildingArt = {
  height: 63,
  draw: drawCottage,
  silhouette: COTTAGE_SILHOUETTE,
  siteHalfWidth: 32,
};

function artOf(id: BuildingId): BuildingArt {
  return id === CASTLE_ID ? CASTLE_ART : COTTAGE_ART;
}

/** How far the scaffolding has been raised at this point of the build. */
function scaffoldHeight(art: BuildingArt, progress: number): number {
  return 26 + (art.height - 20) * progress;
}

/** Scaffolding around a site. `height` is how far up it has already been raised. */
function drawScaffold(ctx: CanvasRenderingContext2D, art: BuildingArt, height: number, time: number): void {
  const outer = art.siteHalfWidth - 6;
  const inner = outer * 0.42;
  const decks = 3;

  ctx.lineCap = "round";
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const x of [-outer, -inner, inner, outer]) {
    ctx.moveTo(x, 8);
    ctx.lineTo(x, -height);
  }
  for (let deck = 1; deck <= decks; deck += 1) {
    const y = -height * (deck / decks) + 4;
    ctx.moveTo(-outer - 5, y);
    ctx.lineTo(outer + 5, y);
  }
  ctx.stroke();

  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let deck = 0; deck < decks; deck += 1) {
    const top = -height * ((deck + 1) / decks) + 4;
    const bottom = -height * (deck / decks) + 4;
    ctx.moveTo(-outer, bottom);
    ctx.lineTo(-inner, top);
    ctx.moveTo(inner, bottom);
    ctx.lineTo(outer, top);
  }
  ctx.stroke();

  // A crate riding the hoist rope, so the site reads as worked on rather than parked.
  const swing = 0.5 - 0.5 * Math.cos((TAU * time) / HOIST_PERIOD);
  const crateY = -height + 14 + swing * height * 0.5;
  ctx.strokeStyle = "#4c4038";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(outer, -height + 2);
  ctx.lineTo(outer, crateY);
  ctx.stroke();
  ctx.fillStyle = "#a9793f";
  ctx.fillRect(outer - 8, crateY, 16, 12);
  ctx.strokeStyle = "rgba(60, 38, 18, 0.6)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(outer - 8, crateY, 16, 12);
}

function drawProgressBar(ctx: CanvasRenderingContext2D, progress: number, y: number): void {
  const width = 96;
  const height = 13;
  const left = -width / 2;

  ctx.beginPath();
  ctx.roundRect(left, y, width, height, 6.5);
  ctx.fillStyle = "rgba(9, 24, 38, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(150, 205, 240, 0.4)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const filled = (width - 5) * progress;
  if (filled > 1) {
    ctx.beginPath();
    ctx.roundRect(left + 2.5, y + 2.5, filled, height - 5, 4);
    const bar = ctx.createLinearGradient(left, 0, left + width, 0);
    bar.addColorStop(0, "#7fc0ff");
    bar.addColorStop(1, "#ffd479");
    ctx.fillStyle = bar;
    ctx.fill();
  }

  ctx.fillStyle = "#eaf3fb";
  ctx.font = "600 9px ui-monospace, SF Mono, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round(progress * 100)}%`, 0, y + height / 2 + 0.5);
}

function drawCompletionFlash(ctx: CanvasRenderingContext2D, height: number, beat: number): void {
  const fade = (1 - beat) * (1 - beat);
  const cy = -height * 0.38;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Kept small and short: the flash is meant to punch, not to bleach the walls
  // the player has just watched go up.
  const radius = height * (0.26 + 0.42 * beat);
  const glow = ctx.createRadialGradient(0, cy, 0, 0, cy, radius);
  glow.addColorStop(0, `rgba(255, 240, 196, ${0.42 * fade})`);
  glow.addColorStop(1, "rgba(255, 240, 196, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, cy, radius, 0, TAU);
  ctx.fill();
  ctx.restore();

  const spark = 1 - beat;
  for (let index = 0; index < 16; index += 1) {
    const angle = (TAU * index) / 16 + 0.2;
    const reach = height * (0.22 + 0.55 * beat);
    const x = Math.cos(angle) * reach;
    const y = cy + Math.sin(angle) * reach * 0.72;
    const size = 4.6 * spark;
    ctx.fillStyle = `rgba(247, 160, 62, ${0.95 * spark})`;
    fillEllipse(ctx, x, y, size, size);
    ctx.fillStyle = `rgba(255, 250, 232, ${0.95 * spark})`;
    fillEllipse(ctx, x, y, size * 0.45, size * 0.45);
  }
}

/** Traces a hex outline around `centre`, optionally grown outwards. */
function traceHex(ctx: CanvasRenderingContext2D, centre: Point, grow: number): void {
  const corners = hexCorners(centre);
  ctx.beginPath();
  for (let index = 0; index < corners.length; index += 1) {
    const corner = corners[index]!;
    const x = centre.x + (corner.x - centre.x) * grow;
    const y = centre.y + (corner.y - centre.y) * grow;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

/** Ring, flash and dust on the tile itself. `beat` runs 0..1. */
function drawGroundBeat(ctx: CanvasRenderingContext2D, centre: Point, beat: number, colour: string): void {
  const fade = 1 - beat;
  const spread = 1 - fade * fade;

  ctx.save();
  traceHex(ctx, centre, 1);
  ctx.fillStyle = withAlpha(colour, 0.45 * fade * fade);
  ctx.fill();

  traceHex(ctx, centre, 1 + 0.55 * spread);
  ctx.strokeStyle = withAlpha(colour, 0.9 * fade);
  ctx.lineWidth = 2 + 7 * fade;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.fillStyle = `rgba(232, 226, 212, ${0.5 * fade})`;
  for (let mote = 0; mote < 9; mote += 1) {
    const angle = (TAU * mote) / 9 + 0.3;
    const reach = HEX_SIZE * (0.3 + 0.75 * spread);
    const size = 4 + 8 * fade;
    fillEllipse(ctx, centre.x + Math.cos(angle) * reach, centre.y + Math.sin(angle) * reach * SQUASH, size, size * 0.7);
  }
  ctx.restore();
}

/**
 * One placed building, with whatever stage of its life it is in: the site beat,
 * the scaffolded rise, the completion burst, or the settled idle.
 */
function drawBuilding(ctx: CanvasRenderingContext2D, building: PlacedBuilding, centre: Point, now: number): void {
  const art = artOf(building.id);
  const time = now / 1000;
  // Every stage is clamped: the placement stamp comes from `performance.now()`
  // and the frame stamp from the animation clock, and the two can disagree by a
  // fraction of a millisecond on the very first frame of a site.
  const sincePlaced = Math.max(0, (now - building.startedAt) / 1000);
  const progress = building.state === "built" ? 1 : clamp01((now - building.startedAt) / building.durationMs);
  const beat = building.completedAt === null ? 1 : clamp01((now - building.completedAt) / 1000 / COMPLETION_BEAT_SEC);

  if (sincePlaced < PLACEMENT_BEAT_SEC) {
    drawGroundBeat(ctx, centre, sincePlaced / PLACEMENT_BEAT_SEC, "#ffd479");
  }
  if (beat < 1) {
    drawGroundBeat(ctx, centre, beat, "#bfe9ff");
  }

  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.scale(UNIT, UNIT);

  // The finished structure lands with a short overshoot, then settles.
  if (beat < 1) {
    const pop = 1 + 0.15 * Math.sin(Math.PI * Math.min(1, beat * 1.7)) * (1 - beat);
    ctx.scale(pop, pop);
  }

  if (progress >= 1) {
    art.draw(ctx, { time, alive: 1 });
  } else {
    // The structure is revealed from the ground up: the clip is the course the
    // masons have reached, and a plank sits on that line.
    const revealed = art.height * progress;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-art.siteHalfWidth - 12, -revealed, art.siteHalfWidth * 2 + 24, revealed + 26);
    ctx.clip();
    art.draw(ctx, { time, alive: 0 });
    ctx.restore();
    ctx.fillStyle = "#a4794f";
    ctx.fillRect(-art.siteHalfWidth - 2, -revealed - 3.5, art.siteHalfWidth * 2 + 4, 3.5);
  }

  if (beat < 1) {
    drawCompletionFlash(ctx, art.height, beat);
  }

  if (progress < 1) {
    drawScaffold(ctx, art, scaffoldHeight(art, progress), time);
  } else if (beat < 1) {
    // The scaffolding drops away over the first half of the beat, so the finished
    // walls are clear well before the beat ends.
    const falling = Math.min(1, beat * 1.9);
    ctx.save();
    ctx.globalAlpha = 1 - falling;
    ctx.translate(0, falling * falling * 70);
    ctx.rotate(falling * 0.12);
    drawScaffold(ctx, art, scaffoldHeight(art, 1), time);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * The progress bar of a site still going up.
 *
 * It is drawn in its own pass, after the territory line, because it reads as a
 * label rather than as part of the scene: the blue border has to run behind it,
 * not across it.
 */
function drawBuildingHud(ctx: CanvasRenderingContext2D, building: PlacedBuilding, centre: Point, now: number): void {
  if (building.state !== "constructing") {
    return;
  }
  const art = artOf(building.id);
  const progress = clamp01((now - building.startedAt) / building.durationMs);
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.scale(UNIT, UNIT);
  // The bar rides the top of the scaffolding rather than sitting at the height
  // the finished building will reach, so it never floats off on its own.
  drawProgressBar(ctx, progress, -scaffoldHeight(art, progress) - 32);
  ctx.restore();
}

/** Reason pill under a hex that refuses the building. */
function drawRefusalLabel(ctx: CanvasRenderingContext2D, centre: Point, reason: string): void {
  ctx.save();
  ctx.font = "600 15px system-ui, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(reason).width + 24;
  const y = centre.y + HEX_SIZE * SQUASH + 18;
  ctx.beginPath();
  ctx.roundRect(centre.x - width / 2, y - 13, width, 26, 13);
  ctx.fillStyle = "rgba(48, 12, 14, 0.84)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 122, 110, 0.65)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = "#ffd8d3";
  ctx.fillText(reason, centre.x, y + 1);
  ctx.restore();
}

function ghostTint(valid: boolean): string {
  return valid ? "#79e39a" : "#ff7a6e";
}

/**
 * The hex marker of the preview: the green or red wash and the marching dashes.
 *
 * Drawn with the cursor rather than with the tiles, because it answers "which
 * hex is this and will it take the building" and has to stay legible even when
 * the decoration of a tile in front reaches over the hex.
 */
function drawGhostTile(ctx: CanvasRenderingContext2D, centre: Point, valid: boolean, time: number): void {
  const tint = ghostTint(valid);
  ctx.save();
  traceHex(ctx, centre, 1);
  ctx.fillStyle = withAlpha(tint, 0.2);
  ctx.fill();
  ctx.setLineDash([12, 8]);
  ctx.lineDashOffset = -((time / GHOST_DASH_PERIOD) % 1) * 20;
  ctx.strokeStyle = withAlpha(tint, 0.95);
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

/**
 * The previewed structure itself. Drawn with the tile it sits on, so a building
 * in front of that tile covers it the same way it will once this one is real.
 */
function drawGhost(ctx: CanvasRenderingContext2D, id: BuildingId, centre: Point, valid: boolean, time: number): void {
  const art = artOf(id);
  const tint = ghostTint(valid);

  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.scale(UNIT, UNIT);
  ctx.globalAlpha = GHOST_ALPHA;
  art.draw(ctx, { time, alive: 0 });
  ctx.globalAlpha = 1;

  ctx.beginPath();
  traceSilhouette(ctx, art, { x: 0, y: 0 }, 1);
  ctx.fillStyle = withAlpha(tint, valid ? 0.2 : 0.42);
  ctx.fill();

  if (!valid) {
    const cy = -art.height * 0.55;
    const radius = art.height * 0.13;
    ctx.strokeStyle = "rgba(255, 96, 84, 0.95)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, cy, radius, 0, TAU);
    ctx.moveTo(-radius * 0.7, cy - radius * 0.7);
    ctx.lineTo(radius * 0.7, cy + radius * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

/** Ground the preview hides, so the territory line runs behind it as well. */
function traceGhostOccluder(ctx: CanvasRenderingContext2D, id: BuildingId, centre: Point): void {
  traceSilhouette(ctx, artOf(id), centre, UNIT);
}

/** Adds the outline to the current path. Never calls `beginPath`, so several can stack. */
function traceSilhouette(ctx: CanvasRenderingContext2D, art: BuildingArt, centre: Point, unit: number): void {
  const points = art.silhouette;
  ctx.moveTo(centre.x + points[0]!.x * unit, centre.y + points[0]!.y * unit);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(centre.x + points[index]!.x * unit, centre.y + points[index]!.y * unit);
  }
  ctx.closePath();
}

/**
 * Adds the ground area this building hides to the current path, in world space.
 * A finished structure contributes its outline; a site still going up only
 * contributes the part that has actually been raised.
 */
function traceBuildingOccluder(
  ctx: CanvasRenderingContext2D,
  building: PlacedBuilding,
  centre: Point,
  now: number,
): void {
  const art = artOf(building.id);
  if (building.state === "built") {
    traceSilhouette(ctx, art, centre, UNIT);
    return;
  }
  const progress = clamp01((now - building.startedAt) / building.durationMs);
  const half = art.siteHalfWidth * UNIT;
  // The scaffolding is what hides the ground here, and it stands a little
  // higher than the courses laid so far.
  const raised = (scaffoldHeight(art, progress) + 8) * UNIT;
  const foot = 14 * UNIT;
  ctx.rect(centre.x - half, centre.y - raised, half * 2, raised + foot);
}

export type { BuildingArt };
export {
  drawBuilding,
  drawBuildingHud,
  drawGhost,
  drawGhostTile,
  drawRefusalLabel,
  traceBuildingOccluder,
  traceGhostOccluder,
};
