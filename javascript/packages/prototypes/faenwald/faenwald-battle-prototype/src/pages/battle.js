import { MAPS, UNIT_TYPES, STAT_META } from "../data/catalog.js";
import { SIDES, battleConfig, computeStats, isConfigValid } from "../modules/battle-config.js";
import { findModifier } from "../modules/modifiers-store.js";

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
