import { config } from "@hw/ostrov-prototype-v2-config";
import type { Point } from "../hex/layout";
import { HEX_SIZE, SQUASH } from "../hex/layout";
import type { Unit } from "../state/units";
import {
  RALLY_DASH_PERIOD,
  UNIT_ARRIVAL_BEAT_SEC,
  UNIT_BOB_AMPLITUDE,
  UNIT_BOB_PERIOD,
  UNIT_SIZE,
} from "../tuning";
import { unitSpec } from "../units/catalog";
import { shade, withAlpha } from "./palette";

/**
 * Soldiers on the map, and the flag that says where they are going.
 *
 * A unit is drawn in the same terms as everything else on this canvas: flat
 * masses, light from the upper left, one bright accent. It is small — about a
 * fifth of a hex — so it carries exactly three shapes: the coloured tabard, the
 * head, and the one piece of kit that says which unit it is. Anything finer than
 * that is invisible at play zoom and noise when zoomed in.
 *
 * Under every one of them is a disc in the OWNER'S colour, the Warcraft III
 * convention: what makes a figure yours is not its costume but the ground it
 * stands on. It is drawn beneath the unit and above the tile, and it is two
 * rings rather than one flat blob — a dark contact shadow underneath so it never
 * washes out on snow or sand, then the saturated team colour on top of it, then
 * a bright rim. That stack is what keeps it legible on all four biomes: pale
 * snow and ice, mid green grass, warm sand.
 */

const TAU = Math.PI * 2;

/** How far the disc reaches past the figure, as a multiple of the unit size. */
const SHADOW_SPREAD = 0.92;

function fillEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU);
  ctx.fill();
}

/**
 * The team disc. Three passes: a soft dark contact shadow, the owner's colour
 * over it, and a bright rim on top of that.
 */
function drawTeamDisc(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string): void {
  const rx = size * SHADOW_SPREAD;
  const ry = rx * SQUASH;

  ctx.fillStyle = "rgba(10, 26, 42, 0.34)";
  fillEllipse(ctx, x + size * 0.16, y + size * 0.08, rx * 1.06, ry * 1.06);

  ctx.fillStyle = withAlpha(colour, 0.85);
  fillEllipse(ctx, x, y, rx, ry);

  // The rim is the light end of the same hue rather than white: white would put
  // a second highlight on a figure that already has one.
  ctx.strokeStyle = shade(colour, 1.45);
  ctx.lineWidth = size * 0.16;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(8, 24, 44, 0.5)";
  ctx.lineWidth = size * 0.09;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 1.09, ry * 1.09, 0, 0, TAU);
  ctx.stroke();
}

/** A sword held upright: the one shape a footman needs at this size. */
function drawSword(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = "#dfe8f0";
  ctx.fillRect(x - size * 0.09, y - size * 1.15, size * 0.18, size * 0.95);
  ctx.fillStyle = "#8b6a3c";
  ctx.fillRect(x - size * 0.24, y - size * 0.24, size * 0.48, size * 0.12);
  ctx.fillRect(x - size * 0.07, y - size * 0.16, size * 0.14, size * 0.24);
}

/** A drawn bow: an arc and its string, which reads even when the figure is six pixels. */
function drawBow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.strokeStyle = "#8b6a3c";
  ctx.lineWidth = size * 0.16;
  ctx.beginPath();
  ctx.arc(x, y - size * 0.5, size * 0.62, -Math.PI * 0.45, Math.PI * 0.45);
  ctx.stroke();
  ctx.strokeStyle = "rgba(232, 240, 246, 0.85)";
  ctx.lineWidth = size * 0.07;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.28, y - size * 1.05);
  ctx.lineTo(x + size * 0.28, y + size * 0.05);
  ctx.stroke();
}

/**
 * One soldier. `level` is the fog level of the ground under it, so a unit on
 * remembered ground is as dim as the ground it stands on, and one on ground that
 * has never been seen is not handed to this function at all.
 */
function drawUnit(ctx: CanvasRenderingContext2D, unit: Unit, now: number, level: number): void {
  const spec = unitSpec(unit.unitId);
  const size = UNIT_SIZE * config.army.unitScale;
  const walking = unit.leg < unit.path.length - 1;
  const seconds = now / 1000;
  // The bob runs while walking and settles when the unit stops, so a standing
  // formation is still and a moving one has a gait.
  const bob = walking ? UNIT_BOB_AMPLITUDE * Math.abs(Math.sin((TAU * (seconds + unit.id * 0.19)) / UNIT_BOB_PERIOD)) : 0;
  const beat =
    unit.arrivedAt === null ? 1 : Math.min(1, (now - unit.arrivedAt) / 1000 / UNIT_ARRIVAL_BEAT_SEC);

  ctx.save();
  ctx.globalAlpha = level;
  drawTeamDisc(ctx, unit.x, unit.y, size, config.army.playerColor);

  // A short bounce on arrival, so a unit reaching its post is visibly done.
  const land = beat < 1 ? 1 + 0.22 * Math.sin(Math.PI * beat) : 1;
  const y = unit.y - bob;

  ctx.save();
  ctx.translate(unit.x, y);
  ctx.scale(unit.facing < 0 ? -land : land, land);

  const body = spec.tint;
  ctx.fillStyle = shade(body, 0.72);
  ctx.beginPath();
  ctx.moveTo(-size * 0.42, 0);
  ctx.lineTo(-size * 0.34, -size * 0.95);
  ctx.lineTo(size * 0.34, -size * 0.95);
  ctx.lineTo(size * 0.42, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-size * 0.42, 0);
  ctx.lineTo(-size * 0.34, -size * 0.95);
  ctx.lineTo(size * 0.02, -size * 0.95);
  ctx.lineTo(size * 0.06, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(16, 30, 46, 0.55)";
  ctx.lineWidth = size * 0.09;
  ctx.beginPath();
  ctx.moveTo(-size * 0.42, 0);
  ctx.lineTo(-size * 0.34, -size * 0.95);
  ctx.lineTo(size * 0.34, -size * 0.95);
  ctx.lineTo(size * 0.42, 0);
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = "#f0d8bd";
  fillEllipse(ctx, 0, -size * 1.16, size * 0.29, size * 0.29);
  ctx.fillStyle = shade(body, 1.3);
  ctx.beginPath();
  ctx.ellipse(0, -size * 1.26, size * 0.33, size * 0.24, 0, Math.PI, 0);
  ctx.fill();

  if (spec.attackRangeHex > 1.5) {
    drawBow(ctx, size * 0.42, -size * 0.5, size);
  } else {
    drawSword(ctx, size * 0.5, -size * 0.5, size);
  }
  ctx.restore();
  ctx.restore();
}

/**
 * The rally flag and the line to it.
 *
 * Drawn on the ground, with the road and the territory outline, so a building
 * standing in the way covers it exactly as it covers the road. The dashes march
 * towards the flag, which is the cheapest way of saying which end is the
 * destination.
 */
function drawRally(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  time: number,
  colour: string,
): void {
  const same = Math.hypot(to.x - from.x, to.y - from.y) < 1;

  ctx.save();
  if (!same) {
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = ((time / RALLY_DASH_PERIOD) % 1) * 24;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(8, 24, 44, 0.45)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(colour, 0.95);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const ring = HEX_SIZE * 0.3;
  ctx.strokeStyle = withAlpha(colour, 0.9);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(to.x, to.y, ring, ring * SQUASH, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = withAlpha(colour, 0.22);
  fillEllipse(ctx, to.x, to.y, ring, ring * SQUASH);

  const height = HEX_SIZE * 0.62;
  ctx.strokeStyle = "#e8f2fa";
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x, to.y - height);
  ctx.stroke();
  const wave = 3.4 * Math.sin((TAU * time) / 1.6);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y - height);
  ctx.quadraticCurveTo(to.x + 14, to.y - height + 4 + wave, to.x + 26, to.y - height + 2);
  ctx.lineTo(to.x + 26, to.y - height + 15);
  ctx.quadraticCurveTo(to.x + 14, to.y - height + 17 - wave, to.x, to.y - height + 13);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = "rgba(8, 24, 44, 0.5)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

export { drawRally, drawUnit };
