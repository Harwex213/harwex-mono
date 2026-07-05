// Bootstrap + игровой цикл с фиксированным шагом симуляции (accumulator).
// Контракт слоёв: update(state, dt) мутирует state; render(ctx, state) только читает.

import { createState, FIXED_DT, GamePhase } from './core/state.js';
import { initInput } from './core/input.js';
import { createPlayer, updatePlayer } from './entities/player.js';
import { updateEnemies } from './entities/enemies.js';
import { updateSpawn } from './systems/spawn.js';
import { updateCombat } from './systems/combat.js';
import { updateLeveling } from './systems/leveling.js';
import { updateCamera } from './render/camera.js';
import { render } from './render/renderer.js';
import { renderHud } from './ui/hud.js';
import { initLevelUp } from './ui/levelup.js';
import { initScreens } from './ui/screens.js';

// Максимум симуляционных шагов за один кадр — защита от «спирали смерти».
// Если вкладка была неактивна и накопилось много времени, лишнее отбрасываем.
const MAX_STEPS_PER_FRAME = 5;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

// state — const-ссылка: рестарт сбрасывает поля in-place (createState + Object.assign),
// чтобы все модули (input/levelup/screens), захватившие эту ссылку, продолжали работать.
const state = createState();
state.player = createPlayer(state.world);

// Слушатели ввода: пишут нормализованный вектор в state.input.move.
initInput(state);

// Начальная центровка камеры на игроке (до первого кадра рендера).
updateCamera(state);

// Контроллер экрана выбора способностей (пауза + оверлей при level-up).
const levelup = initLevelUp(state, canvas);

/**
 * Полный сброс игры в чистое состояние (рестарт из Game Over).
 * Мутирует существующий объект state in-place, чтобы сохранить ссылку у модулей.
 * После сброса нет остаточного state: kills/level/xp/враги/снаряды/перки обнулены.
 */
function restart() {
  Object.assign(state, createState(state.seed));
  state.player = createPlayer(state.world);
  state.phase = GamePhase.PLAYING; // рестарт сразу в игру (минуя стартовый экран)
  updateCamera(state);
  accumulator = 0;
  lastTime = performance.now();
}

// Контроллер экранов start / game over (оверлеи + переходы фаз по вводу).
const screens = initScreens(state, canvas, { restart });

/** Подогнать размер canvas под окно с учётом devicePixelRatio (чёткая картинка). */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;

  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';

  // Рисуем в CSS-пикселях: масштабируем контекст под dpr.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  state.viewport.width = cssW;
  state.viewport.height = cssH;
  state.viewport.dpr = dpr;
}

window.addEventListener('resize', resize);
resize();

/**
 * Обновление симуляции на один фиксированный шаг.
 * Системы мутируют state; порядок: движение → камера. Рендер вызывается отдельно.
 * @param {object} state
 * @param {number} dt - фиксированный шаг, сек.
 */
function update(state, dt) {
  state.time += dt;
  state.frame += 1;

  updatePlayer(state, dt);
  updateCamera(state); // камера актуальна до спавна (спавн за краями текущего обзора)
  updateSpawn(state, dt); // спавн новых врагов за пределами вьюпорта
  updateEnemies(state, dt); // chase-движение всех врагов к игроку
  updateCombat(state, dt); // авто-атака, полёт снарядов, урон, смерть (роняет XP-гемы)
  updateLeveling(state, dt); // притяжение/подбор гемов, накопление XP, level up

  // Game Over: hp<=0 — единый источник истины по фазе. Гасим ожидающие level-up'ы,
  // чтобы оверлей выбора не всплыл поверх экрана Game Over (смерть могла совпасть с level up).
  if (state.player.hp <= 0) {
    state.phase = GamePhase.GAMEOVER;
    state.pendingLevelUps = 0;
  }
}

let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  // Реальное время между кадрами в секундах.
  let elapsed = (now - lastTime) / 1000;
  lastTime = now;

  // Не даём accumulator расти бесконечно (спираль смерти).
  const maxElapsed = FIXED_DT * MAX_STEPS_PER_FRAME;
  if (elapsed > maxElapsed) elapsed = maxElapsed;

  // Синхронизация экрана выбора: роллит варианты при появлении level-up.
  levelup.sync();

  // Симуляция мира идёт только в фазе PLAYING и без ожидающих level-up'ов.
  // На фазах start/gameover и во время level-up паузы мир не двигается; накопитель
  // сбрасываем, чтобы после возобновления не было рывка «наверстывания».
  const simulating = state.phase === GamePhase.PLAYING && state.pendingLevelUps === 0;
  if (simulating) {
    accumulator += elapsed;
    // Фиксированный детерминированный шаг симуляции.
    while (accumulator >= FIXED_DT) {
      update(state, FIXED_DT);
      accumulator -= FIXED_DT;
    }
  } else {
    accumulator = 0;
  }

  // Порядок рендера: сцена → HUD → level-up оверлей → screens (start/gameover поверх всего).
  render(ctx, state);
  renderHud(ctx, state);
  levelup.render(ctx);
  screens.render(ctx);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
