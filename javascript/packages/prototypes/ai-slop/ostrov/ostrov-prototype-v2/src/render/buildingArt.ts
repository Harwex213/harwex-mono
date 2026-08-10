import type { BuildingId } from "../buildings/catalog";
import { BARRACKS_ID, CASTLE_ID, SAWMILL_ID } from "../buildings/catalog";
import type { Point } from "../hex/layout";
import { HEX_SIZE, SQUASH, hexCorners } from "../hex/layout";
import {
  BRAZIER_FLICKER_PERIOD,
  BRAZIER_SPARK_PERIOD,
  BUILDING_ART_SCALE,
  COMPLETION_BEAT_SEC,
  DUMMY_SWING_PERIOD,
  FLAG_WAVE_PERIOD,
  GHOST_ALPHA,
  GHOST_DASH_PERIOD,
  HOIST_PERIOD,
  PENNANT_WAVE_PERIOD,
  PLACEMENT_BEAT_SEC,
  WHEEL_SPIN_PERIOD,
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
 * The abstraction level is deliberately the same as the terrain decoration in
 * `decor.ts`: flat shapes, one gradient per mass, light from the upper left, and
 * a single white accent on the lit side. No hatching, no per-brick detail — a
 * building has to read at the zoom the island is normally looked at.
 *
 * Every animated value is a function of absolute time, never of a per-frame
 * increment, so the motion is the same at 60 Hz and at 120 Hz.
 */

const TAU = Math.PI * 2;

const UNIT = (HEX_SIZE / 64) * BUILDING_ART_SCALE;

/** The four tones and the outline of one solid mass, lit from the upper left. */
type Tone = {
  /** Flat colour of the sliver of top face the low camera angle shows. */
  top: string;
  lit: string;
  mid: string;
  dark: string;
  line: string;
};

const STONE: Tone = {
  top: "#f0f5f9",
  lit: "#dee7ef",
  mid: "#c2ceda",
  dark: "#94a3b2",
  line: "rgba(46, 68, 90, 0.28)",
};

const TIMBER: Tone = {
  top: "#c19163",
  lit: "#ab7c50",
  mid: "#8a6242",
  dark: "#5f4229",
  line: "rgba(50, 32, 18, 0.4)",
};

/** Beams drawn over a timber wall, and the scaffolding of every site. */
const WOOD = "#8a6242";
const WOOD_DARK = "rgba(92, 63, 39, 0.75)";
const BEAM = "#6b4a2c";

const ROOF_LIT = "#c9736a";
const ROOF_MID = "#b25a55";
const ROOF_DARK = "#7c3a3a";

const SNOW = "rgba(255, 255, 255, 0.62)";

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
 * The slow warm pulse every lit opening shares. It is the one idle cue that runs
 * on a finished building of any kind, so it is computed once per draw.
 */
function glowOf(life: Life): number {
  return life.alive * (0.55 + 0.45 * Math.sin((TAU * life.time) / WINDOW_GLOW_PERIOD));
}

/**
 * One solid mass: a lit-to-shaded front face, the sliver of its flat top the low
 * camera angle shows, and a soft shadow where it meets the ground. Returns the y
 * of that top, which is where a roof or a row of merlons goes.
 *
 * There is deliberately no coursing on the face. Individual stones read as noise
 * at the zoom the island is played at, and they put the buildings at a finer
 * level of detail than the terrain under them.
 */
function drawMass(
  ctx: CanvasRenderingContext2D,
  cx: number,
  width: number,
  height: number,
  depth: number,
  tone: Tone,
): number {
  const top = -height;
  const cap = depth * SQUASH;
  const left = cx - width / 2;

  const face = ctx.createLinearGradient(left, 0, left + width, 0);
  face.addColorStop(0, tone.lit);
  face.addColorStop(0.55, tone.mid);
  face.addColorStop(1, tone.dark);
  ctx.fillStyle = face;
  ctx.fillRect(left, top, width, height);

  // Contact shadow: the bottom of a wall never catches as much light as its
  // middle, and this is what stops a mass looking pasted on the tile.
  const foot = Math.min(height, 26);
  const ground = ctx.createLinearGradient(0, -foot, 0, 0);
  ground.addColorStop(0, "rgba(24, 42, 60, 0)");
  ground.addColorStop(1, "rgba(24, 42, 60, 0.24)");
  ctx.fillStyle = ground;
  ctx.fillRect(left, -foot, width, foot);

  ctx.fillStyle = tone.top;
  ctx.fillRect(left, top - cap, width, cap);

  ctx.strokeStyle = tone.line;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(left, top - cap, width, height + cap);

  return top - cap;
}

/** Battlements along the top of a mass. Returns the y of the merlon tops. */
function drawMerlons(
  ctx: CanvasRenderingContext2D,
  cx: number,
  capTop: number,
  width: number,
  count: number,
  height: number,
): number {
  const step = width / (count * 2 - 1);
  const top = capTop - height;
  ctx.strokeStyle = STONE.line;
  ctx.lineWidth = 1.1;
  for (let index = 0; index < count; index += 1) {
    const x = cx - width / 2 + index * step * 2;
    ctx.fillStyle = STONE.mid;
    ctx.fillRect(x, top, step, height);
    ctx.strokeRect(x, top, step, height);
    ctx.fillStyle = STONE.top;
    ctx.fillRect(x, top - 1.8, step, 2.4);
  }
  return top;
}

/**
 * Gable roof over a rectangular mass, with the snow strip on its lit slope that
 * the conifers on the tiles carry too. Returns the y of the ridge.
 */
function drawGable(ctx: CanvasRenderingContext2D, cx: number, capTop: number, half: number, rise: number): number {
  const apex = capTop - rise;
  ctx.beginPath();
  ctx.moveTo(cx, apex);
  ctx.lineTo(cx + half, capTop);
  ctx.lineTo(cx - half, capTop);
  ctx.closePath();
  const shading = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  shading.addColorStop(0, ROOF_LIT);
  shading.addColorStop(0.5, ROOF_MID);
  shading.addColorStop(1, ROOF_DARK);
  ctx.fillStyle = shading;
  ctx.fill();
  ctx.strokeStyle = "rgba(58, 24, 26, 0.42)";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = SNOW;
  ctx.beginPath();
  ctx.moveTo(cx, apex);
  ctx.lineTo(cx - half, capTop);
  ctx.lineTo(cx - half + half * 0.3, capTop);
  ctx.lineTo(cx + half * 0.06, apex + rise * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  return apex;
}

/** Narrow arched window. `glow` runs 0..1 and drives how warmly it is lit. */
function drawWindow(ctx: CanvasRenderingContext2D, x: number, baseY: number, glow: number): void {
  const width = 7;
  const height = 13;
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
function drawPlinth(ctx: CanvasRenderingContext2D, rx: number, ry: number, base: string, cap: string): void {
  ctx.fillStyle = "rgba(28, 50, 70, 0.26)";
  fillEllipse(ctx, 3, 6, rx * 0.94, ry * 0.88);
  ctx.fillStyle = base;
  fillEllipse(ctx, 0, 2, rx, ry);
  ctx.fillStyle = cap;
  fillEllipse(ctx, 0, -1.5, rx * 0.93, ry * 0.84);
}

/** Timber door or gate under a round arch, with the warm pool a lit one throws. */
function drawArch(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  height: number,
  glow: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - width / 2, 0);
  ctx.lineTo(x - width / 2, -height + width / 2);
  ctx.arc(x, -height + width / 2, width / 2, Math.PI, 0);
  ctx.lineTo(x + width / 2, 0);
  ctx.closePath();
  ctx.fillStyle = "#46311f";
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
    ctx.moveTo(x + plank * (width / 3.4), 0);
    ctx.lineTo(x + plank * (width / 3.4), -height);
  }
  ctx.stroke();
  ctx.restore();
  if (glow > 0) {
    ctx.fillStyle = `rgba(255, 205, 120, ${0.34 * glow})`;
    fillEllipse(ctx, x, -3, width * 0.44, 5.5);
  }
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, baseY: number, time: number): void {
  const topY = baseY - 24;
  ctx.strokeStyle = "#4d5a66";
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, baseY + 3);
  ctx.lineTo(x, topY);
  ctx.stroke();
  ctx.fillStyle = "#ffd479";
  fillEllipse(ctx, x, topY - 3, 3.2, 3.2);

  const phase = (TAU * time) / FLAG_WAVE_PERIOD;
  const near = 4.6 * Math.sin(phase);
  const far = 3.4 * Math.sin(phase + 1.2);
  const top = topY + 3;
  const bottom = topY + 18;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.bezierCurveTo(x + 10, top + near, x + 20, top - near, x + 28, top + far);
  ctx.lineTo(x + 28, bottom + far);
  ctx.bezierCurveTo(x + 20, bottom - near, x + 10, bottom + near, x, bottom);
  ctx.closePath();
  ctx.fillStyle = "#d3504d";
  ctx.fill();
  ctx.strokeStyle = "rgba(88, 24, 24, 0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* --- Замок I ур. -----------------------------------------------------------
 *
 * Two masses and nothing else: a squat crenellated keep standing behind a low
 * crenellated curtain wall with the gate in it. Both masses are battlemented
 * because that notch is what carries the word "castle" at map zoom — a plain
 * box in front of a plain tower reads as a lighthouse, which is what the first
 * pass of this shape actually did. Level I is a starting keep, so the
 * silhouette is deliberately short of everything a capital would carry; see the
 * note over `CASTLE_SILHOUETTE`.
 */

/**
 * Top of a mass, the same value `drawMass` returns. The silhouette needs these
 * before anything is drawn, and deriving them keeps the outline on the walls
 * when a designer changes `hex.squash`.
 */
function capOf(height: number, depth: number): number {
  return -height - depth * SQUASH;
}

const KEEP_CX = -3;
const KEEP_WIDTH = 54;
const KEEP_HEIGHT = 74;
const KEEP_DEPTH = 24;
const KEEP_CAP = capOf(KEEP_HEIGHT, KEEP_DEPTH);
const KEEP_MERLON_HEIGHT = 10;

const WALL_WIDTH = 96;
const WALL_HEIGHT = 28;
const WALL_DEPTH_UNITS = 20;
const WALL_CAP = capOf(WALL_HEIGHT, WALL_DEPTH_UNITS);
const WALL_MERLON_HEIGHT = 8;

function drawCastle(ctx: CanvasRenderingContext2D, life: Life): void {
  const glow = glowOf(life);

  drawPlinth(ctx, 58, 14, "#93a2af", "#c2cdda");

  // Back to front: the keep, then the wall that hides its footing.
  const keepCap = drawMass(ctx, KEEP_CX, KEEP_WIDTH, KEEP_HEIGHT, KEEP_DEPTH, STONE);
  const merlonTop = drawMerlons(ctx, KEEP_CX, keepCap, KEEP_WIDTH, 5, KEEP_MERLON_HEIGHT);
  drawWindow(ctx, KEEP_CX - 12, -58, glow);
  drawWindow(ctx, KEEP_CX + 12, -58, glow);

  const wallCap = drawMass(ctx, 0, WALL_WIDTH, WALL_HEIGHT, WALL_DEPTH_UNITS, STONE);
  drawMerlons(ctx, 0, wallCap, WALL_WIDTH, 6, WALL_MERLON_HEIGHT);
  // The keep drops a shadow across the walkway, which is the one cue that says
  // the two masses stand at different depths rather than in one plane.
  ctx.fillStyle = "rgba(38, 62, 88, 0.2)";
  ctx.fillRect(KEEP_CX - KEEP_WIDTH / 2, wallCap, KEEP_WIDTH, -wallCap - WALL_HEIGHT);

  drawArch(ctx, 0, 20, 22, glow);

  if (life.alive > 0) {
    drawFlag(ctx, KEEP_CX, merlonTop, life.time);
  }
}

/**
 * Outline of the keep, traced once round as a staircase profile.
 *
 * What is missing from it is the point: the level-I keep is one tower and one
 * wall, both of them flat-topped boxes. Levels II and III have corner towers to
 * raise at the two ends of the wall, a gatehouse to push forward around the
 * arch, a second storey and a spire to put on the keep, and the whole band
 * above y = -100 to rise into.
 */
const CASTLE_SILHOUETTE: readonly Point[] = [
  { x: -58, y: 14 },
  { x: -58, y: -4 },
  { x: -WALL_WIDTH / 2, y: -4 },
  { x: -WALL_WIDTH / 2, y: WALL_CAP - WALL_MERLON_HEIGHT },
  { x: KEEP_CX - KEEP_WIDTH / 2, y: WALL_CAP - WALL_MERLON_HEIGHT },
  { x: KEEP_CX - KEEP_WIDTH / 2, y: KEEP_CAP - KEEP_MERLON_HEIGHT },
  { x: KEEP_CX + KEEP_WIDTH / 2, y: KEEP_CAP - KEEP_MERLON_HEIGHT },
  { x: KEEP_CX + KEEP_WIDTH / 2, y: WALL_CAP - WALL_MERLON_HEIGHT },
  { x: WALL_WIDTH / 2, y: WALL_CAP - WALL_MERLON_HEIGHT },
  { x: WALL_WIDTH / 2, y: -4 },
  { x: 58, y: -4 },
  { x: 58, y: 14 },
];

const CASTLE_ART: BuildingArt = {
  height: 100,
  draw: drawCastle,
  silhouette: CASTLE_SILHOUETTE,
  siteHalfWidth: 58,
};

/* --- Лесопилка I ур. -------------------------------------------------------
 *
 * A timber shed under a steep gable, a water wheel on its left flank and a stack
 * of cut logs in front of the door. The wheel is the whole reason the silhouette
 * cannot be confused with the keep: a wide low triangle with a disc on one side
 * against a tall notched tower.
 */

const WHEEL_X = -34;
const WHEEL_Y = -15;
const WHEEL_RADIUS = 17;
const WHEEL_PADDLES = 8;

const SHED_CX = 8;
const SHED_WIDTH = 56;
const SHED_HEIGHT = 32;
const SHED_DEPTH = 20;
const SHED_CAP = capOf(SHED_HEIGHT, SHED_DEPTH);
const ROOF_HALF = 36;
const ROOF_RISE = 30;

/** One log seen end-on: bark ring, pale end grain, two growth rings. */
function drawLog(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.fillStyle = "rgba(28, 50, 70, 0.2)";
  fillEllipse(ctx, x + 1.5, y + 2, radius, radius * 0.94);
  ctx.fillStyle = "#5d4128";
  fillEllipse(ctx, x, y, radius, radius);
  ctx.fillStyle = "#d8b483";
  fillEllipse(ctx, x - radius * 0.08, y - radius * 0.08, radius * 0.78, radius * 0.78);
  ctx.strokeStyle = "rgba(140, 100, 60, 0.75)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(x - radius * 0.08, y - radius * 0.08, radius * 0.46, 0, TAU);
  ctx.moveTo(x + radius * 0.12, y - radius * 0.08);
  ctx.arc(x - radius * 0.08, y - radius * 0.08, radius * 0.2, 0, TAU);
  ctx.stroke();
}

/**
 * The mill wheel. `spin` is an absolute angle in radians, so the wheel is where
 * the clock says it is rather than where the last frame left it.
 */
function drawWaterWheel(ctx: CanvasRenderingContext2D, spin: number): void {
  const hub = WHEEL_RADIUS * 0.46;
  const rim = WHEEL_RADIUS * 0.86;

  ctx.save();
  ctx.translate(WHEEL_X, WHEEL_Y);
  ctx.rotate(spin);

  // The paddles are narrow and stand proud of the rim, so open sky shows between
  // them. A filled annulus turns the wheel into a second log end sitting next to
  // the log pile, and the turn stops reading at all.
  // The wheel hangs on the lit flank of the shed, so its timber is the light end
  // of the wood ramp; a dark wheel there sank into the plinth shadow.
  ctx.fillStyle = "#b0834f";
  ctx.strokeStyle = "rgba(44, 28, 14, 0.6)";
  ctx.lineWidth = 1.1;
  for (let paddle = 0; paddle < WHEEL_PADDLES; paddle += 1) {
    ctx.save();
    ctx.rotate((TAU * paddle) / WHEEL_PADDLES);
    ctx.fillRect(hub, -WHEEL_RADIUS * 0.16, WHEEL_RADIUS - hub, WHEEL_RADIUS * 0.32);
    ctx.strokeRect(hub, -WHEEL_RADIUS * 0.16, WHEEL_RADIUS - hub, WHEEL_RADIUS * 0.32);
    ctx.restore();
  }

  ctx.strokeStyle = "#6b4a2c";
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.arc(0, 0, rim, 0, TAU);
  ctx.stroke();

  ctx.fillStyle = "#5f4229";
  fillEllipse(ctx, 0, 0, hub * 0.72, hub * 0.72);
  ctx.fillStyle = "#c19163";
  fillEllipse(ctx, -hub * 0.12, -hub * 0.16, hub * 0.34, hub * 0.34);
  ctx.restore();
}

/** Beams over the plank wall: two posts, a rail and a brace in each outer bay. */
function drawTimberFrame(ctx: CanvasRenderingContext2D): void {
  const left = SHED_CX - SHED_WIDTH / 2;
  const right = SHED_CX + SHED_WIDTH / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, -SHED_HEIGHT, SHED_WIDTH, SHED_HEIGHT);
  ctx.clip();
  ctx.strokeStyle = BEAM;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  for (const x of [left + 3, SHED_CX, right - 3]) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, -SHED_HEIGHT);
  }
  ctx.moveTo(left, -SHED_HEIGHT + 3);
  ctx.lineTo(right, -SHED_HEIGHT + 3);
  ctx.stroke();
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(left + 3, -2);
  ctx.lineTo(SHED_CX, -SHED_HEIGHT + 3);
  ctx.moveTo(right - 3, -2);
  ctx.lineTo(SHED_CX, -SHED_HEIGHT + 3);
  ctx.stroke();
  ctx.restore();
}

function drawSawmill(ctx: CanvasRenderingContext2D, life: Life): void {
  const glow = glowOf(life);

  drawPlinth(ctx, 50, 12, "#9d8a6c", "#c8b790");

  // The wheel is behind the shed wall it is bolted to, so it goes down first.
  drawWaterWheel(ctx, life.alive > 0 ? (TAU * life.time) / WHEEL_SPIN_PERIOD : 0);

  // Sluice: the plank chute that explains what turns the wheel.
  ctx.fillStyle = "#7a5c3c";
  ctx.fillRect(WHEEL_X - 2, -SHED_HEIGHT - 2, 26, 5);
  ctx.fillStyle = "rgba(180, 220, 238, 0.7)";
  ctx.fillRect(WHEEL_X - 2, -SHED_HEIGHT - 2, 26, 1.8);

  const shedCap = drawMass(ctx, SHED_CX, SHED_WIDTH, SHED_HEIGHT, SHED_DEPTH, TIMBER);
  drawTimberFrame(ctx);
  drawGable(ctx, SHED_CX, shedCap, ROOF_HALF, ROOF_RISE);

  // Window left, door middle, stock right: nothing on the front wall overlaps
  // anything else, which is what keeps the shed readable when it is small.
  drawWindow(ctx, SHED_CX - 20, -16, glow);
  drawArch(ctx, SHED_CX, 20, 24, glow);

  // Cut stock, which is what makes it a sawmill and not a watermill: two logs on
  // the ground and one riding on top.
  drawLog(ctx, 28, -5, 6.8);
  drawLog(ctx, 41, -5, 6.8);
  drawLog(ctx, 34.5, -16, 6.8);
}

/** Traced once round: up the free side of the wheel, over the gable, past the logs. */
function sawmillSilhouette(): Point[] {
  const points: Point[] = [{ x: -50, y: 12 }];
  const steps = 8;
  for (let step = 0; step <= steps; step += 1) {
    const angle = ((105 + (180 * step) / steps) * Math.PI) / 180;
    points.push({
      x: WHEEL_X + WHEEL_RADIUS * Math.cos(angle),
      y: WHEEL_Y + WHEEL_RADIUS * Math.sin(angle),
    });
  }
  points.push(
    { x: SHED_CX - SHED_WIDTH / 2, y: -30 },
    { x: SHED_CX - SHED_WIDTH / 2, y: SHED_CAP },
    { x: SHED_CX - ROOF_HALF, y: SHED_CAP },
    { x: SHED_CX, y: SHED_CAP - ROOF_RISE },
    { x: SHED_CX + ROOF_HALF, y: SHED_CAP },
    { x: SHED_CX + SHED_WIDTH / 2, y: SHED_CAP },
    { x: SHED_CX + SHED_WIDTH / 2, y: -25 },
    { x: 48, y: -25 },
    { x: 48, y: 12 },
  );
  return points;
}

const SAWMILL_ART: BuildingArt = {
  height: 76,
  draw: drawSawmill,
  silhouette: sawmillSilhouette(),
  siteHalfWidth: 50,
};

/* --- Казарма I ур. ---------------------------------------------------------
 *
 * A long low hall under a hipped roof, standing inside a ring of pointed
 * stakes, with a banner pole planted at one end of the yard.
 *
 * The silhouette is built to be told apart from the two buildings that already
 * exist, at the zoom the island is played at and from the outline alone. The
 * castle is tall, square-shouldered and notched; the sawmill is a wide triangle
 * with a disc bolted to its flank. This is neither: a WIDE, LOW, FLAT-TOPPED
 * roof — a trapezoid, not a gable — with a spiky palisade running out past it on
 * both sides and one thin vertical spike well off centre. Nothing about it is
 * symmetrical the way the keep is, and nothing on it is round the way the wheel
 * is.
 *
 * Three things move once it is finished, and all three were picked for contrast
 * rather than for realism, because the chimney smoke of the first attempt was a
 * pale blob over pale stone and read as nothing at all:
 *
 * - the pennant, dark red against the sky, snapping on its pole;
 * - the brazier by the gate — a warm flame against grey stone, flickering on a
 *   short period, with sparks climbing off it;
 * - the training dummy in the yard, swinging on its post.
 */

const YARD_TONE: Tone = {
  top: "#e2dcc9",
  lit: "#cfc7b0",
  mid: "#b3aa92",
  dark: "#8d856f",
  line: "rgba(58, 50, 34, 0.32)",
};

const HALL_CX = 2;
const HALL_WIDTH = 62;
const HALL_HEIGHT = 27;
const HALL_DEPTH = 18;
const HALL_CAP = capOf(HALL_HEIGHT, HALL_DEPTH);

/** Hipped roof: wider at the eaves than at the ridge, and flat on top. */
const ROOF_EAVES_HALF = 34;
const ROOF_RIDGE_HALF = 15;
const BARRACKS_ROOF_RISE = 14;
const ROOF_RIDGE_Y = HALL_CAP - BARRACKS_ROOF_RISE;

/**
 * The stockade reaches well past the roof on both sides. That overhang is the
 * whole silhouette cue: a first pass had the wings hidden behind the eaves, and
 * with nothing sticking out the building read as a cottage with a flag.
 */
const PALISADE_HALF = 54;
const PALISADE_TOP = -31;
const STAKE_STEP = 9.6;

const POLE_X = -46;
const POLE_HALF = 2.8;
const POLE_TOP = -92;

/**
 * Slate, not the tile red of the sawmill gable.
 *
 * At play zoom the first pass of this roof and the sawmill's were the same red
 * triangle-ish blob on the same island, and colour was doing nothing to separate
 * them. A cold dark roof reads as a barrack block against grass, sand and snow
 * alike, and it is the only roof on the island that is not warm.
 */
const SLATE_LIT = "#63798c";
const SLATE_MID = "#4b5e6e";
const SLATE_DARK = "#35434f";

const DUMMY_X = -22;
const BRAZIER_X = 38;

/** The stockade the hall stands in. Drawn first, so the hall covers its middle. */
function drawPalisade(ctx: CanvasRenderingContext2D): void {
  const count = Math.round((PALISADE_HALF * 2) / STAKE_STEP);
  const width = STAKE_STEP * 0.78;
  for (let index = 0; index <= count; index += 1) {
    const x = -PALISADE_HALF + index * STAKE_STEP;
    // Every third stake is a shade darker, which is the only variation the row
    // needs to stop reading as a comb.
    ctx.fillStyle = index % 3 === 0 ? "#6b4a2c" : "#8a6242";
    ctx.beginPath();
    ctx.moveTo(x - width / 2, 4);
    ctx.lineTo(x - width / 2, PALISADE_TOP + 6);
    ctx.lineTo(x, PALISADE_TOP);
    ctx.lineTo(x + width / 2, PALISADE_TOP + 6);
    ctx.lineTo(x + width / 2, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(46, 30, 16, 0.5)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  // The rail that ties them together, so the row is a fence and not a row.
  ctx.fillStyle = "rgba(60, 40, 22, 0.55)";
  ctx.fillRect(-PALISADE_HALF, PALISADE_TOP + 11, PALISADE_HALF * 2, 3.8);
}

/**
 * The hipped roof. Flat-topped on purpose: a gable of the same width would be
 * the sawmill seen from the other side.
 */
function drawHipRoof(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(HALL_CX - ROOF_EAVES_HALF, HALL_CAP);
  ctx.lineTo(HALL_CX - ROOF_RIDGE_HALF, ROOF_RIDGE_Y);
  ctx.lineTo(HALL_CX + ROOF_RIDGE_HALF, ROOF_RIDGE_Y);
  ctx.lineTo(HALL_CX + ROOF_EAVES_HALF, HALL_CAP);
  ctx.closePath();
  const shading = ctx.createLinearGradient(HALL_CX - ROOF_EAVES_HALF, 0, HALL_CX + ROOF_EAVES_HALF, 0);
  shading.addColorStop(0, SLATE_LIT);
  shading.addColorStop(0.5, SLATE_MID);
  shading.addColorStop(1, SLATE_DARK);
  ctx.fillStyle = shading;
  ctx.fill();
  ctx.strokeStyle = "rgba(20, 30, 40, 0.5)";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // The one white accent, the same strip of snow the conifers and the sawmill
  // gable carry, on the lit slope.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = SNOW;
  ctx.beginPath();
  ctx.moveTo(HALL_CX - ROOF_EAVES_HALF, HALL_CAP);
  ctx.lineTo(HALL_CX - ROOF_RIDGE_HALF, ROOF_RIDGE_Y);
  ctx.lineTo(HALL_CX + ROOF_RIDGE_HALF * 0.2, ROOF_RIDGE_Y);
  ctx.lineTo(HALL_CX - ROOF_EAVES_HALF + 14, HALL_CAP);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // A pale ridge cap: the flat top has to be visible as flat, or the hipped roof
  // reads as the sawmill's gable seen small.
  ctx.fillStyle = "#e8eef3";
  ctx.fillRect(HALL_CX - ROOF_RIDGE_HALF - 1.5, ROOF_RIDGE_Y - 3.2, ROOF_RIDGE_HALF * 2 + 3, 3.2);
}

/**
 * The banner and its pole. `wave` is an absolute phase, so the cloth is where
 * the clock says it is and not where the last frame left it.
 */
function drawPennant(ctx: CanvasRenderingContext2D, time: number): void {
  ctx.fillStyle = "#5c6774";
  ctx.fillRect(POLE_X - POLE_HALF, POLE_TOP, POLE_HALF * 2, 6 - POLE_TOP);
  ctx.fillStyle = "#8b98a6";
  ctx.fillRect(POLE_X - POLE_HALF, POLE_TOP, POLE_HALF * 0.9, 6 - POLE_TOP);
  ctx.fillStyle = "#ffd479";
  fillEllipse(ctx, POLE_X, POLE_TOP - 3.4, 3.4, 3.4);

  const phase = (TAU * time) / PENNANT_WAVE_PERIOD;
  const near = 5.8 * Math.sin(phase);
  const far = 4.6 * Math.sin(phase + 1.35);
  const top = POLE_TOP + 4;
  const bottom = top + 19;
  ctx.beginPath();
  ctx.moveTo(POLE_X, top);
  ctx.bezierCurveTo(POLE_X + 13, top + near, POLE_X + 25, top - near, POLE_X + 37, top + far * 0.6);
  // A swallowtail rather than a rectangle: the notch is what says "banner" when
  // the whole building is forty pixels tall.
  ctx.lineTo(POLE_X + 28, top + 9.5 + far * 0.5);
  ctx.lineTo(POLE_X + 37, bottom + far * 0.6);
  ctx.bezierCurveTo(POLE_X + 25, bottom - near, POLE_X + 13, bottom + near, POLE_X, bottom);
  ctx.closePath();
  ctx.fillStyle = "#c0403c";
  ctx.fill();
  ctx.strokeStyle = "rgba(84, 20, 20, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** The straw man in the yard, swinging on its post. */
function drawTrainingDummy(ctx: CanvasRenderingContext2D, time: number): void {
  const swing = 0.14 * Math.sin((TAU * time) / DUMMY_SWING_PERIOD);
  ctx.save();
  ctx.translate(DUMMY_X, 2);
  ctx.rotate(swing);
  ctx.fillStyle = "rgba(28, 50, 70, 0.22)";
  fillEllipse(ctx, 2, 1, 9, 3.4);
  ctx.fillStyle = "#6b4a2c";
  ctx.fillRect(-2.4, -28, 4.8, 28);
  ctx.fillRect(-11, -22, 22, 4.4);
  ctx.fillStyle = "#c9a45c";
  fillEllipse(ctx, 0, -31, 5.6, 5.6);
  ctx.strokeStyle = "rgba(70, 46, 20, 0.6)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(0, -31, 5.6, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * The brazier by the gate: a warm flame and its sparks, which is the cue that
 * survives being twenty pixels tall. The flicker is two sines of unrelated
 * periods, so the fire never pulses on an obvious beat.
 */
function drawBrazier(ctx: CanvasRenderingContext2D, time: number, alive: number): void {
  ctx.strokeStyle = "#4a4038";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(BRAZIER_X - 6, 2);
  ctx.lineTo(BRAZIER_X, -11);
  ctx.moveTo(BRAZIER_X + 6, 2);
  ctx.lineTo(BRAZIER_X, -11);
  ctx.stroke();
  ctx.fillStyle = "#3f3730";
  ctx.beginPath();
  ctx.moveTo(BRAZIER_X - 8.5, -18);
  ctx.lineTo(BRAZIER_X + 8.5, -18);
  ctx.lineTo(BRAZIER_X + 5.5, -10);
  ctx.lineTo(BRAZIER_X - 5.5, -10);
  ctx.closePath();
  ctx.fill();
  if (alive <= 0) {
    return;
  }

  const flicker =
    0.5 +
    0.3 * Math.sin((TAU * time) / BRAZIER_FLICKER_PERIOD) +
    0.2 * Math.sin((TAU * time) / (BRAZIER_FLICKER_PERIOD * 1.7) + 1.1);
  const height = 13 + 5 * flicker;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(BRAZIER_X, -22, 0, BRAZIER_X, -22, 22);
  halo.addColorStop(0, `rgba(255, 186, 92, ${0.34 + 0.16 * flicker})`);
  halo.addColorStop(1, "rgba(255, 186, 92, 0)");
  ctx.fillStyle = halo;
  fillEllipse(ctx, BRAZIER_X, -22, 22, 22);
  ctx.restore();

  ctx.fillStyle = "#e8622c";
  ctx.beginPath();
  ctx.moveTo(BRAZIER_X - 6, -18);
  ctx.quadraticCurveTo(BRAZIER_X - 5, -18 - height * 0.7, BRAZIER_X, -18 - height);
  ctx.quadraticCurveTo(BRAZIER_X + 5, -18 - height * 0.7, BRAZIER_X + 6, -18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffd05e";
  ctx.beginPath();
  ctx.moveTo(BRAZIER_X - 3, -18);
  ctx.quadraticCurveTo(BRAZIER_X - 2.4, -18 - height * 0.5, BRAZIER_X + 0.6, -18 - height * 0.66);
  ctx.quadraticCurveTo(BRAZIER_X + 3, -18 - height * 0.45, BRAZIER_X + 3, -18);
  ctx.closePath();
  ctx.fill();

  for (let spark = 0; spark < 3; spark += 1) {
    const t = ((time / BRAZIER_SPARK_PERIOD + spark * 0.37) % 1 + 1) % 1;
    const rise = 30 * t;
    const fade = 1 - t;
    ctx.fillStyle = `rgba(255, 206, 120, ${0.85 * fade * fade})`;
    fillEllipse(ctx, BRAZIER_X + Math.sin(t * 6 + spark) * 4, -20 - rise, 1.9 * fade + 0.6, 1.9 * fade + 0.6);
  }
}

function drawBarracks(ctx: CanvasRenderingContext2D, life: Life): void {
  const glow = glowOf(life);

  drawPlinth(ctx, 50, 12, "#9a9079", "#cbc2a8");
  drawPalisade(ctx);

  drawMass(ctx, HALL_CX, HALL_WIDTH, HALL_HEIGHT, HALL_DEPTH, YARD_TONE);
  // A timber sill along the foot of the wall, which is what stops the hall from
  // reading as a second, wider keep.
  ctx.fillStyle = "rgba(90, 62, 38, 0.55)";
  ctx.fillRect(HALL_CX - HALL_WIDTH / 2, -7, HALL_WIDTH, 7);
  drawHipRoof(ctx);

  // Two shuttered openings and the gate, nothing overlapping anything else.
  drawWindow(ctx, HALL_CX - 20, -11, glow);
  drawWindow(ctx, HALL_CX + 20, -11, glow);
  drawArch(ctx, HALL_CX, 19, 22, glow);

  drawTrainingDummy(ctx, life.alive > 0 ? life.time : 0);
  drawBrazier(ctx, life.time, life.alive);
  if (life.alive > 0) {
    drawPennant(ctx, life.time);
  } else {
    // The bare pole goes up with the walls; the banner is run up it on the
    // completion beat, which is the moment the barracks becomes a barracks.
    ctx.fillStyle = "#5c6774";
    ctx.fillRect(POLE_X - POLE_HALF, POLE_TOP, POLE_HALF * 2, 6 - POLE_TOP);
  }
}

/**
 * Traced once round, left to right: the left palisade wing, the banner pole as
 * a thin spike, the hipped roof, the right wing.
 */
const BARRACKS_SILHOUETTE: readonly Point[] = [
  { x: -PALISADE_HALF, y: 12 },
  { x: -PALISADE_HALF, y: PALISADE_TOP },
  { x: POLE_X - POLE_HALF, y: PALISADE_TOP },
  { x: POLE_X - POLE_HALF, y: POLE_TOP },
  { x: POLE_X + POLE_HALF, y: POLE_TOP },
  { x: POLE_X + POLE_HALF, y: PALISADE_TOP },
  { x: HALL_CX - ROOF_EAVES_HALF, y: PALISADE_TOP },
  { x: HALL_CX - ROOF_EAVES_HALF, y: HALL_CAP },
  { x: HALL_CX - ROOF_RIDGE_HALF, y: ROOF_RIDGE_Y },
  { x: HALL_CX + ROOF_RIDGE_HALF, y: ROOF_RIDGE_Y },
  { x: HALL_CX + ROOF_EAVES_HALF, y: HALL_CAP },
  { x: HALL_CX + ROOF_EAVES_HALF, y: PALISADE_TOP },
  { x: PALISADE_HALF, y: PALISADE_TOP },
  { x: PALISADE_HALF, y: 12 },
];

const BARRACKS_ART: BuildingArt = {
  height: -POLE_TOP,
  draw: drawBarracks,
  silhouette: BARRACKS_SILHOUETTE,
  siteHalfWidth: 54,
};

/**
 * Placeholder for every building that has no art of its own yet: a stone cottage
 * under a wooden gable. It shares the whole flow — ghost, beat, scaffolding,
 * lit window — so the panel is never a dead end.
 */
function drawCottage(ctx: CanvasRenderingContext2D, life: Life): void {
  const glow = glowOf(life);
  drawPlinth(ctx, 30, 8, "#93a2af", "#c2cdda");
  const cap = drawMass(ctx, 0, 44, 30, 18, STONE);

  const apex = cap - 22;
  ctx.beginPath();
  ctx.moveTo(0, apex);
  ctx.lineTo(27, cap);
  ctx.lineTo(-27, cap);
  ctx.closePath();
  const shading = ctx.createLinearGradient(-27, 0, 27, 0);
  shading.addColorStop(0, TIMBER.lit);
  shading.addColorStop(0.5, TIMBER.mid);
  shading.addColorStop(1, TIMBER.dark);
  ctx.fillStyle = shading;
  ctx.fill();
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  drawArch(ctx, 0, 13, 18, glow);
  drawWindow(ctx, -14, -12, glow);
  drawWindow(ctx, 14, -12, glow);
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

const ART_BY_ID: Partial<Record<BuildingId, BuildingArt>> = {
  [CASTLE_ID]: CASTLE_ART,
  [SAWMILL_ID]: SAWMILL_ART,
  [BARRACKS_ID]: BARRACKS_ART,
};

function artOf(id: BuildingId): BuildingArt {
  return ART_BY_ID[id] ?? COTTAGE_ART;
}

/**
 * How far this building reaches above the centre of its tile, in world units.
 * Whatever wants to hang a label over a roof needs it and has no business
 * knowing the art units the roof was drawn in.
 */
function buildingHeight(id: BuildingId): number {
  return artOf(id).height * UNIT;
}

/* --- Construction ----------------------------------------------------------
 *
 * The site, the scaffolding, the reveal and the completion beat are shared by
 * every building and parameterised by nothing but `height` and `siteHalfWidth`.
 * That was the choice over a bespoke sequence per building: five more buildings
 * are coming, and each of them only has to declare those two numbers to get the
 * whole flow. The deck count comes from the height, so a shed does not get the
 * scaffolding of a keep.
 */

/** How far the scaffolding has been raised at this point of the build. */
function scaffoldHeight(art: BuildingArt, progress: number): number {
  return 26 + (art.height - 20) * progress;
}

/** Levels of planking on a site this tall. A low building gets fewer. */
function deckCount(art: BuildingArt): number {
  return Math.max(2, Math.min(4, Math.round(art.height / 38)));
}

/** Scaffolding around a site. `height` is how far up it has already been raised. */
function drawScaffold(ctx: CanvasRenderingContext2D, art: BuildingArt, height: number, time: number): void {
  const outer = art.siteHalfWidth - 6;
  const inner = outer * 0.42;
  const decks = deckCount(art);

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
  buildingHeight,
  drawBuilding,
  drawBuildingHud,
  drawGhost,
  drawGhostTile,
  drawRefusalLabel,
  traceBuildingOccluder,
  traceGhostOccluder,
};
