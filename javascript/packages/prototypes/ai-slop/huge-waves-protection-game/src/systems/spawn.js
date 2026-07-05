// Система спавна волн: мутирует state.enemies по таймеру.
// Волны усиливаются со временем: чаще спавн, больше врагов за пачку,
// новые типы по порогам времени. Использует детерминированный state.rng.
// Контракт: updateSpawn(state, dt) мутирует state; рендер не трогает.

import { clamp } from '../core/math.js';
import { ENEMY_TYPES, createEnemy } from '../entities/enemies.js';

/** Параметры прогрессии волн (data-driven, без магии в коде). */
const SPAWN_CONFIG = {
  baseInterval: 1.1, // старт: интервал между пачками спавна, сек
  minInterval: 0.28, // нижний предел интервала (пик частоты)
  intervalDecayPerMin: 0.22, // насколько уменьшается интервал за минуту
  baseBatch: 2, // сколько врагов в пачке в начале
  batchGrowthPerMin: 2, // прирост размера пачки за минуту
  maxBatch: 16, // потолок размера пачки
  maxEnemies: 400, // жёсткий потолок числа живых врагов (производительность)
  spawnMargin: 60, // на сколько за краем вьюпорта спавнить (мир. пиксели)
};

/**
 * Текущий интервал спавна (сек): падает с ростом времени → волны чаще.
 * @param {number} time
 */
function currentInterval(time) {
  const minutes = time / 60;
  const interval = SPAWN_CONFIG.baseInterval - minutes * SPAWN_CONFIG.intervalDecayPerMin;
  return clamp(interval, SPAWN_CONFIG.minInterval, SPAWN_CONFIG.baseInterval);
}

/**
 * Текущий размер пачки спавна: растёт с временем → волны крупнее.
 * @param {number} time
 */
function currentBatch(time) {
  const minutes = time / 60;
  const batch = SPAWN_CONFIG.baseBatch + Math.floor(minutes * SPAWN_CONFIG.batchGrowthPerMin);
  return Math.min(batch, SPAWN_CONFIG.maxBatch);
}

/** Ключи типов, разблокированных к данному игровому времени. */
function unlockedTypes(time) {
  return Object.keys(ENEMY_TYPES).filter((k) => time >= ENEMY_TYPES[k].minTime);
}

/**
 * Взвешенный выбор типа врага среди разблокированных (детерминированно, через rng).
 * @param {object} state
 */
function pickType(state) {
  const keys = unlockedTypes(state.time);
  let total = 0;
  for (const k of keys) total += ENEMY_TYPES[k].weight;

  let roll = state.rng.next() * total;
  for (const k of keys) {
    roll -= ENEMY_TYPES[k].weight;
    if (roll <= 0) return k;
  }
  return keys[keys.length - 1];
}

/**
 * Позиция спавна за пределами видимой области: случайный угол вокруг камеры,
 * дистанция = половина диагонали вьюпорта + запас. Клампится в границы мира.
 * @param {object} state
 * @param {number} radius - радиус врага (для клампа у границ мира).
 */
function spawnPosition(state, radius) {
  const cam = state.camera;
  const { width, height } = state.viewport;
  // За углом экрана: радиус охвата от центра камеры больше полудиагонали вьюпорта.
  const halfDiag = Math.hypot(width, height) / 2;
  const dist = halfDiag + SPAWN_CONFIG.spawnMargin;

  const angle = state.rng.next() * Math.PI * 2;
  let x = cam.x + Math.cos(angle) * dist;
  let y = cam.y + Math.sin(angle) * dist;

  const world = state.world;
  x = clamp(x, radius, world.width - radius);
  y = clamp(y, radius, world.height - radius);
  return { x, y };
}

/**
 * Обновление спавна на один шаг симуляции.
 * Накопительный таймер: когда достигает текущего интервала — спавнит пачку.
 * @param {object} state
 * @param {number} dt - фиксированный шаг, сек.
 */
export function updateSpawn(state, dt) {
  const spawn = state.spawn;
  spawn.timer += dt;

  const interval = currentInterval(state.time);
  // while, чтобы догнать при больших dt и не терять пачки.
  while (spawn.timer >= interval) {
    spawn.timer -= interval;

    if (state.enemies.length >= SPAWN_CONFIG.maxEnemies) continue;

    const batch = currentBatch(state.time);
    for (let i = 0; i < batch; i++) {
      if (state.enemies.length >= SPAWN_CONFIG.maxEnemies) break;
      const typeKey = pickType(state);
      const radius = ENEMY_TYPES[typeKey].radius;
      const pos = spawnPosition(state, radius);
      state.enemies.push(createEnemy(typeKey, pos.x, pos.y, state.time));
    }
  }
}
