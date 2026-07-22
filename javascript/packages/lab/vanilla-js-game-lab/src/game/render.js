import { CELLS, cellOf, cellToWorld, isCenter, keyOf } from "./hex.js";
import { BUILDINGS, canPlace } from "./buildings.js";
import { ENEMIES, enemyPos } from "./enemies.js";

const COLORS = {
  cell: "#1a2027",
  cellStroke: "#2a323d",
  base: "#232c25",
  ok: "rgba(88, 196, 112, 0.28)",
  bad: "rgba(224, 86, 76, 0.28)",
  sellRing: "#e8b64c",
  night: "rgba(24, 28, 64, 0.28)",
  hpBack: "#3a2226",
  hp: "#e0564c",
  baseHp: "#58c470",
  projectile: "#e8b64c",
};

/**
 * Draw the whole game to the canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../types.js").GameState} s
 * @param {{size: number, ox: number, oy: number, w: number, h: number}} view
 * @param {{q: number, r: number} | null} hover
 */
function draw(ctx, s, view, hover) {
  const { size, ox, oy, w, h } = view;
  const sx = (p) => ox + p.x * size;
  const sy = (p) => oy + p.y * size;

  ctx.clearRect(0, 0, w, h);

  for (const cell of CELLS) {
    const p = cellToWorld(cell);
    hexPath(ctx, sx(p), sy(p), size * 0.96);
    ctx.fillStyle = isCenter(cell) ? COLORS.base : COLORS.cell;
    ctx.fill();
    ctx.strokeStyle = COLORS.cellStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (s.phase === "night") {
    ctx.fillStyle = COLORS.night;
    ctx.fillRect(0, 0, w, h);
  }

  // hover highlight (placement ghost fill or sell ring)
  const hoverKey = hover && keyOf(hover);
  if (hover && s.selected && !s.gameOver) {
    const p = cellToWorld(hover);
    hexPath(ctx, sx(p), sy(p), size * 0.96);
    ctx.fillStyle = canPlace(s, hover, s.selected).ok ? COLORS.ok : COLORS.bad;
    ctx.fill();
  } else if (hover && !s.selected && s.buildings[hoverKey]) {
    const p = cellToWorld(hover);
    hexPath(ctx, sx(p), sy(p), size * 0.82);
    ctx.strokeStyle = COLORS.sellRing;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // base
  const basePos = cellToWorld({ q: 0, r: 0 });
  ctx.font = `${size * 1.1}px serif`;
  ctx.fillText("🏰", sx(basePos), sy(basePos));
  bar(ctx, sx(basePos), sy(basePos) + size * 0.72, size * 1.2, s.baseHp / s.baseMaxHp, COLORS.baseHp);

  // buildings
  ctx.font = `${size * 0.9}px serif`;
  for (const [key, b] of Object.entries(s.buildings)) {
    const p = cellToWorld(cellOf(key));
    ctx.fillText(BUILDINGS[b.type].emoji, sx(p), sy(p));
  }

  // enemies
  for (const e of s.enemies) {
    const p = enemyPos(e);
    ctx.fillText(ENEMIES[e.type].emoji, sx(p), sy(p));
    if (e.hp < e.maxHp) {
      bar(ctx, sx(p), sy(p) - size * 0.62, size, e.hp / e.maxHp, COLORS.hp);
    }
  }

  // projectiles
  ctx.fillStyle = COLORS.projectile;
  for (const p of s.projectiles) {
    ctx.beginPath();
    ctx.arc(sx(p), sy(p), size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // placement ghost emoji
  if (hover && s.selected && !s.gameOver) {
    const p = cellToWorld(hover);
    ctx.globalAlpha = 0.6;
    ctx.font = `${size * 0.9}px serif`;
    ctx.fillText(BUILDINGS[s.selected].emoji, sx(p), sy(p));
    ctx.globalAlpha = 1;
  }

  // floating popups
  ctx.font = `600 ${Math.max(12, size * 0.5)}px system-ui, sans-serif`;
  for (const fx of s.effects) {
    const lift = (1 - fx.ttl / 0.8) * size;
    ctx.globalAlpha = Math.min(1, fx.ttl / 0.4);
    ctx.fillStyle = fx.color;
    ctx.fillText(fx.text, ox + fx.x * size, oy + fx.y * size - lift);
    ctx.globalAlpha = 1;
  }
}

function hexPath(ctx, x, y, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i + 30);
    const px = x + size * Math.cos(a);
    const py = y + size * Math.sin(a);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

function bar(ctx, cx, cy, width, ratio, color) {
  const h = Math.max(3, width * 0.1);
  ctx.fillStyle = COLORS.hpBack;
  ctx.fillRect(cx - width / 2, cy, width, h);
  ctx.fillStyle = color;
  ctx.fillRect(cx - width / 2, cy, width * Math.max(0, ratio), h);
}

export { COLORS, draw };
