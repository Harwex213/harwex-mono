// Экраны start и game over.
// Контракт: модуль ТОЛЬКО читает state в render; мутации фаз/рестарт — в обработчиках ввода.
//   - на фазе START рисует заголовок + приглашение, по пробелу/клику → PLAYING;
//   - на фазе GAMEOVER рисует статистику (время/убийства/уровень), по пробелу/клику → рестарт.
// Переход в GAMEOVER (hp<=0) делает main (единый источник истины по фазе), не этот модуль.
//
// Рисуется последним (поверх сцены, HUD и level-up оверлея).

import { GamePhase } from '../core/state.js';

const OVERLAY_BG = 'rgba(6, 9, 14, 0.82)';
const TITLE_COLOR = '#ffffff';
const ACCENT = '#4fd1ff';
const SUB_COLOR = '#93a1b5';
const STAT_LABEL = '#93a1b5';
const STAT_VALUE = '#dfe7f2';
const GAMEOVER_COLOR = '#e05454';

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** mm:ss из игрового времени (сек). */
function formatTime(t) {
  const total = Math.max(0, Math.floor(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Инициализировать контроллер экранов.
 * @param {object} state
 * @param {HTMLCanvasElement} canvas
 * @param {{ restart: () => void }} handlers - restart сбрасывает игру в чистое состояние (создаёт main).
 * @returns {{ render: (ctx: CanvasRenderingContext2D) => void, isActive: () => boolean, dispose: () => void }}
 */
export function initScreens(state, canvas, { restart }) {
  function isStart() {
    return state.phase === GamePhase.START;
  }
  function isGameOver() {
    return state.phase === GamePhase.GAMEOVER;
  }
  function isActive() {
    return isStart() || isGameOver();
  }

  /** Единое действие «продолжить» для обоих экранов (пробел/клик). */
  function advance() {
    if (isStart()) {
      state.phase = GamePhase.PLAYING; // старт симуляции
    } else if (isGameOver()) {
      restart(); // полный сброс state → чистая игра
    }
  }

  function onKeyDown(e) {
    if (!isActive()) return;
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      advance();
    }
  }

  function onClick() {
    if (!isActive()) return;
    advance();
  }

  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKeyDown);

  /** Стартовый экран: заголовок + приглашение. */
  function renderStart(ctx, width, height) {
    ctx.fillStyle = ACCENT;
    ctx.font = `bold 52px ${FONT}`;
    ctx.fillText('Huge Waves', width / 2, height / 2 - 70);
    ctx.fillStyle = TITLE_COLOR;
    ctx.fillText('Protection Game', width / 2, height / 2 - 10);

    ctx.fillStyle = SUB_COLOR;
    ctx.font = `20px ${FONT}`;
    ctx.fillText('Выживайте под натиском волн как можно дольше', width / 2, height / 2 + 44);

    ctx.fillStyle = TITLE_COLOR;
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText('Нажмите ПРОБЕЛ или кликните, чтобы начать', width / 2, height / 2 + 96);

    ctx.fillStyle = SUB_COLOR;
    ctx.font = `15px ${FONT}`;
    ctx.fillText('Движение: WASD или стрелки · Атака автоматическая', width / 2, height / 2 + 132);
  }

  /** Экран Game Over: статистика + приглашение к рестарту. */
  function renderGameOver(ctx, width, height) {
    const cx = width / 2;

    ctx.fillStyle = GAMEOVER_COLOR;
    ctx.font = `bold 56px ${FONT}`;
    ctx.fillText('Игра окончена', cx, height / 2 - 120);

    // Строки статистики: пара (подпись, значение).
    const stats = [
      ['Время выживания', formatTime(state.time)],
      ['Убийств', String(state.kills)],
      ['Достигнут уровень', String(state.level)],
    ];

    let y = height / 2 - 40;
    const rowGap = 44;
    for (const [label, value] of stats) {
      ctx.font = `18px ${FONT}`;
      ctx.fillStyle = STAT_LABEL;
      ctx.textAlign = 'right';
      ctx.fillText(label, cx - 16, y);

      ctx.font = `bold 22px ${FONT}`;
      ctx.fillStyle = STAT_VALUE;
      ctx.textAlign = 'left';
      ctx.fillText(value, cx + 16, y);
      y += rowGap;
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = TITLE_COLOR;
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText('Нажмите ПРОБЕЛ или кликните для рестарта', cx, y + 40);
  }

  function render(ctx) {
    if (!isActive()) return;
    const { width, height } = state.viewport;

    ctx.save();
    ctx.fillStyle = OVERLAY_BG;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    if (isStart()) renderStart(ctx, width, height);
    else renderGameOver(ctx, width, height);

    ctx.restore();
  }

  function dispose() {
    canvas.removeEventListener('click', onClick);
    window.removeEventListener('keydown', onKeyDown);
  }

  return { render, isActive, dispose };
}
