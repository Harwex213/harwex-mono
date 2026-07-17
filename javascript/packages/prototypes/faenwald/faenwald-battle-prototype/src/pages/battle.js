import { MAPS, UNIT_TYPES } from "../data/catalog.js";
import { SIDES, battleConfig, computeStats, isConfigValid } from "../modules/battle-config.js";

const renderBattle = () => {
  const root = document.querySelector("main");

  if (!isConfigValid()) {
    root.innerHTML = `
      <div style="font-family: sans-serif; padding: 16px;">
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
    <h2 style="font-size: 16px;">${side}</h2>
    <ul>
      ${battleConfig[side]
        .map((unit) => {
          const type = UNIT_TYPES.find((t) => t.id === unit.typeId);
          const s = computeStats(unit);
          const mods = unit.modifierIds.length ? ` — ${unit.modifierIds.join(", ")}` : "";
          return `<li>${type.name}: ${s.hp} ❤️ ${s.attack} ⚔️ ${s.morale} 🏆${mods}</li>`;
        })
        .join("")}
    </ul>
  `;

  root.innerHTML = `
    <div style="font-family: sans-serif; padding: 16px;">
      <h1 style="font-size: 20px;">Battle on ${map.name}</h1>
      ${SIDES.map(sideHtml).join("")}
      <a href="#/game">Back to setup</a>
    </div>
  `;

  return () => {
    root.innerHTML = "";
  };
};

export { renderBattle };
