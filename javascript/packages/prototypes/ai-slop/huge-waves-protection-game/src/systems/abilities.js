// Способности (перки) и выбор при level-up.
// Data-driven пул: каждая запись { id, name, desc, maxLevel, apply(state) }.
// Контракт слоёв: abilities мутируют общий state (player/state поля). Случайности — только
// через state.rng (не Math.random), чтобы прогон оставался детерминированным.
//
// Как это работает:
// - state.abilities: { [id]: level } — сколько раз способность взята (стакается). Инициализируется
//   в createState для чистого рестарта.
// - rollChoices(state) → до 3 случайных доступных вариантов (не достигших maxLevel), без дублей.
// - applyAbility(state, id) → немедленно применяет apply(state) и повышает уровень (не выше maxLevel).
// - Эффекты реально читаются системами: combat (damage/fireRate/projectileCount/pierce/projectile*),
//   player.updatePlayer (speed/regen), leveling (pickupRange/xpGainMult).

/**
 * Хелперы мутации (сокращают повторения в apply). Все безопасны при отсутствии player.
 */
function w(state) {
  return state.player && state.player.weapon;
}

/** Пул способностей (~40). Каждая apply мутирует соответствующие поля state немедленно. */
export const ABILITIES = [
  // --- Урон ---
  { id: 'keen_edge', name: 'Заточка', desc: '+2 к урону', maxLevel: 10,
    apply: (s) => { w(s).damage += 2; } },
  { id: 'heavy_caliber', name: 'Тяжёлый калибр', desc: '+5 к урону', maxLevel: 6,
    apply: (s) => { w(s).damage += 5; } },
  { id: 'power_core', name: 'Силовое ядро', desc: '+12% к урону', maxLevel: 6,
    apply: (s) => { w(s).damage *= 1.12; } },
  { id: 'glass_cannon', name: 'Стеклянная пушка', desc: '+20% к урону', maxLevel: 3,
    apply: (s) => { w(s).damage *= 1.2; } },
  { id: 'marksman', name: 'Меткость', desc: '+3 к урону', maxLevel: 8,
    apply: (s) => { w(s).damage += 3; } },

  // --- Скорострельность ---
  { id: 'rapid_fire', name: 'Скорострельность', desc: '+0.4 выстрела/сек', maxLevel: 8,
    apply: (s) => { w(s).fireRate += 0.4; } },
  { id: 'trigger_finger', name: 'Быстрый палец', desc: '+0.25 выстрела/сек', maxLevel: 8,
    apply: (s) => { w(s).fireRate += 0.25; } },
  { id: 'overclock', name: 'Разгон', desc: '+12% скорострельности', maxLevel: 5,
    apply: (s) => { w(s).fireRate *= 1.12; } },
  { id: 'frenzy', name: 'Исступление', desc: '+18% скорострельности', maxLevel: 3,
    apply: (s) => { w(s).fireRate *= 1.18; } },
  { id: 'auto_loader', name: 'Автозарядка', desc: '+0.6 выстрела/сек', maxLevel: 5,
    apply: (s) => { w(s).fireRate += 0.6; } },

  // --- Скорость движения ---
  { id: 'swift_boots', name: 'Быстрые сапоги', desc: '+18 к скорости', maxLevel: 8,
    apply: (s) => { s.player.speed += 18; } },
  { id: 'sprint', name: 'Спринт', desc: '+8% к скорости', maxLevel: 4,
    apply: (s) => { s.player.speed *= 1.08; } },
  { id: 'light_step', name: 'Лёгкий шаг', desc: '+10 к скорости', maxLevel: 6,
    apply: (s) => { s.player.speed += 10; } },
  { id: 'windwalk', name: 'Ветроход', desc: '+5% к скорости', maxLevel: 5,
    apply: (s) => { s.player.speed *= 1.05; } },

  // --- Max HP / лечение ---
  { id: 'vitality', name: 'Живучесть', desc: '+20 к макс. HP и лечение', maxLevel: 8,
    apply: (s) => { s.player.maxHp += 20; s.player.hp += 20; } },
  { id: 'iron_body', name: 'Железное тело', desc: '+40 к макс. HP и лечение', maxLevel: 4,
    apply: (s) => { s.player.maxHp += 40; s.player.hp += 40; } },
  { id: 'toughness', name: 'Стойкость', desc: '+10% к макс. HP и лечение', maxLevel: 4,
    apply: (s) => { const inc = Math.round(s.player.maxHp * 0.1); s.player.maxHp += inc; s.player.hp += inc; } },
  { id: 'field_medic', name: 'Полевой медик', desc: 'Восстановить 50 HP', maxLevel: 5,
    apply: (s) => { s.player.hp = Math.min(s.player.maxHp, s.player.hp + 50); } },
  { id: 'second_wind', name: 'Второе дыхание', desc: 'Восстановить 30 HP', maxLevel: 6,
    apply: (s) => { s.player.hp = Math.min(s.player.maxHp, s.player.hp + 30); } },

  // --- Доп. снаряды / пробивание ---
  { id: 'multishot', name: 'Мультивыстрел', desc: '+1 снаряд', maxLevel: 5,
    apply: (s) => { s.player.projectileCount += 1; } },
  { id: 'twin_shot', name: 'Двойной выстрел', desc: '+1 снаряд', maxLevel: 3,
    apply: (s) => { s.player.projectileCount += 1; } },
  { id: 'spread_shot', name: 'Веер', desc: '+1 снаряд', maxLevel: 3,
    apply: (s) => { s.player.projectileCount += 1; } },
  { id: 'piercing_rounds', name: 'Пробивающие', desc: '+1 к пробитию', maxLevel: 6,
    apply: (s) => { s.player.pierce += 1; } },
  { id: 'lance', name: 'Копьё', desc: '+2 к пробитию', maxLevel: 3,
    apply: (s) => { s.player.pierce += 2; } },

  // --- Радиус подбора ---
  { id: 'magnet', name: 'Магнит', desc: '+40 к радиусу подбора', maxLevel: 6,
    apply: (s) => { s.pickupRange += 40; } },
  { id: 'greater_magnet', name: 'Большой магнит', desc: '+20% к радиусу подбора', maxLevel: 4,
    apply: (s) => { s.pickupRange *= 1.2; } },
  { id: 'collector', name: 'Собиратель', desc: '+25 к радиусу подбора', maxLevel: 8,
    apply: (s) => { s.pickupRange += 25; } },
  { id: 'vacuum', name: 'Вакуум', desc: '+15% к радиусу подбора', maxLevel: 4,
    apply: (s) => { s.pickupRange *= 1.15; } },

  // --- Прирост XP (влияет на прокачку) ---
  { id: 'quick_learner', name: 'Способный ученик', desc: '+15% к получаемому XP', maxLevel: 6,
    apply: (s) => { s.xpGainMult += 0.15; } },
  { id: 'wisdom', name: 'Мудрость', desc: '+10% к получаемому XP', maxLevel: 4,
    apply: (s) => { s.xpGainMult *= 1.1; } },
  { id: 'scholar', name: 'Учёный', desc: '+10% к получаемому XP', maxLevel: 8,
    apply: (s) => { s.xpGainMult += 0.1; } },
  { id: 'enlightenment', name: 'Просветление', desc: '+15% к получаемому XP', maxLevel: 3,
    apply: (s) => { s.xpGainMult *= 1.15; } },

  // --- Регенерация ---
  { id: 'regeneration', name: 'Регенерация', desc: '+1 HP/сек', maxLevel: 8,
    apply: (s) => { s.player.regen += 1; } },
  { id: 'lifebloom', name: 'Цветение жизни', desc: '+0.6 HP/сек', maxLevel: 6,
    apply: (s) => { s.player.regen += 0.6; } },
  { id: 'troll_blood', name: 'Кровь тролля', desc: '+2 HP/сек', maxLevel: 4,
    apply: (s) => { s.player.regen += 2; } },
  { id: 'mending', name: 'Заживление', desc: '+0.4 HP/сек', maxLevel: 8,
    apply: (s) => { s.player.regen += 0.4; } },

  // --- Area (размер снаряда) ---
  { id: 'big_shots', name: 'Крупные снаряды', desc: '+2 к радиусу снаряда', maxLevel: 6,
    apply: (s) => { w(s).projectileRadius += 2; } },
  { id: 'heavy_shells', name: 'Тяжёлые снаряды', desc: '+1 к радиусу снаряда', maxLevel: 8,
    apply: (s) => { w(s).projectileRadius += 1; } },
  { id: 'blast_radius', name: 'Радиус взрыва', desc: '+15% к радиусу снаряда', maxLevel: 4,
    apply: (s) => { w(s).projectileRadius *= 1.15; } },

  // --- Скорость/дальность снаряда ---
  { id: 'velocity', name: 'Ускорение снарядов', desc: '+60 к скорости снаряда', maxLevel: 6,
    apply: (s) => { w(s).projectileSpeed += 60; } },
  { id: 'railgun', name: 'Рельса', desc: '+100 к скорости снаряда', maxLevel: 4,
    apply: (s) => { w(s).projectileSpeed += 100; } },
  { id: 'long_shot', name: 'Дальний выстрел', desc: '+0.3с к жизни снаряда', maxLevel: 5,
    apply: (s) => { w(s).projectileLife += 0.3; } },
];

/** Индекс по id для быстрого поиска. */
const BY_ID = new Map(ABILITIES.map((a) => [a.id, a]));

/** Найти описание способности по id (или undefined). */
export function getAbility(id) {
  return BY_ID.get(id);
}

/** Текущий уровень способности у игрока (0, если не бралась). */
export function abilityLevel(state, id) {
  return (state.abilities && state.abilities[id]) || 0;
}

/**
 * Список доступных способностей: те, что ещё не достигли maxLevel.
 * @returns {Array} подмножество ABILITIES.
 */
function availableAbilities(state) {
  return ABILITIES.filter((a) => abilityLevel(state, a.id) < a.maxLevel);
}

/**
 * Вернуть до 3 случайных доступных вариантов при level-up.
 * Случайность только через state.rng. Без дублей в рамках одного выбора.
 * Вырожденный случай (доступных < 3) — вернёт столько, сколько есть.
 * @param {object} state
 * @param {number} [count=3]
 * @returns {Array} выбранные записи способностей.
 */
export function rollChoices(state, count = 3) {
  const pool = availableAbilities(state);
  // Частичная перетасовка Фишера–Йетса через state.rng (без Math.random).
  for (let i = pool.length - 1; i > 0; i--) {
    const j = state.rng.int(0, i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * Применить способность: немедленно мутирует state и повышает её уровень (стакается).
 * Не превышает maxLevel; неизвестный id или достигнутый maxLevel — no-op (возвращает false).
 * @param {object} state
 * @param {string} id
 * @returns {boolean} применена ли способность.
 */
export function applyAbility(state, id) {
  const ability = BY_ID.get(id);
  if (!ability) return false;
  if (!state.player) return false;

  const current = abilityLevel(state, id);
  if (current >= ability.maxLevel) return false;

  ability.apply(state); // эффект применяется немедленно
  state.abilities[id] = current + 1; // уровень растёт (стак)
  return true;
}
