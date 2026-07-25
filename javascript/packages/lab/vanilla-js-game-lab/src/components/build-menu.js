import { BUILDINGS, priceOf } from "../game/buildings.js";

/** Left panel: one card per registry entry; click to arm placement. */
function createBuildMenu({ store }) {
  const el = document.createElement("aside");
  el.className = "build-menu";

  const cards = new Map();
  for (const [type, def] of Object.entries(BUILDINGS)) {
    const card = document.createElement("button");
    card.className = "build-card";
    card.innerHTML = `
      <span class="build-emoji">${def.emoji}</span>
      <span class="build-body">
        <span class="build-name">${def.name} <i data-count></i></span>
        <span class="build-info">${def.info}</span>
      </span>
      <span class="build-price" data-price></span>
    `;
    card.addEventListener("click", () => {
      store.set((s) => {
        if (s.gameOver || BUILDINGS[type].fromDay > s.day) {
          return;
        }
        s.selected = s.selected === type ? null : type;
      });
    });
    el.append(card);
    cards.set(type, card);
  }

  const hint = document.createElement("p");
  hint.className = "build-hint";
  hint.textContent = "Click a hex to place · Esc cancels · Click a building to sell (50%)";
  el.append(hint);

  const unsub = store.subscribe((s) => {
    for (const [type, card] of cards) {
      const def = BUILDINGS[type];
      const locked = def.fromDay > s.day;
      const price = priceOf(type, s.counts[type]);
      card.classList.toggle("is-locked", locked);
      card.classList.toggle("is-selected", s.selected === type);
      card.classList.toggle("is-poor", !locked && s.coins < price);
      card.querySelector("[data-price]").textContent = locked ? `🔒 day ${def.fromDay}` : `${price} 💰`;
      card.querySelector("[data-count]").textContent = s.counts[type] ? `×${s.counts[type]}` : "";
    }
  });

  return { el, destroy: unsub };
}

export { createBuildMenu };
