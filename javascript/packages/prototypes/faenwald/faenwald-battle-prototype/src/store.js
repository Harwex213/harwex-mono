/**
 * Minimal pub/sub store. Mutate state inside `set(fn)`; returning a value
 * from `fn` replaces the state wholesale (used for reset).
 *
 * @template S
 * @param {S} initial
 */
function createStore(initial) {
  let state = initial;
  const subs = new Set();

  return {
    get: () => state,

    /** @param {(s: S) => S | void} mutate */
    set(mutate) {
      const next = mutate(state);
      if (next !== undefined) {
        state = next;
      }
      for (const fn of subs) {
        fn(state);
      }
    },

    /** @param {(s: S) => void} fn Called immediately and on every set. */
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
  };
}

export { createStore };
