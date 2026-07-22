import { addCount } from "../state/counter.js";

/** Example component: renders count, dispatches addCount. */
function createCounter({ store }) {
  const el = document.createElement("section");
  el.className = "counter";
  el.innerHTML = `
    <b data-count></b>
    <button type="button" data-inc>+1</button>
  `;
  const count = el.querySelector("[data-count]");

  el.querySelector("[data-inc]").addEventListener("click", () => {
    store.set((s) => addCount(s, 1));
  });

  const unsub = store.subscribe((s) => {
    count.textContent = s.count;
  });

  return { el, destroy: unsub };
}

export { createCounter };
