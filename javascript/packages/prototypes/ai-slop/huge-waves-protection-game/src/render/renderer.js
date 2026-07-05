// Рендер: ТОЛЬКО читает state, никогда не мутирует.
// Рисует фоновый грид большого мира (смещается с камерой) и игрока.

import { cameraOrigin, worldToScreen } from './camera.js';

const BG_COLOR = '#0e1116';
const GRID_COLOR = '#1b2230';
const GRID_STEP = 64; // размер клетки в мировых пикселях
const WORLD_EDGE_COLOR = '#3a4a63';
const PLAYER_COLOR = '#4fd1ff';
const PLAYER_OUTLINE = '#0b2a3a';
const ENEMY_OUTLINE = '#140a0a';
const PROJECTILE_COLOR = '#fff2a8';
const PROJECTILE_OUTLINE = '#c79a2e';
const GEM_COLOR = '#38e0c8';
const GEM_OUTLINE = '#0c5a52';

/**
 * Отрисовать текущее состояние.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 */
export function render(ctx, state) {
  const { width, height } = state.viewport;

  // Очистка + заливка фона (в CSS-пикселях, трансформ dpr уже применён в main).
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, state);
  drawWorldBounds(ctx, state);
  drawPickups(ctx, state);
  drawEnemies(ctx, state);
  drawProjectiles(ctx, state);
  drawPlayer(ctx, state);
}

/** Снаряды как маленькие круги в мировых координатах; culling вне экрана. */
function drawProjectiles(ctx, state) {
  const { width, height } = state.viewport;
  const margin = 32;
  const projectiles = state.projectiles;

  ctx.fillStyle = PROJECTILE_COLOR;
  ctx.strokeStyle = PROJECTILE_OUTLINE;
  ctx.lineWidth = 1;

  for (let i = 0; i < projectiles.length; i++) {
    const pr = projectiles[i];
    const s = worldToScreen(state, pr.x, pr.y);
    if (
      s.x < -margin ||
      s.x > width + margin ||
      s.y < -margin ||
      s.y > height + margin
    ) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, pr.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** XP-гемы как маленькие ромбы в мировых координатах; culling вне экрана. */
function drawPickups(ctx, state) {
  const { width, height } = state.viewport;
  const margin = 32;
  const gems = state.pickups;

  ctx.fillStyle = GEM_COLOR;
  ctx.strokeStyle = GEM_OUTLINE;
  ctx.lineWidth = 1;

  for (let i = 0; i < gems.length; i++) {
    const g = gems[i];
    const s = worldToScreen(state, g.x, g.y);
    if (
      s.x < -margin ||
      s.x > width + margin ||
      s.y < -margin ||
      s.y > height + margin
    ) {
      continue;
    }
    const r = g.radius;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r, s.y);
    ctx.lineTo(s.x, s.y + r);
    ctx.lineTo(s.x - r, s.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** Враги как круги в мировых координатах; цвет/размер зависят от типа. */
function drawEnemies(ctx, state) {
  const { width, height } = state.viewport;
  const margin = 48; // culling: не рисуем далеко за краями экрана
  const enemies = state.enemies;

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const s = worldToScreen(state, e.x, e.y);
    // Пропускаем врагов вне видимой области (спавнятся за кадром).
    if (
      s.x < -margin ||
      s.x > width + margin ||
      s.y < -margin ||
      s.y > height + margin
    ) {
      continue;
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, e.radius, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ENEMY_OUTLINE;
    ctx.stroke();
  }
}

/** Грид большого мира: вертикальные/горизонтальные линии со сдвигом по камере. */
function drawGrid(ctx, state) {
  const { width, height } = state.viewport;
  const origin = cameraOrigin(state); // левый-верхний угол обзора в мире

  // Смещение первой линии: -(origin mod step), чтобы грид «ехал» вместе с миром.
  const offsetX = -(((origin.x % GRID_STEP) + GRID_STEP) % GRID_STEP);
  const offsetY = -(((origin.y % GRID_STEP) + GRID_STEP) % GRID_STEP);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = offsetX; x <= width; x += GRID_STEP) {
    const px = Math.round(x) + 0.5; // резкая линия в 1px
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
  }
  for (let y = offsetY; y <= height; y += GRID_STEP) {
    const py = Math.round(y) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
  }
  ctx.stroke();
}

/** Границы мира — рамка, видимая когда игрок приближается к краю. */
function drawWorldBounds(ctx, state) {
  const tl = worldToScreen(state, 0, 0);
  const br = worldToScreen(state, state.world.width, state.world.height);
  ctx.strokeStyle = WORLD_EDGE_COLOR;
  ctx.lineWidth = 3;
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

/** Игрок как круг в экранных координатах (обычно центр экрана). */
function drawPlayer(ctx, state) {
  const p = state.player;
  if (!p) return;
  const s = worldToScreen(state, p.x, p.y);

  ctx.beginPath();
  ctx.arc(s.x, s.y, p.radius, 0, Math.PI * 2);
  ctx.fillStyle = PLAYER_COLOR;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PLAYER_OUTLINE;
  ctx.stroke();
}
