// Камера: следует за игроком и преобразует мировые координаты в экранные.
// Контракт: updateCamera мутирует state.camera (система). worldToScreen — чистая
// функция для рендера (читает state, ничего не мутирует).

/**
 * Обновить позицию камеры — центр обзора совпадает с игроком.
 * @param {object} state
 */
export function updateCamera(state) {
  const p = state.player;
  if (!p) return;
  state.camera.x = p.x;
  state.camera.y = p.y;
}

/**
 * Смещение левого-верхнего угла обзора в мировых координатах.
 * (мир камеры центрирован → вычитаем половину вьюпорта.)
 * @param {object} state
 * @returns {{x:number,y:number}}
 */
export function cameraOrigin(state) {
  return {
    x: state.camera.x - state.viewport.width / 2,
    y: state.camera.y - state.viewport.height / 2,
  };
}

/**
 * Мировые координаты → экранные (CSS-пиксели).
 * @param {object} state
 * @param {number} worldX
 * @param {number} worldY
 * @returns {{x:number,y:number}}
 */
export function worldToScreen(state, worldX, worldY) {
  const origin = cameraOrigin(state);
  return {
    x: worldX - origin.x,
    y: worldY - origin.y,
  };
}
