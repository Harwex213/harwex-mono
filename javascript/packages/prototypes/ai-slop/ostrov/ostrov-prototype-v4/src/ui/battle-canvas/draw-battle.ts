import {
  BATTLE_HEX_SIZE_PX,
  BATTLE_WORLD_H,
  BATTLE_WORLD_W,
  BIOMES,
  hexCorners,
  islandHexCentres,
} from "../../core/exports";
import { PALETTE } from "../palette";
import type { TBattleIsland, TBattleState, TUnit } from "../../core/exports";

/**
 * Everything the clearing level paints (plan §3.8). The camera is not a data
 * structure here: the level is a fixed 1600x1200 world and the view is the
 * player island centred in the viewport, clamped to the world edges.
 *
 * The hex look follows `src/ui/island-canvas/draw-island.ts` — biome colours
 * from `BIOMES`, a dark edge, a glowing rim around the footprint — only smaller,
 * because several islands share one screen.
 */

type TViewport = {
  readonly width: number;
  readonly height: number;
};

type TDrawBattleInput = {
  readonly battle: TBattleState;
  readonly viewport: TViewport;
  readonly nowMs: number;
};

/** Where the world sits on screen: subtract this from a world point. */
type TCameraOffset = {
  readonly x: number;
  readonly y: number;
};

const GRID_STEP_PX = 100;
const GRID_COLOUR = "rgba(80, 130, 190, 0.12)";
const GRID_WIDTH_PX = 1;

const WORLD_EDGE_COLOUR = "rgba(120, 170, 230, 0.35)";
const WORLD_EDGE_WIDTH_PX = 2;

const HEX_EDGE_COLOUR = "rgba(6, 14, 26, 0.55)";
const HEX_EDGE_WIDTH_PX = 1;
const HEX_GRADIENT_SKEW = 0.6;

const PLAYER_RIM_COLOUR = "#5ec26a";
const ENEMY_RIM_COLOUR = "#ff6b5e";
const RIM_WIDTH_PX = 2.5;
const RIM_GLOW_PX = 14;
const ABSORBED_ALPHA = 0.28;

const UNIT_RADIUS_PX = 5;
const UNIT_AIR_RADIUS_PX = 4;
const UNIT_RING_WIDTH_PX = 1.5;
const UNIT_EDGE_COLOUR = "rgba(4, 10, 20, 0.85)";
const UNIT_AIR_RING_COLOUR = "rgba(233, 241, 249, 0.85)";
const PLAYER_UNIT_COLOUR = "#7ce08a";
const ENEMY_UNIT_COLOUR = "#ff7a6d";

const HP_BAR_WIDTH_PX = 14;
const HP_BAR_HEIGHT_PX = 2.5;
const HP_BAR_OFFSET_PX = 10;
const HP_BAR_BACK_COLOUR = "rgba(4, 10, 20, 0.75)";

/** A slow breath on the player rim, so the own island reads at a glance. */
const RIM_PULSE_PERIOD_MS = 1800;
const RIM_PULSE_MIN_ALPHA = 0.7;
const RIM_PULSE_SPAN_ALPHA = 0.3;

const FULL_TURN_RAD = Math.PI * 2;
const HALF = 2;

const clamp = (value: number, min: number, max: number): number => {
  if (min > max) {
    return (min + max) / HALF;
  }

  return Math.max(min, Math.min(max, value));
};

/**
 * The player island sits in the middle of the viewport. The camera centre is
 * clamped into the world rect, which keeps the level on screen without pinning
 * the view to a world edge: the world is only 1600x1200, so an edge-hugging
 * clamp would stop the camera following the island at all on a wide screen.
 */
const battleCameraOffset = (battle: TBattleState, viewport: TViewport): TCameraOffset => {
  const centreX = clamp(battle.playerIsland.x, 0, BATTLE_WORLD_W);
  const centreY = clamp(battle.playerIsland.y, 0, BATTLE_WORLD_H);

  return { x: centreX - viewport.width / HALF, y: centreY - viewport.height / HALF };
};

const paintBackground = (ctx: CanvasRenderingContext2D, viewport: TViewport): void => {
  const gradient = ctx.createLinearGradient(0, 0, 0, viewport.height);
  gradient.addColorStop(0, PALETTE.bg);
  gradient.addColorStop(1, PALETTE.bgDeep);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
};

const paintGrid = (ctx: CanvasRenderingContext2D): void => {
  ctx.strokeStyle = GRID_COLOUR;
  ctx.lineWidth = GRID_WIDTH_PX;
  ctx.beginPath();
  for (let x = 0; x <= BATTLE_WORLD_W; x += GRID_STEP_PX) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, BATTLE_WORLD_H);
  }
  for (let y = 0; y <= BATTLE_WORLD_H; y += GRID_STEP_PX) {
    ctx.moveTo(0, y);
    ctx.lineTo(BATTLE_WORLD_W, y);
  }
  ctx.stroke();

  ctx.strokeStyle = WORLD_EDGE_COLOUR;
  ctx.lineWidth = WORLD_EDGE_WIDTH_PX;
  ctx.strokeRect(0, 0, BATTLE_WORLD_W, BATTLE_WORLD_H);
};

const tracePath = (ctx: CanvasRenderingContext2D, centreX: number, centreY: number): void => {
  const corners = hexCorners(centreX, centreY, BATTLE_HEX_SIZE_PX);
  ctx.beginPath();
  corners.forEach((corner, index) => {
    if (index === 0) {
      ctx.moveTo(corner.x, corner.y);

      return;
    }
    ctx.lineTo(corner.x, corner.y);
  });
  ctx.closePath();
};

const paintIsland = (
  ctx: CanvasRenderingContext2D,
  island: TBattleIsland,
  rimColour: string,
  rimAlpha: number,
): void => {
  const centres = islandHexCentres(island);

  ctx.save();
  if (island.absorbed === true) {
    ctx.globalAlpha = ABSORBED_ALPHA;
  }

  island.hexes.forEach((hex, index) => {
    const centre = centres[index];
    if (centre === undefined) {
      return;
    }

    const info = BIOMES[hex.biome];
    const gradient = ctx.createLinearGradient(
      centre.x - BATTLE_HEX_SIZE_PX,
      centre.y - BATTLE_HEX_SIZE_PX,
      centre.x + BATTLE_HEX_SIZE_PX * HEX_GRADIENT_SKEW,
      centre.y + BATTLE_HEX_SIZE_PX,
    );
    gradient.addColorStop(0, info.colours[0]);
    gradient.addColorStop(1, info.colours[1]);

    tracePath(ctx, centre.x, centre.y);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = HEX_EDGE_COLOUR;
    ctx.lineWidth = HEX_EDGE_WIDTH_PX;
    ctx.stroke();
  });

  ctx.globalAlpha = island.absorbed === true ? ABSORBED_ALPHA : rimAlpha;
  ctx.strokeStyle = rimColour;
  ctx.lineWidth = RIM_WIDTH_PX;
  ctx.shadowColor = rimColour;
  ctx.shadowBlur = RIM_GLOW_PX;
  for (const centre of centres) {
    tracePath(ctx, centre.x, centre.y);
    ctx.stroke();
  }
  ctx.restore();
};

const paintUnit = (ctx: CanvasRenderingContext2D, unit: TUnit): void => {
  const radius = unit.air === true ? UNIT_AIR_RADIUS_PX : UNIT_RADIUS_PX;
  const colour = unit.side === "player" ? PLAYER_UNIT_COLOUR : ENEMY_UNIT_COLOUR;

  ctx.beginPath();
  ctx.arc(unit.x, unit.y, radius, 0, FULL_TURN_RAD);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.lineWidth = UNIT_RING_WIDTH_PX;
  ctx.strokeStyle = unit.air === true ? UNIT_AIR_RING_COLOUR : UNIT_EDGE_COLOUR;
  ctx.stroke();

  const ratio = unit.maxHp <= 0 ? 0 : Math.max(0, Math.min(1, unit.hp / unit.maxHp));
  const barX = unit.x - HP_BAR_WIDTH_PX / HALF;
  const barY = unit.y - HP_BAR_OFFSET_PX;
  ctx.fillStyle = HP_BAR_BACK_COLOUR;
  ctx.fillRect(barX, barY, HP_BAR_WIDTH_PX, HP_BAR_HEIGHT_PX);
  ctx.fillStyle = colour;
  ctx.fillRect(barX, barY, HP_BAR_WIDTH_PX * ratio, HP_BAR_HEIGHT_PX);
};

const drawBattle = (ctx: CanvasRenderingContext2D, input: TDrawBattleInput): void => {
  const { battle, viewport, nowMs } = input;

  paintBackground(ctx, viewport);

  const offset = battleCameraOffset(battle, viewport);
  ctx.save();
  ctx.translate(-offset.x, -offset.y);

  paintGrid(ctx);

  for (const island of battle.enemyIslands) {
    paintIsland(ctx, island, ENEMY_RIM_COLOUR, 1);
  }

  const pulse = (Math.sin((nowMs / RIM_PULSE_PERIOD_MS) * FULL_TURN_RAD) + 1) / HALF;
  paintIsland(
    ctx,
    battle.playerIsland,
    PLAYER_RIM_COLOUR,
    RIM_PULSE_MIN_ALPHA + pulse * RIM_PULSE_SPAN_ALPHA,
  );

  for (const unit of battle.units) {
    paintUnit(ctx, unit);
  }

  ctx.restore();
};

export type { TCameraOffset, TDrawBattleInput, TViewport };

export { battleCameraOffset, drawBattle };
