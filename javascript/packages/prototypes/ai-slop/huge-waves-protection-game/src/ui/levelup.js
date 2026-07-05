// Экран выбора способностей при level-up.
// Контракт: пока state.pendingLevelUps > 0 — симуляция на паузе (решение о паузе принимает main
// по state.pendingLevelUps). Этот модуль:
//   - роллит ровно 3 варианта ОДИН раз на каждый level-up (rollChoices через state.rng);
//   - обрабатывает выбор мышью (клик по карточке) и клавишами 1/2/3;
//   - по выбору вызывает applyAbility (эффект немедленный), декрементит pendingLevelUps;
//   - рисует оверлей (render только читает внутреннее состояние + state, не мутирует state в render).
//
// Мутации state происходят в обработчиках ввода / sync (логика), не в render — слои разделены.

import { rollChoices, applyAbility, abilityLevel, getAbility } from '../systems/abilities.js';

const OVERLAY_BG = 'rgba(6, 9, 14, 0.78)';
const TITLE_COLOR = '#ffffff';
const SUB_COLOR = '#93a1b5';

const CARD_BG = '#141b26';
const CARD_BG_HOVER = '#1e2a3c';
const CARD_BORDER = '#2c3a52';
const CARD_BORDER_HOVER = '#4fd1ff';
const CARD_NAME = '#dfe7f2';
const CARD_DESC = '#a9b6c9';
const CARD_LEVEL = '#4fd1ff';
const KEY_BADGE_BG = '#4fd1ff';
const KEY_BADGE_TEXT = '#08131c';

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/**
 * Раскладка карточек в CSS-пикселях (чистая функция от вьюпорта и числа карт).
 * Общая для рендера и hit-теста, чтобы клик совпадал с отрисовкой.
 */
function cardRects(state, count) {
  const { width, height } = state.viewport;
  const gap = 24;
  const cardW = Math.max(160, Math.min(300, (width * 0.86 - gap * (count - 1)) / count));
  const cardH = Math.max(200, Math.min(360, height * 0.5));
  const totalW = cardW * count + gap * (count - 1);
  const startX = (width - totalW) / 2;
  const y = (height - cardH) / 2 + 20; // чуть ниже заголовка
  const rects = [];
  for (let i = 0; i < count; i++) {
    rects.push({ x: startX + i * (cardW + gap), y, w: cardW, h: cardH });
  }
  return rects;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Перенос текста по словам в заданную ширину; возвращает массив строк. */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Инициализировать контроллер экрана выбора.
 * @param {object} state
 * @param {HTMLCanvasElement} canvas
 * @returns {{ sync: () => void, render: (ctx: CanvasRenderingContext2D) => void,
 *            isActive: () => boolean, dispose: () => void }}
 */
export function initLevelUp(state, canvas) {
  let choices = null; // текущий набор вариантов (роллится раз на level-up)
  let hover = -1; // индекс подсвеченной карточки (мышь)

  /** Синхронизация с state: роллим варианты один раз на каждый ожидающий level-up. */
  function sync() {
    if (state.pendingLevelUps > 0 && !choices) {
      choices = rollChoices(state, 3);
      hover = -1;
      // Вырожденный случай: доступных способностей нет — нечего выбирать,
      // просто «поглощаем» level-up, чтобы не зависнуть на паузе.
      if (choices.length === 0) {
        state.pendingLevelUps -= 1;
        choices = null;
      }
    }
  }

  function isActive() {
    return state.pendingLevelUps > 0 && choices && choices.length > 0;
  }

  /** Применить выбор по индексу карточки. */
  function pick(i) {
    if (!isActive()) return;
    if (i < 0 || i >= choices.length) return;
    applyAbility(state, choices[i].id); // эффект немедленный
    state.pendingLevelUps -= 1;
    choices = null; // следующий sync перероллит, если остались level-up'ы
    hover = -1;
  }

  /** Экранные координаты мыши в CSS-пикселях (canvas на весь экран). */
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function hitTest(px, py) {
    if (!choices) return -1;
    const rects = cardRects(state, choices.length);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return -1;
  }

  function onMouseMove(e) {
    if (!isActive()) {
      if (hover !== -1) hover = -1;
      return;
    }
    const { x, y } = pointerPos(e);
    hover = hitTest(x, y);
  }

  function onClick(e) {
    if (!isActive()) return;
    const { x, y } = pointerPos(e);
    const i = hitTest(x, y);
    if (i !== -1) pick(i);
  }

  function onKeyDown(e) {
    if (!isActive()) return;
    let idx = -1;
    if (e.code === 'Digit1' || e.code === 'Numpad1') idx = 0;
    else if (e.code === 'Digit2' || e.code === 'Numpad2') idx = 1;
    else if (e.code === 'Digit3' || e.code === 'Numpad3') idx = 2;
    if (idx === -1) return;
    e.preventDefault();
    pick(idx);
  }

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKeyDown);

  function render(ctx) {
    if (!isActive()) return;
    const { width, height } = state.viewport;

    // Затемнение сцены.
    ctx.save();
    ctx.fillStyle = OVERLAY_BG;
    ctx.fillRect(0, 0, width, height);

    // Заголовок.
    const rects = cardRects(state, choices.length);
    const titleY = rects[0].y - 56;
    ctx.textAlign = 'center';
    ctx.fillStyle = TITLE_COLOR;
    ctx.font = `bold 30px ${FONT}`;
    ctx.fillText('Уровень повышен!', width / 2, titleY);
    ctx.fillStyle = SUB_COLOR;
    ctx.font = `15px ${FONT}`;
    const remain = state.pendingLevelUps > 1 ? ` (ещё ${state.pendingLevelUps - 1})` : '';
    ctx.fillText(`Выберите способность — клик или клавиши 1 / 2 / 3${remain}`, width / 2, titleY + 26);

    // Карточки.
    for (let i = 0; i < choices.length; i++) {
      const a = choices[i];
      const r = rects[i];
      const hovered = i === hover;

      ctx.fillStyle = hovered ? CARD_BG_HOVER : CARD_BG;
      roundRect(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hovered ? CARD_BORDER_HOVER : CARD_BORDER;
      roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 12);
      ctx.stroke();

      // Бейдж с номером клавиши.
      const badge = 30;
      ctx.fillStyle = KEY_BADGE_BG;
      roundRect(ctx, r.x + 14, r.y + 14, badge, badge, 8);
      ctx.fill();
      ctx.fillStyle = KEY_BADGE_TEXT;
      ctx.font = `bold 18px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), r.x + 14 + badge / 2, r.y + 14 + badge / 2 + 1);
      ctx.textBaseline = 'alphabetic';

      const cx = r.x + r.w / 2;
      const innerW = r.w - 40;

      // Название.
      ctx.fillStyle = CARD_NAME;
      ctx.font = `bold 20px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(a.name, cx, r.y + 84);

      // Уровень способности (текущий → следующий / max).
      const lvl = abilityLevel(state, a.id);
      const def = getAbility(a.id);
      const maxLevel = def ? def.maxLevel : lvl + 1;
      ctx.fillStyle = CARD_LEVEL;
      ctx.font = `13px ${FONT}`;
      const lvlLabel = lvl === 0
        ? 'Новая'
        : `Ур. ${lvl} → ${lvl + 1} (макс ${maxLevel})`;
      ctx.fillText(lvlLabel, cx, r.y + 106);

      // Описание (перенос по словам).
      ctx.fillStyle = CARD_DESC;
      ctx.font = `15px ${FONT}`;
      ctx.textAlign = 'center';
      const lines = wrapText(ctx, a.desc, innerW);
      let ly = r.y + 140;
      for (const line of lines) {
        ctx.fillText(line, cx, ly);
        ly += 20;
      }
    }

    ctx.restore();
  }

  function dispose() {
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('click', onClick);
    window.removeEventListener('keydown', onKeyDown);
  }

  return { sync, render, isActive, dispose };
}
