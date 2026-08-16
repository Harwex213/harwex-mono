import type { RoadLeg } from "../economy/routes";
import type { Point } from "../hex/layout";
import { HEX_SIZE, SQUASH } from "../hex/layout";
import type { Delivery, Parcel, Stall } from "../state/parcels";
import {
  DELIVERY_BEAT_SEC,
  DELIVERY_RISE,
  PARCEL_BOB_AMPLITUDE,
  PARCEL_BOB_PERIOD,
  PARCEL_LIFT,
  PARCEL_SIZE,
} from "../tuning";
import { RESOURCE_COLOURS, shade, withAlpha } from "./palette";

/**
 * The haulage: the track worn between a producer and the castle, the crates
 * walking it, and the two things that happen at the ends — a landing at the
 * castle, and a building saying why nothing is leaving it.
 *
 * Everything is drawn in world space, so a crate pans, zooms and drifts with the
 * island it is standing on. The crates go down inside the tile pass, right after
 * the tile they are over, which is what keeps a building in front of one from
 * being walked through.
 */

const TAU = Math.PI * 2;

/** Ruts of the track and the pale gravel down the middle of it. */
const ROAD_EDGE = "rgba(64, 45, 26, 0.3)";

const ROAD_FILL = "rgba(214, 190, 148, 0.66)";

/** Width of the whole track, in world units. About a quarter of a hex. */
const ROAD_WIDTH = HEX_SIZE * 0.25;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * The cart track the crates walk, laid down with the territory outline and under
 * everything the buildings hide.
 *
 * It is the one thing that turns the crates from beads sliding over grass into
 * goods on their way somewhere: a moving box with no line under it reads as a
 * bug, and the same box on a worn track reads as a delivery.
 *
 * The legs arrive deduplicated, and each is stroked on its own so it can carry
 * the fog level of the hex it lies on. Round caps are what make a chain of
 * separate strokes read as one continuous track.
 */
function drawRoads(
  ctx: CanvasRenderingContext2D,
  legs: readonly RoadLeg[],
  levelOf: (leg: RoadLeg) => number,
): void {
  if (legs.length === 0) {
    return;
  }
  ctx.save();
  ctx.lineCap = "round";
  const passes: readonly { colour: string; width: number }[] = [
    { colour: ROAD_EDGE, width: ROAD_WIDTH },
    { colour: ROAD_FILL, width: ROAD_WIDTH * 0.56 },
  ];
  for (const pass of passes) {
    ctx.strokeStyle = pass.colour;
    ctx.lineWidth = pass.width;
    for (const leg of legs) {
      const level = levelOf(leg);
      if (level <= 0) {
        continue;
      }
      ctx.globalAlpha = level;
      ctx.beginPath();
      ctx.moveTo(leg.from.x, leg.from.y);
      ctx.lineTo(leg.to.x, leg.to.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Timber of the crate itself, lit from the upper left like every wall on the map. */
const CRATE_LIT = "#c08f5c";

const CRATE_MID = "#9a6c42";

const CRATE_DARK = "#6f4a2b";

const CRATE_LINE = "rgba(38, 24, 12, 0.72)";

/**
 * One crate on the move, carried a little above the road with a shadow under it.
 *
 * The box is timber, the load is the resource's own colour heaped over the rim.
 * That split is deliberate. A box painted in the resource colour vanishes on the
 * ground that produces it — a green crate on a meadow was the first attempt and
 * it read as a smudge — while brown timber holds its edge over grass, sand and
 * snow alike, and the coloured heap on top is what says which resource without a
 * label. It is the same colour the build panel prices things in.
 *
 * The load and the shadow are squashed exactly as a hex top face is, so the
 * crate sits in the island's projection instead of standing out of it.
 */
function drawParcel(ctx: CanvasRenderingContext2D, parcel: Parcel, time: number, level: number): void {
  const tint = RESOURCE_COLOURS[parcel.kind];
  const half = PARCEL_SIZE;
  const bob = PARCEL_BOB_AMPLITUDE * Math.sin((TAU * (time + parcel.id * 0.37)) / PARCEL_BOB_PERIOD);
  const baseY = parcel.y;
  const y = baseY - PARCEL_LIFT - bob;
  const boxTop = y - half * 0.5;
  const boxHeight = half * 1.5;

  ctx.save();
  ctx.globalAlpha = level;

  ctx.fillStyle = "rgba(20, 40, 58, 0.34)";
  ctx.beginPath();
  ctx.ellipse(parcel.x + 2.5, baseY + 2, half * 1.02, half * 1.02 * SQUASH, 0, 0, TAU);
  ctx.fill();

  // The load, heaped over the rim, drawn before the box so the box holds it in.
  ctx.fillStyle = shade(tint, 0.82);
  ctx.beginPath();
  ctx.ellipse(parcel.x, boxTop - half * 0.18, half * 0.92, half * 0.66, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.ellipse(parcel.x - half * 0.1, boxTop - half * 0.3, half * 0.7, half * 0.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = shade(tint, 1.28);
  ctx.beginPath();
  ctx.ellipse(parcel.x - half * 0.26, boxTop - half * 0.42, half * 0.34, half * 0.24, 0, 0, TAU);
  ctx.fill();

  const face = ctx.createLinearGradient(parcel.x - half, 0, parcel.x + half, 0);
  face.addColorStop(0, CRATE_LIT);
  face.addColorStop(0.55, CRATE_MID);
  face.addColorStop(1, CRATE_DARK);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.roundRect(parcel.x - half, boxTop, half * 2, boxHeight, half * 0.16);
  ctx.fill();

  // Two staves and a band. Three straight lines are what separate a crate from a
  // brown pill at the zoom the island is played at.
  ctx.strokeStyle = CRATE_LINE;
  ctx.lineWidth = half * 0.15;
  ctx.beginPath();
  ctx.moveTo(parcel.x - half * 0.34, boxTop);
  ctx.lineTo(parcel.x - half * 0.34, boxTop + boxHeight);
  ctx.moveTo(parcel.x + half * 0.34, boxTop);
  ctx.lineTo(parcel.x + half * 0.34, boxTop + boxHeight);
  ctx.stroke();
  ctx.strokeStyle = "rgba(58, 38, 18, 0.85)";
  ctx.lineWidth = half * 0.26;
  ctx.beginPath();
  ctx.moveTo(parcel.x - half, boxTop + boxHeight * 0.52);
  ctx.lineTo(parcel.x + half, boxTop + boxHeight * 0.52);
  ctx.stroke();

  ctx.strokeStyle = CRATE_LINE;
  ctx.lineWidth = half * 0.18;
  ctx.beginPath();
  ctx.roundRect(parcel.x - half, boxTop, half * 2, boxHeight, half * 0.16);
  ctx.stroke();
  ctx.restore();
}

/**
 * The landing: a ring opening on the castle and the credited amount floating off
 * it. Short and small — a delivery happens every second or two, so it has to
 * register without ever becoming the thing the player is looking at.
 */
function drawDelivery(ctx: CanvasRenderingContext2D, delivery: Delivery, now: number): void {
  const beat = clamp01((now - delivery.at) / 1000 / DELIVERY_BEAT_SEC);
  if (beat >= 1) {
    return;
  }
  const tint = RESOURCE_COLOURS[delivery.kind];
  const fade = 1 - beat;
  const spread = 1 - fade * fade;

  ctx.save();
  ctx.beginPath();
  const radius = HEX_SIZE * (0.2 + 0.5 * spread);
  ctx.ellipse(delivery.x, delivery.y, radius, radius * SQUASH, 0, 0, TAU);
  ctx.strokeStyle = withAlpha(tint, 0.85 * fade);
  ctx.lineWidth = 3 + 5 * fade;
  ctx.stroke();

  const y = delivery.y - HEX_SIZE * 0.5 - DELIVERY_RISE * spread;
  ctx.font = "700 26px ui-monospace, SF Mono, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = `rgba(8, 20, 33, ${0.85 * fade})`;
  ctx.lineWidth = 5;
  ctx.strokeText(`+${delivery.amount}`, delivery.x, y);
  ctx.fillStyle = withAlpha(tint, fade);
  ctx.fillText(`+${delivery.amount}`, delivery.x, y);
  ctx.restore();
}

const STALL_WORDS: Record<Stall["reason"], string> = {
  noCastle: "No castle",
  noRoute: "No route to the castle",
};

/**
 * The pill over a producer that is not shipping: why, and how much has piled up
 * inside while it waited. Drawn with the progress bars, after the territory
 * line, because it is a caption on the scene rather than part of it.
 *
 * Only genuine faults reach here. A road running at capacity used to get one
 * too, and three of them at once buried the island under captions saying that
 * the economy was working.
 */
function drawStallBadge(ctx: CanvasRenderingContext2D, centre: Point, stall: Stall, height: number): void {
  const words = `${STALL_WORDS[stall.reason]} · ${stall.stored}`;
  const y = centre.y - height;
  ctx.save();
  ctx.font = "600 17px system-ui, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const badge = 15;
  const gap = 9;
  const width = ctx.measureText(words).width + badge + gap * 3;
  const left = centre.x - width / 2;

  ctx.beginPath();
  ctx.roundRect(left, y - 16, width, 32, 16);
  ctx.fillStyle = "rgba(52, 30, 10, 0.88)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 190, 96, 0.7)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // A crate in the resource's own colour: the pile is made of the same thing the
  // road would have been carrying.
  ctx.fillStyle = RESOURCE_COLOURS[stall.kind];
  ctx.beginPath();
  ctx.roundRect(left + gap, y - badge / 2 - 1, badge, badge, 3);
  ctx.fill();

  ctx.fillStyle = "#ffe0b4";
  ctx.fillText(words, left + gap * 2 + badge, y + 1);
  ctx.restore();
}

export { drawDelivery, drawParcel, drawRoads, drawStallBadge };
