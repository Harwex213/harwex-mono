import { ROUTE_LINKS } from "../../data/routing.js";
import { BATTLE_PHASE } from "../../modules/active-battle.js";
import { topNavHtml } from "../../components/top-nav.js";
import { MODEL } from "../../model/model.js";

const STYLE = `
  <style>
    .ba { font-family: var(--font-body); color: var(--text-primary); padding: var(--space-8); }
    .ba h1 { margin: 0 0 var(--space-7); font-family: var(--font-display); font-size: var(--font-size-xl); color: var(--text-accent); }
    .ba p { margin: 0 0 var(--space-7); color: var(--text-secondary); }
    .ba a { color: var(--text-secondary); }
    .ba a:hover { color: var(--text-primary); }
  </style>
`;

const renderBattleActive = ({ root, params, router }) => {
  const content =
    MODEL.activeBattle.phase === BATTLE_PHASE.ACTIVE
      ? `<p>The battle rages — this stage is not built yet.</p>`
      : `<p>No active battle.</p><a href="${ROUTE_LINKS.BATTLE_CREATION}">Continue</a>`;

  root.innerHTML = `
    ${topNavHtml(router)}
    ${STYLE}
    <section class="ba">
      <h1>Battle</h1>
      ${content}
    </section>
  `;

  return () => {
    root.innerHTML = "";
  };
};

export { renderBattleActive };
