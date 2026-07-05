// Ввод: слушатели клавиатуры (WASD + стрелки) → нормализованный вектор движения.
// Контракт: initInput вешает слушатели и пишет в state.input; это единственный
// мутатор ввода. Рендер и остальные системы вектор только читают.

import { norm } from './math.js';

// Коды клавиш направлений (event.code — раскладконезависимо для WASD).
const KEY_DIRS = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/**
 * Пересчитать нормализованный вектор движения из набора нажатых клавиш.
 * Диагональ не быстрее прямой (нормализация). Нет нажатий → {0,0}.
 */
function recomputeMove(state) {
  const keys = state.input.keys;
  let x = 0;
  let y = 0;
  if (keys.left) x -= 1;
  if (keys.right) x += 1;
  if (keys.up) y -= 1; // экранный/мировой Y растёт вниз
  if (keys.down) y += 1;

  const n = norm({ x, y });
  state.input.move.x = n.x;
  state.input.move.y = n.y;
}

/**
 * Навесить слушатели клавиатуры и связать их с state.input.
 * @param {object} state
 * @param {Window|HTMLElement} [target=window]
 * @returns {() => void} функция снятия слушателей.
 */
export function initInput(state, target = window) {
  function onKeyDown(e) {
    const dir = KEY_DIRS[e.code];
    if (!dir) return;
    e.preventDefault();
    if (!state.input.keys[dir]) {
      state.input.keys[dir] = true;
      recomputeMove(state);
    }
  }

  function onKeyUp(e) {
    const dir = KEY_DIRS[e.code];
    if (!dir) return;
    e.preventDefault();
    if (state.input.keys[dir]) {
      state.input.keys[dir] = false;
      recomputeMove(state);
    }
  }

  // Потеря фокуса окна — сбрасываем все клавиши, чтобы игрок не «уезжал».
  function onBlur() {
    state.input.keys = {};
    recomputeMove(state);
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return function dispose() {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
