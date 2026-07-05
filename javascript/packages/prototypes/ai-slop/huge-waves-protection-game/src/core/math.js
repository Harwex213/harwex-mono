// Математические утилиты: вектора (простые {x, y}), clamp, dist, len, norm.
// Чистые функции без побочных эффектов.

/** Ограничить число диапазоном [min, max]. */
export function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Линейная интерполяция. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Создать вектор. */
export function vec(x = 0, y = 0) {
  return { x, y };
}

/** Длина вектора {x, y}. */
export function len(v) {
  return Math.hypot(v.x, v.y);
}

/** Квадрат длины (без sqrt, для сравнений). */
export function lenSq(v) {
  return v.x * v.x + v.y * v.y;
}

/** Расстояние между двумя точками {x, y}. */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Квадрат расстояния (без sqrt, для сравнений радиусов). */
export function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Нормализовать вектор в единичный. Нулевой вектор остаётся нулевым. */
export function norm(v) {
  const l = Math.hypot(v.x, v.y);
  if (l === 0) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}
