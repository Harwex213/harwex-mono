import { ROUTES } from "../../data/routing.js";
import { BATTLE_PHASE } from "../../data/battle.js";
import { resetActiveBattle } from "../../state/active-battle-state/active-battle-state.js";
import { computeLosses } from "../../lib/losses.js";

const SIDE_LABEL = { attacker: "Атакующий", defender: "Защитник" };

const unitRowHtml = (row) => {
  const detail = row.status === "destroyed"
    ? `потери ${row.casualties} · пленных ${row.prisoners}`
    : `${row.hp}/${row.maxHp} ❤ · ${row.morale} 📯 · потери ${row.casualties}`;

  return `
    <li class="unit-row">
      <span>${row.name}</span>
      <span class="unit-row-detail">${detail}</span>
    </li>
  `;
};

const groupHtml = (title, rows) => {
  if (rows.length === 0) {
    return `<div class="group-title">${title}</div><p class="missing">—</p>`;
  }

  return `
    <div class="group-title">${title}</div>
    <ul class="unit-list">${rows.map(unitRowHtml).join("")}</ul>
  `;
};

const sideHtml = (side, sideLosses) => `
  <div class="side">
    <div class="side-title">${SIDE_LABEL[side]}</div>
    ${groupHtml("Выжившие", sideLosses.survivors)}
    ${groupHtml("Бежавшие", sideLosses.routed)}
    ${groupHtml("Уничтожены", sideLosses.destroyed)}
    <div class="side-totals">
      <div>Всего потерь: ${sideLosses.casualties}</div>
      <div>Пленных взято: ${sideLosses.prisonersTaken}</div>
    </div>
  </div>
`;

const noopPage = () => ({ el: document.createElement("span"), destroy: () => void 0 });

/**
 * A finished battle is frozen — the report renders once at creation, no
 * subscription needed.
 *
 * @param {{ store: Store, router: Router }} deps
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
const createBattleFinishedPage = ({ store, router }) => {
  const state = store.get().activeBattle;

  if (state.phase !== BATTLE_PHASE.FINISHED) {
    router.replace(ROUTES.BATTLE);
    return noopPage();
  }

  const losses = computeLosses(state.units);

  const capitulated = state.log.some((line) => line.includes("капитулирует"));
  const bannerText = state.winner === "draw"
    ? "Ничья"
    : `Победа: ${SIDE_LABEL[state.winner]}${capitulated ? " (противник капитулировал)" : ""}`;

  const logHtml = state.log.map((line) => `<div class="log-line">${line}</div>`).join("");

  const el = document.createElement("section");
  el.className = "battle-finished";
  el.innerHTML = `
    <h1>${bannerText}</h1>
    <div class="sides">
      ${sideHtml("attacker", losses.attacker)}
      ${sideHtml("defender", losses.defender)}
    </div>
    <div class="log">${logHtml}</div>
    <div class="footer">
      <button data-action="new-battle">Новая битва</button>
    </div>
  `;

  el.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    event.stopPropagation();
    if (target.dataset.action === "new-battle") {
      store.set((s) => resetActiveBattle(s.activeBattle));
      router.push(ROUTES.BATTLE_CREATION);
    }
  });

  return { el, destroy: () => void 0 };
};

export { createBattleFinishedPage };
