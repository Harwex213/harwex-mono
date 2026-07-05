// Система прогрессии: притяжение XP-гемов, их подбор, накопление XP и рост уровня.
// Единая точка логики XP/уровней — updateLeveling(state, dt). Мутирует state; рендер только читает.
// Порядок в шаге: притяжение гемов к игроку → подбор при контакте → накопление XP → level up(ы).

import { distSq } from '../core/math.js';

/** Параметры прогрессии (data-driven, без магии в коде). */
export const LEVELING_CONFIG = {
  // База и показатель кривой порога: xpToNext = round(baseXp * level^curveExp).
  baseXp: 5,
  curveExp: 1.5,
  // Притяжение гема в радиусе pickupRange: скорость растёт при сближении.
  // Итоговая скорость = lerp(attractSpeedFar, attractSpeedNear) по близости к игроку.
  attractSpeedFar: 90, // мировых пикселей/сек на краю радиуса притяжения
  attractSpeedNear: 520, // мировых пикселей/сек вплотную к игроку
};

/**
 * Порог XP для перехода С уровня `level` на следующий (растущая кривая, детерминирован).
 * @param {number} level - текущий уровень (>=1).
 * @returns {number} требуемый XP для следующего уровня.
 */
export function xpToNextForLevel(level) {
  return Math.round(LEVELING_CONFIG.baseXp * Math.pow(level, LEVELING_CONFIG.curveExp));
}

/**
 * Единая точка логики прогрессии на один шаг симуляции.
 * @param {object} state
 * @param {number} dt - фиксированный шаг, сек.
 */
export function updateLeveling(state, dt) {
  const player = state.player;
  if (!player) return;

  attractGems(state, dt);
  collectGems(state);
  resolveLevelUps(state);
}

/**
 * Притяжение гемов к игроку, когда он в радиусе pickupRange.
 * Гем движется к игроку; скорость тем выше, чем ближе гем к игроку.
 */
function attractGems(state, dt) {
  const player = state.player;
  const gems = state.pickups;
  const range = state.pickupRange;
  const rangeSq = range * range;

  for (let i = 0; i < gems.length; i++) {
    const g = gems[i];
    if (g.alive === false) continue;

    const dx = player.x - g.x;
    const dy = player.y - g.y;
    const dSq = dx * dx + dy * dy;
    if (dSq > rangeSq) continue; // игрок вне радиуса притяжения — гем не двигается

    const d = Math.sqrt(dSq);
    if (d === 0) continue; // уже в точке игрока — подбор обработает collectGems

    // Близость 0 (на краю радиуса) .. 1 (вплотную) → скорость растёт при сближении.
    const closeness = 1 - d / range;
    const speed =
      LEVELING_CONFIG.attractSpeedFar +
      (LEVELING_CONFIG.attractSpeedNear - LEVELING_CONFIG.attractSpeedFar) * closeness;

    // Не перелетаем игрока за один шаг: ограничиваем шаг оставшейся дистанцией.
    const step = Math.min(speed * dt, d);
    g.x += (dx / d) * step;
    g.y += (dy / d) * step;
  }
}

/**
 * Подбор гемов при контакте с игроком (сумма радиусов). Подобранный гем добавляет
 * свой xp к state.xp и помечается alive=false; массив чистится одним filter (без утечки).
 */
function collectGems(state) {
  const player = state.player;
  const gems = state.pickups;
  let anyCollected = false;

  for (let i = 0; i < gems.length; i++) {
    const g = gems[i];
    if (g.alive === false) continue;
    const rr = player.radius + g.radius;
    if (distSq(player, g) <= rr * rr) {
      // Множитель прироста XP (способности T6) — прямо влияет на скорость прокачки.
      state.xp += g.xp * (state.xpGainMult || 1);
      g.alive = false;
      anyCollected = true;
    }
  }

  if (anyCollected) {
    state.pickups = gems.filter((g) => g.alive !== false);
  }
}

/**
 * Обработать возможные level up(ы): пока накопленного XP хватает на порог,
 * повышаем уровень, переносим остаток, пересчитываем порог и растим счётчик
 * pendingLevelUps (событие для UI T7). Поддержаны множественные level up за шаг.
 */
function resolveLevelUps(state) {
  while (state.xp >= state.xpToNext) {
    state.xp -= state.xpToNext; // остаток переносится на новый уровень
    state.level += 1;
    state.xpToNext = xpToNextForLevel(state.level);
    state.pendingLevelUps += 1;
  }
}
