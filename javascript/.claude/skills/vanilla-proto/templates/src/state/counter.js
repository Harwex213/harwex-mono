/** @returns {import("../types").AppState} */
function createInitialState() {
  return {
    count: 0,
  };
}

/**
 * @param {import("../types").AppState} s
 * @param {number} delta
 */
function addCount(s, delta) {
  s.count += delta;
}

export { createInitialState, addCount };
