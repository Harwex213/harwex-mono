// Seedable детерминированный ГПСЧ (mulberry32).
// Один и тот же seed даёт одну и ту же последовательность.

/**
 * Создать генератор псевдослучайных чисел.
 * @param {number} seed - целочисленный seed.
 * @returns объект с методами next/range/int/pick.
 */
export function createRng(seed = 1) {
  let state = seed >>> 0;

  /** Следующее число в [0, 1). */
  function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    /** Число в [0, 1). */
    next,
    /** Число в [min, max). */
    range(min, max) {
      return min + next() * (max - min);
    },
    /** Целое в [min, max] включительно. */
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },
    /** Случайный элемент массива. */
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    /** Текущий seed/состояние (для отладки). */
    getState() {
      return state >>> 0;
    },
  };
}
