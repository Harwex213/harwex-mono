// Боевая система: авто-атака игрока, полёт снарядов, урон, смерть.
// Единая точка боевой логики — updateCombat(state, dt). Мутирует state; рендер только читает.
// Порядок в шаге: i-frames → авто-выстрел → движение снарядов → коллизии снаряд↔враг
// → смерть врагов (kills) → контактный урон игроку.

import { distSq, norm } from '../core/math.js';
import { createProjectile, updateProjectile } from '../entities/projectiles.js';
import { createGem } from '../entities/pickups.js';

/** Параметры боя (data-driven, без магии в коде). */
const COMBAT_CONFIG = {
  // Длительность неуязвимости игрока после получения урона, сек.
  iframeDuration: 0.6,
  // Урон, наносимый игроку при контакте с врагом (за одно срабатывание).
  contactDamage: 8,
  // Запас за границей мира, после которого снаряд удаляется (мировые пиксели).
  worldMargin: 120,
  // Угловой шаг между соседними снарядами веера (радианы), при projectileCount>1.
  spreadStep: 0.16,
};

/**
 * Единая точка боевой логики на один шаг симуляции.
 * @param {object} state
 * @param {number} dt - фиксированный шаг, сек.
 */
export function updateCombat(state, dt) {
  const player = state.player;
  if (!player) return;

  tickInvuln(player, dt);
  autoFire(state, dt);
  moveProjectiles(state, dt);
  resolveProjectileHits(state);
  reapDeadEnemies(state);
  applyContactDamage(state);
}

/** Списать таймер неуязвимости игрока. */
function tickInvuln(player, dt) {
  if (player.invulnTimer > 0) {
    player.invulnTimer = Math.max(0, player.invulnTimer - dt);
  }
}

/**
 * Найти ближайшего живого врага к игроку (через distSq, без sqrt).
 * @returns {object|null} враг или null, если врагов нет.
 */
function nearestEnemy(state) {
  const enemies = state.enemies;
  const p = state.player;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.alive === false) continue;
    const d = distSq(p, e);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/**
 * Авто-атака: накопительный таймер, при готовности стреляем в ближайшего врага.
 * Детерминированно от dt. Если врагов нет — таймер не переполняется (кап на интервале),
 * выстрел произойдёт как только появится цель.
 */
function autoFire(state, dt) {
  const player = state.player;
  const w = player.weapon;
  const interval = 1 / w.fireRate; // сек между выстрелами

  player.fireTimer += dt;

  while (player.fireTimer >= interval) {
    const target = nearestEnemy(state);
    if (!target) {
      // Готовы стрелять, но цели нет: держим таймер «заряженным», не копим бесконечно.
      player.fireTimer = interval;
      break;
    }

    const dir = norm({ x: target.x - player.x, y: target.y - player.y });
    // Вырожденный случай (враг ровно в точке игрока) — стреляем вправо.
    if (dir.x === 0 && dir.y === 0) dir.x = 1;

    // Веер из projectileCount снарядов вокруг направления на цель (способности T6).
    // Симметричный разброс: смещения центрированы относительно baseAngle. Без rng.
    const count = player.projectileCount || 1;
    const baseAngle = Math.atan2(dir.y, dir.x);
    for (let k = 0; k < count; k++) {
      const offset = (k - (count - 1) / 2) * COMBAT_CONFIG.spreadStep;
      const a = baseAngle + offset;
      state.projectiles.push(
        createProjectile(player.x, player.y, Math.cos(a), Math.sin(a), {
          speed: w.projectileSpeed,
          damage: w.damage,
          radius: w.projectileRadius,
          life: w.projectileLife,
          pierce: player.pierce || 0,
        }),
      );
    }

    player.fireTimer -= interval;
  }
}

/** Движение снарядов + отметка на удаление по времени жизни / вылету за мир. */
function moveProjectiles(state, dt) {
  const projectiles = state.projectiles;
  const { width, height } = state.world;
  const m = COMBAT_CONFIG.worldMargin;

  for (let i = 0; i < projectiles.length; i++) {
    const pr = projectiles[i];
    updateProjectile(pr, dt);
    if (
      pr.life <= 0 ||
      pr.x < -m ||
      pr.y < -m ||
      pr.x > width + m ||
      pr.y > height + m
    ) {
      pr.alive = false;
    }
  }

  // Удаляем отмеченные (нет утечки массива снарядов).
  if (projectiles.some((pr) => pr.alive === false)) {
    state.projectiles = projectiles.filter((pr) => pr.alive !== false);
  }
}

/**
 * Коллизии снаряд↔враг по сумме радиусов. Попадание наносит урон. Обычный снаряд гибнет
 * на первом враге; с пробиванием (pierce) — проходит сквозь ещё pierce врагов, не повторяя
 * попадания по уже задетым (pr.hits). Мёртвые снаряды вычищаются здесь же.
 */
function resolveProjectileHits(state) {
  const projectiles = state.projectiles;
  const enemies = state.enemies;
  let anyConsumed = false;

  for (let i = 0; i < projectiles.length; i++) {
    const pr = projectiles[i];
    if (pr.alive === false) continue;

    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (e.alive === false) continue;
      if (pr.hits && pr.hits.has(e)) continue; // уже пробит этим снарядом

      const rr = pr.radius + e.radius;
      if (distSq(pr, e) <= rr * rr) {
        e.hp -= pr.damage;
        if (e.hp <= 0) e.alive = false;

        if (pr.pierce > 0) {
          // Пробивание: снаряд живёт дальше, запоминаем задетого врага.
          pr.pierce -= 1;
          if (!pr.hits) pr.hits = new Set();
          pr.hits.add(e);
        } else {
          pr.alive = false; // снаряд расходуется
          anyConsumed = true;
          break; // без пробивания — только один враг за снаряд
        }
      }
    }
  }

  if (anyConsumed) {
    state.projectiles = projectiles.filter((pr) => pr.alive !== false);
  }
}

/**
 * Удалить мёртвых врагов (hp<=0), инкрементировать счётчик убийств и уронить
 * XP-гем в точке смерти каждого (T5: подбор/уровни обрабатывает systems/leveling).
 */
function reapDeadEnemies(state) {
  const enemies = state.enemies;
  let deaths = 0;
  const survivors = [];
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.alive === false) {
      deaths++;
      state.pickups.push(createGem(e.x, e.y, e.xp));
    } else {
      survivors.push(e);
    }
  }
  if (deaths > 0) {
    state.enemies = survivors;
    state.kills += deaths;
  }
}

/**
 * Контактный урон игроку: враг в пределах суммы радиусов наносит урон, если игрок
 * не в неуязвимости. После удара — короткие i-frames (повторный урон не проходит).
 * hp клампится в [0, maxHp]; задел под Game Over при hp<=0.
 */
function applyContactDamage(state) {
  const player = state.player;
  if (player.invulnTimer > 0) return;

  const enemies = state.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.alive === false) continue;
    const rr = player.radius + e.radius;
    if (distSq(player, e) <= rr * rr) {
      player.hp = Math.max(0, player.hp - COMBAT_CONFIG.contactDamage);
      player.invulnTimer = COMBAT_CONFIG.iframeDuration;
      break; // один тик урона за шаг (i-frames покрывают остальных)
    }
  }
}
