// HUD: Canvas 2D overlay поверх сцены. ТОЛЬКО читает state, никогда не мутирует.
// Контракт слоёв соблюдён: renderHud(ctx, state) не трогает state.
// Рисуется после render(ctx, state) в тех же CSS-пикселях (трансформ dpr уже применён в main).

const PANEL_BG = 'rgba(10, 14, 20, 0.55)';
const TEXT_COLOR = '#dfe7f2';
const TEXT_DIM = '#93a1b5';

const HP_BAR_BG = '#2a1414';
const HP_BAR_FILL_HI = '#54e08a'; // много HP
const HP_BAR_FILL_LO = '#e05454'; // мало HP
const HP_BAR_BORDER = '#0b1218';

const XP_BAR_BG = '#141b2a';
const XP_BAR_FILL = '#4fd1ff';
const XP_BAR_BORDER = '#0b1218';

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** mm:ss из игрового времени (сек). */
function formatTime(t) {
  const total = Math.max(0, Math.floor(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Прямоугольник со скруглением (path). */
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

/**
 * Отрисовать HUD поверх сцены.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 */
export function renderHud(ctx, state) {
  const p = state.player;
  if (!p) return;
  const { width } = state.viewport;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // --- Полоса XP: тонкая, во всю ширину вверху ---
  const xpH = 8;
  const xpFrac = state.xpToNext > 0 ? Math.max(0, Math.min(1, state.xp / state.xpToNext)) : 0;
  ctx.fillStyle = XP_BAR_BG;
  ctx.fillRect(0, 0, width, xpH);
  ctx.fillStyle = XP_BAR_FILL;
  ctx.fillRect(0, 0, width * xpFrac, xpH);
  ctx.strokeStyle = XP_BAR_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, xpH + 0.5);
  ctx.lineTo(width, xpH + 0.5);
  ctx.stroke();

  // --- Левая панель: HP + уровень ---
  const pad = 12;
  const panelX = pad;
  const panelY = xpH + pad;
  const panelW = 240;
  const panelH = 64;

  ctx.fillStyle = PANEL_BG;
  roundRect(ctx, panelX, panelY, panelW, panelH, 8);
  ctx.fill();

  // Уровень
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `bold 16px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(`Уровень ${state.level}`, panelX + 12, panelY + 24);

  // HP-полоса
  const hpBarX = panelX + 12;
  const hpBarY = panelY + 34;
  const hpBarW = panelW - 24;
  const hpBarH = 16;
  const hpFrac = p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0;

  ctx.fillStyle = HP_BAR_BG;
  roundRect(ctx, hpBarX, hpBarY, hpBarW, hpBarH, 4);
  ctx.fill();

  // Цвет заливки: интерполяция зелёный→красный по доле HP (просто по порогу компонент).
  ctx.fillStyle = hpFrac > 0.35 ? HP_BAR_FILL_HI : HP_BAR_FILL_LO;
  if (hpFrac > 0) {
    roundRect(ctx, hpBarX, hpBarY, hpBarW * hpFrac, hpBarH, 4);
    ctx.fill();
  }
  ctx.strokeStyle = HP_BAR_BORDER;
  ctx.lineWidth = 1;
  roundRect(ctx, hpBarX + 0.5, hpBarY + 0.5, hpBarW - 1, hpBarH - 1, 4);
  ctx.stroke();

  // Текст HP по центру полосы
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(
    `${Math.ceil(Math.max(0, p.hp))} / ${Math.round(p.maxHp)}`,
    hpBarX + hpBarW / 2,
    hpBarY + hpBarH - 4,
  );

  // --- Таймер выживания по центру сверху ---
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `bold 22px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(formatTime(state.time), width / 2, xpH + 30);

  // --- Счётчик убийств справа сверху ---
  ctx.textAlign = 'right';
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(`${state.kills}`, width - pad, xpH + 24);
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.fillText('убийств', width - pad, xpH + 40);

  ctx.restore();
}
