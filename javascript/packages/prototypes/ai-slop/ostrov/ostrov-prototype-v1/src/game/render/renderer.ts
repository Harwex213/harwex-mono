import {
  ACTOR_BY_ID,
  BUILDING_BY_ID,
  CELL,
  OCEAN,
  SECTOR_CELLS,
  SECTOR_COLS,
  SECTOR_ROWS,
  SECTOR_SIZE,
  SKILL_BY_ID,
  WORLD_CELLS_X,
  WORLD_H,
  WORLD_W,
} from "../config";
import type { MapMode } from "../hud";
import type { Sector } from "../types";
import type { World } from "../world";
import type { Camera } from "./camera";
import { landLayer, MARGIN } from "./land";
import { PALETTE } from "./palette";
import { drawActor, drawBuilding } from "./sprites";

type Pointer = {
  worldX: number;
  worldY: number;
  cx: number;
  cy: number;
  over: boolean;
};

class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  /** Matches the backing store to the CSS box; returns the CSS-pixel size. */
  resize(): { width: number; height: number } {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    this.width = width;
    this.height = height;
    return { width, height };
  }

  draw(world: World, camera: Camera, pointer: Pointer, mode: MapMode, buildValid: boolean, selected: number | null): void {
    const { width, height } = this.resize();
    const ctx = this.ctx;
    const dpr = this.canvas.width / Math.max(1, width);
    const time = world.time;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.ocean(ctx, time);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    this.waves(ctx, time);
    const land = landLayer(world);
    ctx.drawImage(land.canvas, -MARGIN, -MARGIN);
    this.foam(ctx, world, time);

    if (mode.kind === "build") {
      this.buildGrid(ctx, world);
    }
    this.sectorMarkers(ctx, world, pointer, selected, time);

    const buildings = [...world.buildings].sort((a, b) => a.y - b.y);
    for (const building of buildings) {
      if (building.dead) {
        continue;
      }
      drawBuilding(ctx, building, BUILDING_BY_ID.get(building.defId)!, time);
    }

    const actors = [...world.actors].sort((a, b) => a.y - b.y);
    for (const actor of actors) {
      if (actor.dead) {
        continue;
      }
      drawActor(ctx, actor, ACTOR_BY_ID.get(actor.defId)!, time);
    }

    this.projectiles(ctx, world);
    this.effects(ctx, world);
    this.rally(ctx, world, time);
    this.pointerOverlay(ctx, pointer, mode, buildValid);

    ctx.restore();
    this.vignette(ctx, width, height);
  }

  private ocean(ctx: CanvasRenderingContext2D, time: number): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, PALETTE.oceanDeep);
    gradient.addColorStop(0.55, PALETTE.oceanMid);
    gradient.addColorStop(1, PALETTE.oceanDeep);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    // A slow shimmer that does not depend on the camera, so panning stays calm.
    ctx.globalAlpha = 0.06 + Math.sin(time * 0.5) * 0.02;
    ctx.fillStyle = PALETTE.oceanShallow;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
  }

  private waves(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.strokeStyle = "rgba(140, 200, 235, 0.12)";
    ctx.lineWidth = 2;
    const top = -OCEAN;
    const bottom = WORLD_H + OCEAN;
    const left = -OCEAN;
    const right = WORLD_W + OCEAN;
    for (let y = top; y < bottom; y += 56) {
      ctx.beginPath();
      for (let x = left; x <= right; x += 64) {
        const offset = Math.sin(x * 0.008 + y * 0.02 + time * 0.9) * 7;
        if (x === left) {
          ctx.moveTo(x, y + offset);
        } else {
          ctx.lineTo(x, y + offset);
        }
      }
      ctx.stroke();
    }
  }

  private foam(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    ctx.strokeStyle = PALETTE.foam;
    ctx.lineWidth = 3;
    const pulse = 4 + Math.sin(time * 1.6) * 3;
    for (const sector of world.sectors) {
      if (sector.state === "locked") {
        continue;
      }
      const x = sector.col * SECTOR_SIZE;
      const y = sector.row * SECTOR_SIZE;
      ctx.globalAlpha = sector.state === "owned" ? 0.6 : 0.25 + sector.attach * 0.35;
      ctx.strokeRect(x - 16 - pulse, y - 16 - pulse, SECTOR_SIZE + 32 + pulse * 2, SECTOR_SIZE + 32 + pulse * 2);
    }
    ctx.globalAlpha = 1;
  }

  private buildGrid(ctx: CanvasRenderingContext2D, world: World): void {
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    for (const sector of world.sectors) {
      if (sector.state !== "owned") {
        continue;
      }
      const x = sector.col * SECTOR_SIZE;
      const y = sector.row * SECTOR_SIZE;
      ctx.beginPath();
      for (let i = 0; i <= SECTOR_CELLS; i += 1) {
        ctx.moveTo(x + i * CELL, y);
        ctx.lineTo(x + i * CELL, y + SECTOR_SIZE);
        ctx.moveTo(x, y + i * CELL);
        ctx.lineTo(x + SECTOR_SIZE, y + i * CELL);
      }
      ctx.stroke();
      // Cells that rocks or trees already occupy.
      ctx.fillStyle = "rgba(255, 90, 90, 0.16)";
      for (const cell of sector.blocked) {
        const cx = cell % WORLD_CELLS_X;
        const cy = Math.floor(cell / WORLD_CELLS_X);
        ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
      }
    }
  }

  private sectorMarkers(
    ctx: CanvasRenderingContext2D,
    world: World,
    pointer: Pointer,
    selected: number | null,
    time: number,
  ): void {
    for (const sector of world.sectors) {
      const x = sector.col * SECTOR_SIZE;
      const y = sector.row * SECTOR_SIZE;
      const hovered = pointer.over && sectorOf(pointer) === sector.index;
      if (hovered || selected === sector.index) {
        ctx.strokeStyle = selected === sector.index ? PALETTE.gold : "rgba(255, 255, 255, 0.45)";
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 3, y + 3, SECTOR_SIZE - 6, SECTOR_SIZE - 6);
      }
      if (sector.state === "contested") {
        this.contestedLabel(ctx, world, sector, time);
      }
      if (sector.terrain === "boss" && world.bossAlive) {
        ctx.fillStyle = "rgba(199, 155, 255, 0.85)";
        ctx.font = "700 22px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("ЛОГОВО ЛЕВИАФАНА", x + SECTOR_SIZE / 2, y + 34);
      }
    }
  }

  private contestedLabel(ctx: CanvasRenderingContext2D, world: World, sector: Sector, time: number): void {
    const x = sector.col * SECTOR_SIZE + SECTOR_SIZE / 2;
    const y = sector.row * SECTOR_SIZE + 32;
    const guards = world.expansion?.guards ?? 0;
    ctx.textAlign = "center";
    ctx.font = "700 20px system-ui, sans-serif";
    if (guards > 0) {
      ctx.fillStyle = "#ff9b9b";
      ctx.fillText(`Стражей: ${guards}`, x, y);
      return;
    }
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(`Остров идёт: ${Math.round(sector.attach * 100)}%`, x, y);
    ctx.globalAlpha = 0.25 + Math.sin(time * 4) * 0.15;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(sector.col * SECTOR_SIZE, sector.row * SECTOR_SIZE, SECTOR_SIZE * sector.attach, 6);
    ctx.globalAlpha = 1;
  }

  private projectiles(ctx: CanvasRenderingContext2D, world: World): void {
    for (const shot of world.projectiles) {
      const angle = Math.atan2(shot.ty - shot.y, shot.tx - shot.x);
      ctx.save();
      ctx.translate(shot.x, shot.y);
      ctx.rotate(angle);
      if (shot.kind === "spell") {
        ctx.fillStyle = "#c79bff";
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
      } else if (shot.kind === "bolt") {
        ctx.fillStyle = "#9fd8ff";
        ctx.fillRect(-7, -1.5, 14, 3);
      } else {
        ctx.fillStyle = shot.team === "island" ? "#f4e3b8" : "#ffb0b8";
        ctx.fillRect(-9, -1, 18, 2);
      }
      ctx.restore();
    }
  }

  private effects(ctx: CanvasRenderingContext2D, world: World): void {
    for (const effect of world.effects) {
      const t = 1 - effect.life / effect.maxLife;
      ctx.globalAlpha = 1 - t;
      if (effect.kind === "blast") {
        ctx.fillStyle = effect.color;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * (0.4 + t * 0.9), 0, Math.PI * 2);
        ctx.fill();
      } else if (effect.kind === "ring") {
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * (0.3 + t * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.kind === "spark") {
        ctx.fillStyle = effect.color;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = effect.color;
        ctx.font = "700 16px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(effect.text ?? "", effect.x, effect.y - 12 - t * 24);
      }
    }
    ctx.globalAlpha = 1;
  }

  private rally(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const { x, y } = world.rally;
    ctx.strokeStyle = world.assault ? PALETTE.bad : PALETTE.island;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5 + Math.sin(time * 3) * 0.25;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = world.assault ? PALETTE.bad : PALETTE.island;
    ctx.fillRect(x - 1, y - 30, 2, 30);
    ctx.beginPath();
    ctx.moveTo(x + 1, y - 30);
    ctx.lineTo(x + 18, y - 24);
    ctx.lineTo(x + 1, y - 18);
    ctx.closePath();
    ctx.fill();
  }

  private pointerOverlay(ctx: CanvasRenderingContext2D, pointer: Pointer, mode: MapMode, valid: boolean): void {
    if (!pointer.over) {
      return;
    }
    if (mode.kind === "build") {
      const def = BUILDING_BY_ID.get(mode.id)!;
      const size = def.cells * CELL;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = valid ? "#7ce0a8" : "#ff6b57";
      ctx.fillRect(pointer.cx * CELL, pointer.cy * CELL, size, size);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = valid ? "#7ce0a8" : "#ff6b57";
      ctx.lineWidth = 2;
      ctx.strokeRect(pointer.cx * CELL, pointer.cy * CELL, size, size);
      if (def.weapon) {
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(pointer.cx * CELL + size / 2, pointer.cy * CELL + size / 2, def.weapon.range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      return;
    }
    if (mode.kind === "skill") {
      const def = SKILL_BY_ID.get(mode.id)!;
      if (!def.targeted) {
        return;
      }
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(pointer.worldX, pointer.worldY, def.radius ?? 100, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private vignette(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const gradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.35,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.75,
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.45)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

function sectorOf(pointer: Pointer): number | null {
  const col = Math.floor(pointer.cx / SECTOR_CELLS);
  const row = Math.floor(pointer.cy / SECTOR_CELLS);
  if (col < 0 || row < 0 || col >= SECTOR_COLS || row >= SECTOR_ROWS) {
    return null;
  }
  return row * SECTOR_COLS + col;
}

export type { Pointer };
export { Renderer, sectorOf };
