import { ARENA_HEIGHT, ARENA_WIDTH, BOARD_RADIUS, axialToPixel, boardTiles, hexCorners } from "../../domain/arena/hex";
import { PALETTE, TEAM_PALETTE, healthColor } from "./palette";
import { archetypeOf } from "../../domain/battle/archetypes";
import { drawGlyph } from "./glyphs";
import { zoneAt } from "../../domain/arena/arena";
import type { TFighter, TRosterUnit, TSimulation, TTeam } from "../../domain/battle/types";
import type { TArchetypeId } from "../../domain/battle/archetypes";
import type { TPhase } from "../../store/store";

/** Seconds a corpse stays on the sand before it fades out. */
const DEATH_FADE = 1.6;

type TTile = {
  x: number;
  y: number;
  ring: number;
  path: Path2D;
};

/** The grid is decoration only, so it is built once and never touched again. */
const TILES: TTile[] = boardTiles().map((tile) => {
  const center = axialToPixel(tile.q, tile.r);
  const corners = hexCorners(center);
  const path = new Path2D();

  corners.forEach((corner, index) => {
    if (index === 0) {
      path.moveTo(corner.x, corner.y);

      return;
    }

    path.lineTo(corner.x, corner.y);
  });
  path.closePath();

  return {
    x: center.x,
    y: center.y,
    ring: (Math.abs(tile.q) + Math.abs(tile.r) + Math.abs(tile.q + tile.r)) / 2,
    path,
  };
});

type TRenderUnit = {
  id: string;
  team: TTeam;
  archetypeId: TArchetypeId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  deathAge: number;
  swing: number;
  facing: number;
  hitFlash: number;
  healFlash: number;
};

type TDrawParams = {
  phase: TPhase;
  playerUnits: readonly TRosterUnit[];
  enemyUnits: readonly TRosterUnit[];
  sim: TSimulation | null;
  selectedId: string | null;
  hoveredId: string | null;
  draggingId: string | null;
  dragValid: boolean;
  /** Wall-clock seconds, used only for idle motion. */
  clock: number;
};

const fromFighter = (fighter: TFighter): TRenderUnit => ({ ...fighter });

const fromRoster = (unit: TRosterUnit): TRenderUnit => {
  const archetype = archetypeOf(unit.archetypeId);

  return {
    id: unit.id,
    team: unit.team,
    archetypeId: unit.archetypeId,
    x: unit.x,
    y: unit.y,
    hp: archetype.maxHp,
    maxHp: archetype.maxHp,
    dead: false,
    deathAge: 0,
    swing: 0,
    facing: unit.team === "player" ? -Math.PI / 2 : Math.PI / 2,
    hitFlash: 0,
    healFlash: 0,
  };
};

const drawBackdrop = (ctx: CanvasRenderingContext2D): void => {
  const gradient = ctx.createRadialGradient(
    ARENA_WIDTH / 2,
    ARENA_HEIGHT / 2,
    ARENA_HEIGHT * 0.1,
    ARENA_WIDTH / 2,
    ARENA_HEIGHT / 2,
    ARENA_HEIGHT * 0.78
  );
  gradient.addColorStop(0, PALETTE.backdropInner);
  gradient.addColorStop(1, PALETTE.backdropOuter);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
};

const drawBoard = (ctx: CanvasRenderingContext2D, phase: TPhase): void => {
  const showZones = phase === "prep";

  for (const tile of TILES) {
    if (showZones) {
      const zone = zoneAt(tile.y);
      ctx.fillStyle = zone === null ? PALETTE.neutralBand : TEAM_PALETTE[zone].zone;
      ctx.fill(tile.path);
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = tile.ring === BOARD_RADIUS ? PALETTE.boardEdge : PALETTE.boardLine;
    ctx.stroke(tile.path);
  }
};

const drawHealthBar = (ctx: CanvasRenderingContext2D, unit: TRenderUnit, radius: number, phase: TPhase): void => {
  const share = Math.max(0, unit.hp / unit.maxHp);

  // While placing units nobody is hurt, so the bars would be pure clutter.
  if (phase === "prep" && share >= 1) {
    return;
  }

  const width = Math.max(28, radius * 2.4);
  const left = unit.x - width / 2;
  const top = unit.y - radius - 13;

  ctx.fillStyle = PALETTE.hpBack;
  ctx.fillRect(left - 1, top - 1, width + 2, 6);
  ctx.fillStyle = healthColor(share);
  ctx.fillRect(left, top, width * share, 4);
};

const drawUnit = (ctx: CanvasRenderingContext2D, unit: TRenderUnit, params: TDrawParams): void => {
  const archetype = archetypeOf(unit.archetypeId);
  const team = TEAM_PALETTE[unit.team];
  const radius = archetype.radius;

  let alpha = 1;
  if (unit.dead) {
    alpha = Math.max(0, 1 - unit.deathAge / DEATH_FADE);
    if (alpha <= 0) {
      return;
    }
  }

  const idle = params.phase === "prep" ? Math.sin(params.clock * 2 + unit.x * 0.05) * 1.4 : 0;
  const lunge = unit.swing * 5;
  const x = unit.x + Math.cos(unit.facing) * lunge;
  const y = unit.y + Math.sin(unit.facing) * lunge + idle;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(unit.x, unit.y + radius * 0.72, radius * 0.95, radius * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  if (unit.dead) {
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = team.bodyDark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(unit.x - radius * 0.7, unit.y - radius * 0.7);
    ctx.lineTo(unit.x + radius * 0.7, unit.y + radius * 0.7);
    ctx.moveTo(unit.x + radius * 0.7, unit.y - radius * 0.7);
    ctx.lineTo(unit.x - radius * 0.7, unit.y + radius * 0.7);
    ctx.stroke();
    ctx.restore();

    return;
  }

  if (params.selectedId === unit.id && params.phase === "prep") {
    ctx.strokeStyle = PALETTE.selection;
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(unit.x, unit.y, archetype.range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (params.draggingId === unit.id && !params.dragValid) {
    ctx.strokeStyle = PALETTE.invalid;
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(x, y, radius + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (params.hoveredId === unit.id || params.selectedId === unit.id) {
    ctx.strokeStyle = params.selectedId === unit.id ? PALETTE.selection : PALETTE.hover;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const body = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.45, radius * 0.15, x, y, radius);
  body.addColorStop(0, team.body);
  body.addColorStop(1, team.bodyDark);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = params.draggingId === unit.id && !params.dragValid ? PALETTE.invalid : team.ring;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (unit.hitFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${(unit.hitFlash * 0.45).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (unit.healFlash > 0) {
    ctx.strokeStyle = PALETTE.heal;
    ctx.globalAlpha = alpha * unit.healFlash;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  ctx.save();
  ctx.translate(x, y);
  drawGlyph(ctx, archetype.glyph, radius * 0.55, team.glyph);
  ctx.restore();

  drawHealthBar(ctx, unit, radius, params.phase);
  ctx.restore();
};

const drawProjectiles = (ctx: CanvasRenderingContext2D, sim: TSimulation): void => {
  for (const projectile of sim.projectiles) {
    ctx.save();
    ctx.translate(projectile.x, projectile.y);

    if (projectile.kind === "mote") {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 7);
      glow.addColorStop(0, PALETTE.heal);
      glow.addColorStop(1, "rgba(143, 240, 181, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      continue;
    }

    ctx.rotate(projectile.angle);
    ctx.strokeStyle = TEAM_PALETTE[projectile.team].shot;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(6, 0);
    ctx.moveTo(6, 0);
    ctx.lineTo(1, -3);
    ctx.moveTo(6, 0);
    ctx.lineTo(1, 3);
    ctx.stroke();
    ctx.restore();
  }
};

const drawFloaters = (ctx: CanvasRenderingContext2D, sim: TSimulation): void => {
  ctx.textAlign = "center";
  ctx.font = "700 12px system-ui, sans-serif";

  for (const floater of sim.floaters) {
    const life = Math.max(0, 1 - floater.age / floater.life);
    ctx.globalAlpha = life;
    ctx.fillStyle = floater.tone === "heal" ? PALETTE.healText : PALETTE.damageText;
    ctx.fillText(floater.text, floater.x, floater.y);
  }

  ctx.globalAlpha = 1;
};

const collectUnits = (params: TDrawParams): TRenderUnit[] => {
  if (params.sim) {
    return params.sim.fighters.map(fromFighter);
  }

  return [...params.playerUnits, ...params.enemyUnits].map(fromRoster);
};

const drawArena = (ctx: CanvasRenderingContext2D, params: TDrawParams): void => {
  drawBackdrop(ctx);
  drawBoard(ctx, params.phase);

  const units = collectUnits(params);
  units.sort((left, right) => {
    if (left.dead !== right.dead) {
      return left.dead ? -1 : 1;
    }

    return left.y - right.y;
  });

  for (const unit of units) {
    drawUnit(ctx, unit, params);
  }

  if (params.sim) {
    drawProjectiles(ctx, params.sim);
    drawFloaters(ctx, params.sim);
  }
};

export type { TDrawParams };
export { drawArena };
