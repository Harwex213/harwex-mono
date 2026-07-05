// Глобальное игровое состояние.
// Контракт: системы мутируют этот объект в update(state, dt); рендер только читает.
// Начальное состояние создаётся функцией, чтобы рестарт давал чистую копию.

import { createRng } from './rng.js';
import { xpToNextForLevel } from '../systems/leveling.js';

/** Фиксированный шаг симуляции (детерминированный). */
export const FIXED_DT = 1 / 60;

/** Seed по умолчанию для детерминированного ГПСЧ. */
export const DEFAULT_SEED = 12345;

/** Фазы игры (для будущих экранов start/gameover). */
export const GamePhase = {
  START: 'start',
  PLAYING: 'playing',
  LEVELUP: 'levelup',
  GAMEOVER: 'gameover',
};

/**
 * Создать свежее начальное состояние игры.
 * @param {number} seed - seed для ГПСЧ.
 */
export function createState(seed = DEFAULT_SEED) {
  return {
    // Игра стартует на экране start; симуляция идёт только в PLAYING (см. main).
    phase: GamePhase.START,

    // Время
    time: 0, // прошло игрового времени, сек
    frame: 0, // номер симуляционного шага

    // Мир (большой, больше экрана; используется с T2)
    world: { width: 4000, height: 4000 },

    // Вьюпорт в CSS-пикселях (обновляется при resize)
    viewport: { width: 0, height: 0, dpr: 1 },

    // Камера (центр обзора в мировых координатах)
    camera: { x: 0, y: 0 },

    // Ввод (заполняется в T2)
    input: { move: { x: 0, y: 0 }, keys: {} },

    // Сущности (наполняются в следующих задачах)
    player: null,
    enemies: [],
    projectiles: [],
    pickups: [],

    // Спавн волн (таймер накопления до следующего спавна)
    spawn: { timer: 0 },

    // Счётчик убийств (растёт в combat при смерти врага)
    kills: 0,

    // Прогрессия (XP/уровни; логика в systems/leveling.js)
    level: 1, // текущий уровень игрока
    xp: 0, // накопленный XP на текущем уровне
    xpToNext: xpToNextForLevel(1), // порог XP до следующего уровня (растущая кривая)
    pendingLevelUps: 0, // сколько level up ждут обработки UI (событие для T7)
    pickupRange: 200, // радиус притяжения XP-гемов (модифицируется abilities T6);
                      // ~ дальности снаряда, чтобы опыт с убитых рядом врагов реально собирался
    xpGainMult: 1, // множитель получаемого XP (модифицируется abilities T6; влияет на прокачку)

    // Взятые способности: { [id]: level } — стакающиеся перки (systems/abilities.js).
    // Здесь, чтобы рестарт (createState) давал чистый пул способностей.
    abilities: {},

    // Детерминированный ГПСЧ
    rng: createRng(seed),
    seed,
  };
}
