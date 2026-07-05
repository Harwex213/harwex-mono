// Враги: data-driven типы, фабрика и chase-движение к игроку.
// Контракт: updateEnemies мутирует state.enemies (система движения).
// Рендер только читает. Спавн живёт в systems/spawn.js.

import { norm } from '../core/math.js';

/**
 * Таблица типов врагов (data-driven).
 * Каждый тип задаёт базовые статы и визуал; появляется по порогу игрового времени.
 * - minTime: с какой секунды тип начинает спавниться;
 * - weight: относительный вес при выборе типа среди разблокированных;
 * - baseHp/baseSpeed: базовые статы до масштабирования волной;
 * - radius/color: визуал (разные типы визуально различимы);
 * - xp: сколько опыта даёт XP-гем этого врага при подборе (T5).
 */
export const ENEMY_TYPES = {
  // Базовый: с самого старта, средний по всем статам.
  grunt: {
    type: 'grunt',
    minTime: 0,
    weight: 10,
    baseHp: 10,
    baseSpeed: 88, // подходит к игроку за ~9с с края экрана — старт не пустой
    radius: 14,
    color: '#e5533c',
    xp: 1,
  },
  // Быстрый рой: слабый и мелкий, но догоняет игрока.
  runner: {
    type: 'runner',
    minTime: 25,
    weight: 7,
    baseHp: 8,
    baseSpeed: 140,
    radius: 10,
    color: '#f2c14e',
    xp: 2,
  },
  // Танк: медленный, много HP, крупный.
  brute: {
    type: 'brute',
    minTime: 65,
    weight: 4,
    baseHp: 50,
    baseSpeed: 52,
    radius: 24,
    color: '#8e5bd9',
    xp: 6,
  },
  // Элита позднего этапа: быстрый И живучий.
  stalker: {
    type: 'stalker',
    minTime: 130,
    weight: 3,
    baseHp: 34,
    baseSpeed: 108,
    radius: 16,
    color: '#3ad1a0',
    xp: 5,
  },
};

/**
 * Множители масштабирования статов в зависимости от игрового времени.
 * Растут с state.time — волны усиливаются (больше HP и скорости).
 * @param {number} time - игровое время, сек.
 */
export function waveScaling(time) {
  const minutes = time / 60;
  return {
    // HP растёт ощутимо, но плавно: +45% за минуту (без резких пиков непроходимости).
    hp: 1 + minutes * 0.45,
    // Скорость растёт медленно и ограничена, чтобы игрока (speed 230) не догоняли мгновенно.
    speed: Math.min(1 + minutes * 0.1, 1.6),
  };
}

/**
 * Создать врага заданного типа в мировой позиции (x, y).
 * Статы масштабируются по текущему игровому времени.
 * @param {string} typeKey - ключ в ENEMY_TYPES.
 * @param {number} x - мировая координата X.
 * @param {number} y - мировая координата Y.
 * @param {number} time - игровое время для масштабирования, сек.
 */
export function createEnemy(typeKey, x, y, time) {
  const def = ENEMY_TYPES[typeKey];
  const scale = waveScaling(time);
  const maxHp = Math.round(def.baseHp * scale.hp);
  return {
    type: def.type,
    x,
    y,
    hp: maxHp,
    maxHp,
    speed: def.baseSpeed * scale.speed,
    radius: def.radius,
    color: def.color,
    xp: def.xp, // опыт, который враг роняет XP-гемом при смерти (T5)
    alive: true,
  };
}

/**
 * Chase-движение всех врагов к текущей позиции игрока.
 * Смещение = нормализованный вектор к игроку × speed × dt (кадронезависимо).
 * Полное наложение врагов допустимо (без разведения).
 * @param {object} state
 * @param {number} dt - фиксированный шаг, сек.
 */
export function updateEnemies(state, dt) {
  const p = state.player;
  if (!p) return;

  const enemies = state.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const dir = norm({ x: p.x - e.x, y: p.y - e.y });
    e.x += dir.x * e.speed * dt;
    e.y += dir.y * e.speed * dt;
  }
}
