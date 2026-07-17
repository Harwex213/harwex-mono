import { MAPS, UNIT_TYPES, STAT_META } from "../data/catalog.js";
import { SIDES, battleConfig, computeStats, isConfigValid } from "../modules/battle-config.js";
import { findModifier } from "../modules/modifiers-store.js";
import { topNavHtml } from "../components/top-nav.js";

const STYLE = `
  <style>
    .bt { padding: var(--space-8); color: var(--text-primary); }
    .bt h1 { font-family: var(--font-display); font-size: var(--font-size-xl); color: var(--text-accent); margin-bottom: var(--space-7); }
    .bt h2 { font-family: var(--font-display); font-size: var(--font-size-lg); color: var(--text-secondary); text-transform: capitalize; margin: var(--space-7) 0 var(--space-4); }
    .bt ul { margin: 0 0 var(--space-7); padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-4); }
    .bt li { padding: var(--card-padding); background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--card-radius); color: var(--text-secondary); }
    .bt a { display: inline-block; margin-top: var(--space-6); }
  </style>
`;

const renderBattle = () => {
  const root = document.querySelector("main");

  if (!isConfigValid()) {
    root.innerHTML = `
      ${topNavHtml()}
      ${STYLE}
      <div class="bt">
        <p>No battle configured.</p>
        <a href="#/game">Create battle</a>
      </div>
    `;
    return () => {
      root.innerHTML = "";
    };
  }

  const map = MAPS.find((m) => m.id === battleConfig.mapId);

  const sideHtml = (side) => `
    <h2>${side}</h2>
    <ul>
      ${battleConfig[side]
        .map((unit) => {
          const type = UNIT_TYPES.find((t) => t.id === unit.typeId);
          const s = computeStats(unit);
          const names = unit.modifiers
            .map((ref) => findModifier(ref.collectionId, ref.modifierId)?.name)
            .filter(Boolean);
          const mods = names.length ? ` — ${names.join(", ")}` : "";
          const stats = STAT_META.map((m) => `${s[m.id]} ${m.emoji}`).join(" ");
          return `<li>${type.name}: ${stats}${mods}</li>`;
        })
        .join("")}
    </ul>
  `;

  root.innerHTML = `
    ${topNavHtml()}
    ${STYLE}
    <div class="bt">
      <h1>Battle on ${map.name}</h1>
      ${SIDES.map(sideHtml).join("")}
      <a href="#/game">Back to setup</a>
    </div>
  `;

  return () => {
    root.innerHTML = "";
  };
};

export { renderBattle };
