// Игрок: фабрика и обновление позиции.
// Контракт: updatePlayer мутирует state.player (система движения). Рендер не трогает.

import { clamp } from '../core/math.js';

/** Параметры игрока по умолчанию. */
const PLAYER_DEFAULTS = {
  maxHp: 100,
  speed: 230, // пикселей мира в секунду (заметно быстрее врагов — можно кайтить)
  radius: 16,
};

/**
 * Параметры оружия по умолчанию (data-driven; T6 abilities смогут это модифицировать).
 * fireRate — выстрелов в секунду; интервал = 1/fireRate считает combat.
 * Дальность снаряда = projectileSpeed * projectileLife (здесь ~275px): бой ведётся
 * рядом с игроком, поэтому XP-гемы падают в радиусе подбора и опыт реально собирается.
 */
const WEAPON_DEFAULTS = {
  fireRate: 2.4, // выстрелов/сек (DPS ~19 на старте)
  damage: 8, // урон одного снаряда
  projectileSpeed: 500, // мировых пикселей/сек
  projectileRadius: 6, // радиус снаряда (для коллизий и рендера)
  projectileLife: 0.55, // время жизни снаряда, сек → дальность ~275px
};

/**
 * Создать игрока в центре мира.
 * @param {{width:number,height:number}} world
 */
export function createPlayer(world) {
  return {
    x: world.width / 2,
    y: world.height / 2,
    hp: PLAYER_DEFAULTS.maxHp,
    maxHp: PLAYER_DEFAULTS.maxHp,
    speed: PLAYER_DEFAULTS.speed,
    radius: PLAYER_DEFAULTS.radius,

    // Оружие и бой (используется combat.js в T4).
    weapon: { ...WEAPON_DEFAULTS },
    fireTimer: 0, // накопитель кулдауна авто-атаки
    invulnTimer: 0, // остаток неуязвимости после удара, сек

    // Модифицируемые способностями (T6). Combat читает projectileCount/pierce,
    // updatePlayer применяет regen. Дефолты = «без перков».
    projectileCount: 1, // сколько снарядов за выстрел (веер)
    pierce: 0, // сквозных попаданий сверх первого (0 = снаряд гибнет на первом враге)
    regen: 0, // регенерация HP в секунду
  };
}

/**
 * Обновить позицию игрока по нормализованному вектору ввода.
 * Движение кадронезависимо: смещение = move * speed * dt.
 * Позиция клампится в границы мира с учётом радиуса.
 * @param {object} state
 * @param {number} dt - фиксированный шаг, сек.
 */
export function updatePlayer(state, dt) {
  const p = state.player;
  if (!p) return;

  const move = state.input.move; // уже нормализован (длина 0 или 1)
  p.x += move.x * p.speed * dt;
  p.y += move.y * p.speed * dt;

  const { width, height } = state.world;
  p.x = clamp(p.x, p.radius, width - p.radius);
  p.y = clamp(p.y, p.radius, height - p.radius);

  // Регенерация HP (способность T6): восстановление до maxHp, кадронезависимо.
  if (p.regen > 0 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
  }
}
