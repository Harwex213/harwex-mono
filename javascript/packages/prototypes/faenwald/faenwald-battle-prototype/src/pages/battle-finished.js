import { ROUTE_LINKS } from "../data/routing.js";
import { BATTLE_PHASE } from "../modules/active-battle.js";
import { topNavHtml } from "../components/top-nav.js";
import { MODEL } from "../model/model.js";

const STYLE = `
  <style>
    .bf { font-family: var(--font-body); color: var(--text-primary); padding: var(--space-8); }
    .bf h1 { margin: 0 0 var(--space-7); font-family: var(--font-display); font-size: var(--font-size-xl); color: var(--text-accent); }
    .bf p { margin: 0 0 var(--space-7); color: var(--text-secondary); }
    .bf a { color: var(--text-secondary); }
    .bf a:hover { color: var(--text-primary); }
  </style>
`;

// placeholder: the battle outcome screen lands here in a later iteration
const renderBattleFinished = () => {
  const root = document.querySelector("main");

  const content =
    MODEL.activeBattle.phase === BATTLE_PHASE.FINISHED
      ? `<p>The battle is over — this stage is not built yet.</p>`
      : `<p>No finished battle.</p><a href="${ROUTE_LINKS.BATTLE}">Continue</a>`;

  root.innerHTML = `
    ${topNavHtml()}
    ${STYLE}
    <section class="bf">
      <h1>Battle finished</h1>
      ${content}
    </section>
  `;

  return () => {
    root.innerHTML = "";
  };
};

export { renderBattleFinished };
