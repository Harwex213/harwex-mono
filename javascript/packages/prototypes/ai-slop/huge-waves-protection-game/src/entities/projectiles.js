// Снаряды: фабрика и обновление полёта.
// Контракт: движением/жизнью снарядов управляет система combat (мутатор state).
// Рендер только читает. Данные снаряда — простой объект без методов.

/**
 * Создать снаряд.
 * @param {number} x - стартовая мировая координата X (обычно центр игрока).
 * @param {number} y - стартовая мировая координата Y.
 * @param {number} dirX - единичный вектор направления по X (норм. в combat).
 * @param {number} dirY - единичный вектор направления по Y.
 * @param {{speed:number,damage:number,radius:number,life:number,pierce?:number}} opts
 * @returns {object} снаряд (данные без методов).
 */
export function createProjectile(x, y, dirX, dirY, opts) {
  return {
    x,
    y,
    vx: dirX * opts.speed,
    vy: dirY * opts.speed,
    damage: opts.damage,
    radius: opts.radius,
    life: opts.life, // остаток времени жизни, сек
    alive: true,
    // Пробивание (T6): сколько врагов сверх первого снаряд ещё может поразить.
    pierce: opts.pierce || 0,
    // Уже поражённые враги — чтобы пробивающий снаряд не бил одного врага дважды.
    hits: null,
  };
}

/**
 * Продвинуть снаряд на один шаг: движение × скорость × dt и списание времени жизни.
 * @param {object} p - снаряд.
 * @param {number} dt - фиксированный шаг, сек.
 */
export function updateProjectile(p, dt) {
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.life -= dt;
}
