import { CELL } from "../config";
import type { Actor, ActorDef, Building, BuildingDef } from "../types";
import { PALETTE } from "./palette";

const BUILDING_COLORS: Record<string, { base: string; shade: string; accent: string }> = {
  core: { base: "#dfe9f2", shade: "#9fb1c4", accent: "#8fd8ff" },
  house: { base: "#c9a978", shade: "#9a7d52", accent: "#e2c795" },
  sawmill: { base: "#a8794c", shade: "#7d5836", accent: "#d9c08a" },
  market: { base: "#d8c08d", shade: "#a38b5f", accent: "#e46f6f" },
  mine: { base: "#8091a6", shade: "#5d6c7e", accent: "#9fd8ff" },
  barracks: { base: "#9a6f64", shade: "#6f4d45", accent: "#ffd479" },
  range: { base: "#8f9a72", shade: "#6a7353", accent: "#e8e2c0" },
  forge: { base: "#7c7069", shade: "#574e49", accent: "#ff9455" },
  tower: { base: "#b9bfc7", shade: "#858c95", accent: "#8fd8ff" },
  engine: { base: "#7f8b93", shade: "#5a646b", accent: "#7ce0a8" },
  altar: { base: "#b9a9c9", shade: "#8b7c9c", accent: "#c79bff" },
  obelisk: { base: "#7f9ab5", shade: "#5b7186", accent: "#9fd8ff" },
};

function drawBuilding(ctx: CanvasRenderingContext2D, building: Building, def: BuildingDef, time: number): void {
  const size = def.cells * CELL;
  const half = size / 2;
  const colors = BUILDING_COLORS[def.id] ?? BUILDING_COLORS.house;

  ctx.save();
  ctx.translate(building.x, building.y);

  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.beginPath();
  ctx.ellipse(2, half * 0.55, half * 0.95, half * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (building.build < 1) {
    ctx.globalAlpha = 0.4 + building.build * 0.4;
  }

  plate(ctx, size, colors.base, colors.shade);
  ornament(ctx, def.id, size, colors.accent, time);

  ctx.globalAlpha = 1;

  if (building.build < 1) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(-half, -half, size, size);
    ctx.setLineDash([]);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, half * 0.7, -Math.PI / 2, -Math.PI / 2 + building.build * Math.PI * 2);
    ctx.stroke();
  }

  if (building.hitFlash > 0) {
    ctx.globalAlpha = building.hitFlash * 3;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-half, -half, size, size);
    ctx.globalAlpha = 1;
  }

  if (building.hp < building.maxHp) {
    bar(ctx, -half, -half - 9, size, building.hp / building.maxHp, PALETTE.good);
  }
  ctx.restore();
}

function plate(ctx: CanvasRenderingContext2D, size: number, base: string, shade: string): void {
  const half = size / 2;
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.roundRect(-half, -half + 3, size, size - 3, 5);
  ctx.fill();
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.roundRect(-half, -half, size, size - 6, 5);
  ctx.fill();
}

function ornament(ctx: CanvasRenderingContext2D, id: string, size: number, accent: string, time: number): void {
  const half = size / 2;
  ctx.fillStyle = accent;
  switch (id) {
    case "core": {
      ctx.beginPath();
      ctx.moveTo(0, -half - 12);
      ctx.lineTo(half * 0.45, -2);
      ctx.lineTo(0, half * 0.4);
      ctx.lineTo(-half * 0.45, -2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.35 + Math.sin(time * 2) * 0.15;
      ctx.beginPath();
      ctx.arc(0, -6, half * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case "house": {
      ctx.beginPath();
      ctx.moveTo(-half, -half + 4);
      ctx.lineTo(0, -half - 8);
      ctx.lineTo(half, -half + 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "sawmill": {
      ctx.beginPath();
      ctx.arc(half * 0.4, 0, half * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i += 1) {
        const angle = time * 2 + (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(half * 0.4, 0);
        ctx.lineTo(half * 0.4 + Math.cos(angle) * half * 0.42, Math.sin(angle) * half * 0.42);
        ctx.stroke();
      }
      break;
    }
    case "market": {
      for (let i = 0; i < 4; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? accent : "#f5efe0";
        ctx.fillRect(-half + (i * size) / 4, -half, size / 4, size * 0.3);
      }
      break;
    }
    case "mine": {
      ctx.fillStyle = "#3a3f47";
      ctx.beginPath();
      ctx.arc(0, half * 0.1, half * 0.5, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(0, -half * 0.5);
      ctx.lineTo(half * 0.22, 0);
      ctx.lineTo(0, half * 0.3);
      ctx.lineTo(-half * 0.22, 0);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "barracks": {
      ctx.fillStyle = "#6b4a42";
      ctx.fillRect(-half * 0.25, -half * 0.2, half * 0.5, half);
      ctx.fillStyle = accent;
      ctx.fillRect(half * 0.5, -half - 12, 3, 22);
      ctx.beginPath();
      ctx.moveTo(half * 0.5 + 3, -half - 12);
      ctx.lineTo(half * 0.5 + 18, -half - 6);
      ctx.lineTo(half * 0.5 + 3, -half);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "range": {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      for (let i = 1; i <= 3; i += 1) {
        ctx.beginPath();
        ctx.arc(0, 0, (half * 0.28 * i) / 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "forge": {
      ctx.fillStyle = "#4c4038";
      ctx.fillRect(-half * 0.6, -half - 10, half * 0.5, half * 0.7);
      ctx.globalAlpha = 0.5 + Math.sin(time * 6) * 0.3;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(half * 0.2, half * 0.1, half * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case "tower": {
      ctx.fillStyle = "#6e747c";
      for (let i = 0; i < 4; i += 1) {
        ctx.fillRect(-half + i * (size / 4) + 2, -half - 5, size / 8, 8);
      }
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.35, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "engine": {
      ctx.save();
      ctx.rotate(time * 1.4);
      ctx.fillStyle = accent;
      for (let i = 0; i < 8; i += 1) {
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-3, -half * 0.75, 6, half * 0.35);
      }
      ctx.restore();
      ctx.fillStyle = "#3d454b";
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "altar": {
      ctx.globalAlpha = 0.45 + Math.sin(time * 3) * 0.25;
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "obelisk": {
      ctx.beginPath();
      ctx.moveTo(0, -half - 16);
      ctx.lineTo(half * 0.32, half * 0.5);
      ctx.lineTo(-half * 0.32, half * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.3 + Math.sin(time * 2.5) * 0.2;
      ctx.beginPath();
      ctx.arc(0, -half * 0.4, half * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    default:
      break;
  }
}

function drawActor(ctx: CanvasRenderingContext2D, actor: Actor, def: ActorDef, time: number): void {
  const bob = Math.sin(actor.step * 0.12 + actor.id) * 1.6;
  const radius = def.radius;

  ctx.save();
  ctx.translate(actor.x, actor.y);

  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(0, radius * 0.75, radius * 0.9, radius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, bob);
  if (actor.defId === "leviathan") {
    drawLeviathan(ctx, radius, time);
  } else if (actor.team === "island") {
    drawIslandUnit(ctx, actor, def);
  } else {
    drawSeaUnit(ctx, actor, def, time);
  }

  if (actor.hitFlash > 0) {
    ctx.globalAlpha = Math.min(1, actor.hitFlash * 4);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (actor.hp < actor.maxHp) {
    const width = Math.max(20, radius * 2.4);
    bar(ctx, -width / 2, -radius - 11, width, actor.hp / actor.maxHp, actor.team === "island" ? PALETTE.good : PALETTE.bad);
  }
  ctx.restore();
}

function drawIslandUnit(ctx: CanvasRenderingContext2D, actor: Actor, def: ActorDef): void {
  const radius = def.radius;
  ctx.fillStyle = "#e7f2fb";
  ctx.strokeStyle = PALETTE.islandDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.rotate(actor.facing);
  ctx.fillStyle = PALETTE.islandDark;
  if (actor.defId === "sword") {
    ctx.fillRect(radius * 0.4, -2, radius * 1.5, 4);
  } else if (actor.defId === "archer") {
    ctx.strokeStyle = "#b98a4e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(radius * 0.5, 0, radius * 0.95, -1, 1);
    ctx.stroke();
  } else if (actor.defId === "knight") {
    ctx.fillStyle = "#9fb8cc";
    ctx.beginPath();
    ctx.roundRect(radius * 0.3, -radius * 0.8, radius * 0.7, radius * 1.6, 3);
    ctx.fill();
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(radius * 0.4, -2, radius * 1.4, 4);
  } else {
    ctx.fillStyle = "#9fd8ff";
    ctx.beginPath();
    ctx.moveTo(radius * 0.2, -radius * 0.7);
    ctx.lineTo(radius * 1.5, 0);
    ctx.lineTo(radius * 0.2, radius * 0.7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  if (actor.defId === "golem") {
    ctx.fillStyle = "rgba(159, 216, 255, 0.55)";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSeaUnit(ctx: CanvasRenderingContext2D, actor: Actor, def: ActorDef, time: number): void {
  const radius = def.radius;
  const body = actor.role === "guard" ? "#9aa7b5" : "#f0899a";
  ctx.fillStyle = body;
  ctx.strokeStyle = PALETTE.seaDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.rotate(actor.facing);
  ctx.strokeStyle = PALETTE.seaDark;
  ctx.lineWidth = 2.5;
  if (actor.defId === "crab") {
    const wave = Math.sin(time * 8 + actor.id) * 0.3;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(radius * 0.4, side * radius * 0.5);
      ctx.lineTo(radius * 1.3, side * (radius * 0.9 + wave * 4));
      ctx.stroke();
    }
  } else if (actor.defId === "harpooner") {
    ctx.fillStyle = "#5a6b78";
    ctx.fillRect(radius * 0.3, -1.5, radius * 1.8, 3);
  } else if (actor.defId === "brute" || actor.defId === "guardian") {
    ctx.fillStyle = actor.defId === "brute" ? "#8a3a4c" : "#68727d";
    ctx.beginPath();
    ctx.roundRect(radius * 0.3, -radius * 0.55, radius * 1.1, radius * 1.1, 3);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(radius * 0.3, 0);
    ctx.lineTo(radius * 1.2, 0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "rgba(20, 10, 16, 0.65)";
  ctx.beginPath();
  ctx.arc(-radius * 0.25, -radius * 0.2, 1.8, 0, Math.PI * 2);
  ctx.arc(radius * 0.25, -radius * 0.2, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawLeviathan(ctx: CanvasRenderingContext2D, radius: number, time: number): void {
  ctx.strokeStyle = "#5c3f74";
  ctx.lineWidth = 7;
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2 + Math.sin(time * 0.8 + i) * 0.25;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(
      Math.cos(angle) * radius * 1.4,
      Math.sin(angle) * radius * 1.4,
      Math.cos(angle + 0.6) * radius * 2.1,
      Math.sin(angle + 0.6) * radius * 2.1,
    );
    ctx.stroke();
  }
  ctx.fillStyle = "#3b2749";
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c79bff";
  ctx.globalAlpha = 0.6 + Math.sin(time * 3) * 0.25;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffd479";
  ctx.beginPath();
  ctx.arc(-radius * 0.35, -radius * 0.15, 3.5, 0, Math.PI * 2);
  ctx.arc(radius * 0.35, -radius * 0.15, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, ratio: number, color: string): void {
  ctx.fillStyle = "rgba(6, 14, 22, 0.75)";
  ctx.fillRect(x - 1, y - 1, width + 2, 6);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width * Math.max(0, Math.min(1, ratio)), 4);
}

export { drawActor, drawBuilding };
