import { STAT_META, UNIT_TYPES } from "../../data/unit.js";
import { effectiveMorale, findUnit } from "../../state/active-battle-state/active-battle-state.js";
import { getUnitGroupType, GROUP_CYCLE } from "../../lib/active-unit-group.js";
import { GROUP_EMOJI } from "../../lib/unit-render.js";

/**
 * The two side panels of the active-battle page. Each subscribes to the
 * store; page-local UI inputs (selected fire mode, hovered unit) arrive
 * through `hooks`, and the page calls .render() when only those change.
 */

const FIRE_MODE_LABEL = { arc: "Навес", direct: "Прямой", melee: "Ближний" };

const unitRangedOf = (unit) => UNIT_TYPES.find((t) => t.type === unit.type)?.ranged ?? null;

const unitStatsHtml = (state, unit) => `
  <span>MP ${unit.movePoints}</span>
  ${unitRangedOf(unit) ? `<span>ammo ${unit.ammo}</span>` : ""}
  ${STAT_META.map((m) => `<span>${m.id === "morale" ? effectiveMorale(state, unit) : unit[m.id]} ${m.emoji}</span>`).join("")}
`;

/**
 * @param {{ store: Store, hooks: { resolveFireMode: () => string | null } }} deps
 * @returns {{ el: HTMLElement, render: () => void, destroy: () => void }}
 */
const createBattleActiveLeftPanel = ({ store, hooks }) => {
  const el = document.createElement("aside");
  el.className = "panel";

  const activeUnitCardHtml = (state, unit) => {
    const ranged = unitRangedOf(unit);
    return `
      <div class="active-unit-card">
        <div class="active-unit-name">${unit.name}</div>
        <div class="active-unit-stats">${unitStatsHtml(state, unit)}</div>
        ${ranged
      ? `<div class="active-unit-fire-info">
              Режим: ${FIRE_MODE_LABEL[hooks.resolveFireMode()] ?? ""}
              ${unit.cooldown > 0 ? ` · перезарядка ${unit.cooldown}` : ""}
            </div>`
      : ""}
      </div>
    `;
  };

  const render = (s) => {
    const state = s.activeBattle;
    const activeUnit = findUnit(state, state.activeUnitId);
    const groupRows = GROUP_CYCLE
      .filter((g) => state.units.some((u) =>
        u.side === g.side && getUnitGroupType(u.type) === g.type && u.position !== null && !u.destroyed))
      .map((g) => {
        const isActive = state.activeGroup?.side === g.side && state.activeGroup?.type === g.type;
        return `
          <div class="group-row ${isActive ? "group-row--active" : ""}">
            <span>${GROUP_EMOJI[g.type] ?? "❓"}</span>
            <span>${g.side} ${g.type}</span>
          </div>
        `;
      })
      .join("");

    el.innerHTML = `
      <div class="panel-title">Раунд ${state.round}</div>
      <div class="group-queue">${groupRows}</div>
      ${activeUnit ? activeUnitCardHtml(state, activeUnit) : `<p class="missing">No active unit.</p>`}
    `;
  };

  const unsubscribe = store.subscribe(render);

  return { el, render: () => render(store.get()), destroy: unsubscribe };
};

/**
 * @param {{ store: Store, hooks: { getHoveredUnitId: () => number | null } }} deps
 * @returns {{ el: HTMLElement, render: () => void, destroy: () => void }}
 */
const createBattleActiveRightPanel = ({ store, hooks }) => {
  const el = document.createElement("aside");
  el.className = "panel";

  const hoverUnitCardHtml = (state, unit) => `
    <div class="hover-unit-card">
      <div class="hover-unit-name">${unit.name}</div>
      <div class="hover-unit-stats">${unitStatsHtml(state, unit)}</div>
    </div>
  `;

  const render = (s) => {
    const state = s.activeBattle;
    const hoveredUnitId = hooks.getHoveredUnitId();
    const hoveredUnit = hoveredUnitId === null ? null : findUnit(state, hoveredUnitId);
    const logHtml = state.log
      .slice()
      .reverse()
      .map((line) => `<div class="log-line">${line}</div>`)
      .join("");
    el.innerHTML = `
      <div class="panel-title">Info</div>
      ${hoveredUnit ? hoverUnitCardHtml(state, hoveredUnit) : `<p class="missing">Hover a unit for details.</p>`}
      <div class="panel-title">Log</div>
      <div class="log">${logHtml}</div>
    `;
  };

  const unsubscribe = store.subscribe(render);

  return { el, render: () => render(store.get()), destroy: unsubscribe };
};

export { FIRE_MODE_LABEL, createBattleActiveLeftPanel, createBattleActiveRightPanel };
