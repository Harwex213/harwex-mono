import { ROUTE_LINKS, ROUTES } from "../../data/routing.js";
import { BATTLE_PHASE, resetActiveBattle } from "../../state/active-battle.js";
import { computeLosses } from "../../lib/losses.js";
import { MODEL } from "../../model/model.js";

const STYLE = `
  <style>
    .bf {
      font-family: var(--font-body);
      color: var(--text-primary);
      padding: var(--space-8);
    }

    .bf h1 {
      margin: 0 0 var(--space-7);
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      color: var(--text-accent);
      text-align: center;
    }

    .bf .sides {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-8);
      margin-bottom: var(--space-8);
    }

    .bf .side {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--card-radius);
      padding: var(--space-6);
    }

    .bf .side-title {
      font-family: var(--font-display);
      color: var(--text-accent);
    }

    .bf .group-title {
      color: var(--text-secondary);
    }

    .bf .unit-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .bf .unit-row {
      display: flex;
      justify-content: space-between;
      gap: var(--space-3);
      color: var(--text-primary);
      padding: var(--space-2) var(--space-3);
      background: var(--bg-control-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
    }

    .bf .unit-row-detail {
      color: var(--text-secondary);
    }

    .bf .missing {
      margin: 0;
      color: var(--text-muted);
    }

    .bf .side-totals {
      color: var(--text-secondary);
    }

    .bf .log {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0 0 var(--space-8);
      padding: var(--space-3);
      max-height: 40vh;
      overflow-y: auto;
      background: var(--bg-control-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
    }

    .bf .log-line {
      color: var(--text-secondary);
    }

    .bf .footer {
      display: flex;
      justify-content: center;
    }

    .bf .footer button {
      font: inherit;
      color: var(--text-primary);
      background: var(--bg-control);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-sm);
      padding: var(--space-5) var(--space-8);
      cursor: pointer;
    }

    .bf .footer button:hover {
      background: var(--bg-control-hover);
    }

    .bf a {
      color: var(--text-secondary);
    }

    .bf a:hover {
      color: var(--text-primary);
    }
  </style>
`;

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

const renderBattleFinished = ({ root, params, router }) => {
  if (MODEL.activeBattle.phase !== BATTLE_PHASE.FINISHED) {
    router.replace(ROUTES.BATTLE);
    return () => {};
  }

  const state = MODEL.activeBattle;
  const losses = computeLosses(state.units);

  const capitulated = state.log.some((line) => line.includes("капитулирует"));
  const bannerText = state.winner === "draw"
    ? "Ничья"
    : `Победа: ${SIDE_LABEL[state.winner]}${capitulated ? " (противник капитулировал)" : ""}`;

  const logHtml = state.log.map((line) => `<div class="log-line">${line}</div>`).join("");

  root.innerHTML = `
    ${STYLE}
    <section class="bf">
      <h1>${bannerText}</h1>
      <div class="sides">
        ${sideHtml("attacker", losses.attacker)}
        ${sideHtml("defender", losses.defender)}
      </div>
      <div class="log">${logHtml}</div>
      <div class="footer">
        <button data-action="new-battle">Новая битва</button>
      </div>
    </section>
  `;

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) {
      return;
    }
    if (el.dataset.action === "new-battle") {
      resetActiveBattle(MODEL.activeBattle);
      router.push(ROUTES.BATTLE_CREATION);
    }
  };

  root.addEventListener("click", onClick);

  return () => {
    root.removeEventListener("click", onClick);
    root.innerHTML = "";
  };
};

export { renderBattleFinished };
