// Подбираемые предметы: XP-гемы, роняемые умершими врагами.
// Данные-объект без методов; жизненным циклом управляет системa leveling (мутатор state).
// Рендер только читает. Гемы живут в state.pickups.

/** Радиус XP-гема по умолчанию (мировые пиксели, для коллизий и рендера). */
export const GEM_RADIUS = 6;

/**
 * Создать XP-гем в мировой позиции (x, y).
 * @param {number} x - мировая координата X (точка смерти врага).
 * @param {number} y - мировая координата Y.
 * @param {number} xp - сколько опыта даёт гем при подборе.
 * @returns {{x:number,y:number,xp:number,radius:number,alive:boolean}}
 */
export function createGem(x, y, xp) {
  return {
    x,
    y,
    xp,
    radius: GEM_RADIUS,
    alive: true,
  };
}
