import { ACTIVE_UNIT_GROUP_TYPE, getUnitGroupType } from "./active-unit-group.js";
import { offsetToPixel } from "./hex-layout.js";

/**
 * Shared canvas painting for battle units (disc, weight ring, group emoji,
 * facing triangle, ruler crown) and the hex-scene constants both battle
 * canvases (disposition, active) draw with.
 */

const HEX_HEIGHT = 128; // world units, top vertex to bottom vertex
const HEX_SIZE = HEX_HEIGHT / 2; // circumradius
const GRID_STROKE_PX = 1; // screen px, constant under zoom
const HOVER_STROKE_PX = 2;
const SELECTED_STROKE_PX = 4;
const UNIT_DISC_RADIUS = HEX_SIZE * 0.6; // world units — part of the scene, scales with zoom
const UNIT_EMOJI_SIZE = HEX_SIZE * 0.7;
const CROWN_EMOJI_SIZE = HEX_SIZE * 0.5;

// world-px offset from a hex center to each of its 6 vertices, indexed by facing
const HEX_HALF_WIDTH = (Math.sqrt(3) / 2) * HEX_SIZE;
const VERTEX_OFFSET = [
  { x: HEX_HALF_WIDTH, y: -HEX_SIZE / 2 },
  { x: 0, y: -HEX_SIZE },
  { x: -HEX_HALF_WIDTH, y: -HEX_SIZE / 2 },
  { x: -HEX_HALF_WIDTH, y: HEX_SIZE / 2 },
  { x: 0, y: HEX_SIZE },
  { x: HEX_HALF_WIDTH, y: HEX_SIZE / 2 },
];

const GROUP_EMOJI = {
  [ACTIVE_UNIT_GROUP_TYPE.CAVALRY]: "🐎",
  [ACTIVE_UNIT_GROUP_TYPE.ARCHERS]: "🏹",
  [ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY]: "⚔️",
  [ACTIVE_UNIT_GROUP_TYPE.SPEARMEN]: "🔱",
};

// weight class shows as the disc's ring: light none, medium thin, heavy
// thick; the dedicated ranged types (archer, longbowman, …) carry no grade
const RING_WIDTH_BY_GRADE = { medium: 0.06, heavy: 0.14 }; // × HEX_SIZE
const unitRingWidth = (unitType) => (RING_WIDTH_BY_GRADE[unitType.split("-")[0]] ?? 0) * HEX_SIZE;

/**
 * @param {(name: string) => string} token resolved-CSS-token accessor
 * @returns {{ drawUnit: (ctx: CanvasRenderingContext2D, unit: ActiveBattleUnit) => void }}
 */
const createUnitPainter = (token) => {
  const discBySide = { attacker: token("--unit-attacker"), defender: token("--unit-defender") };
  const ringColor = token("--unit-ring");
  const emojiFont = `${UNIT_EMOJI_SIZE}px ${token("--font-body")}`;
  const crownFont = `${CROWN_EMOJI_SIZE}px ${token("--font-body")}`;

  // short filled triangle from the disc center toward the front vertex
  const drawFacingIndicator = (ctx, x, y, facing) => {
    const offset = VERTEX_OFFSET[facing];
    const len = Math.hypot(offset.x, offset.y) || 1;
    const dir = { x: offset.x / len, y: offset.y / len };
    const perp = { x: -dir.y, y: dir.x };
    const tip = { x: x + dir.x * UNIT_DISC_RADIUS * 0.95, y: y + dir.y * UNIT_DISC_RADIUS * 0.95 };
    const baseCenter = { x: x + dir.x * UNIT_DISC_RADIUS * 0.4, y: y + dir.y * UNIT_DISC_RADIUS * 0.4 };
    const baseHalf = UNIT_DISC_RADIUS * 0.3;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(baseCenter.x + perp.x * baseHalf, baseCenter.y + perp.y * baseHalf);
    ctx.lineTo(baseCenter.x - perp.x * baseHalf, baseCenter.y - perp.y * baseHalf);
    ctx.closePath();
    ctx.fillStyle = ringColor;
    ctx.fill();
  };

  const drawUnit = (ctx, unit) => {
    const { x, y } = offsetToPixel(unit.position.col, unit.position.row, HEX_SIZE);
    ctx.beginPath();
    ctx.arc(x, y, UNIT_DISC_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = discBySide[unit.side];
    ctx.fill();
    const ringWidth = unitRingWidth(unit.type);
    if (ringWidth) {
      ctx.lineWidth = ringWidth;
      ctx.strokeStyle = ringColor;
      ctx.stroke();
    }
    ctx.font = emojiFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(GROUP_EMOJI[getUnitGroupType(unit.type)] ?? "❓", x, y);
    drawFacingIndicator(ctx, x, y, unit.facing);
    if (unit.isRulerUnit) {
      ctx.font = crownFont;
      ctx.fillText("👑", x - UNIT_DISC_RADIUS * 0.7, y - UNIT_DISC_RADIUS * 0.7);
    }
  };

  return { drawUnit };
};

export {
  HEX_HEIGHT,
  HEX_SIZE,
  GRID_STROKE_PX,
  HOVER_STROKE_PX,
  SELECTED_STROKE_PX,
  UNIT_DISC_RADIUS,
  VERTEX_OFFSET,
  GROUP_EMOJI,
  unitRingWidth,
  createUnitPainter,
};
