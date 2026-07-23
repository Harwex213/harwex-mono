import { UNIT_TYPES } from "../../data/unit.js";
import { ROUTE_LINKS, ROUTES } from "../../data/routing.js";
import { getMap } from "../../state/maps-state/maps-state.js";
import {
  accelerate,
  advanceUnit,
  applyBreakthrough,
  attack,
  BATTLE_PHASE,
  capitulate,
  declineBreakthrough,
  endActivation,
  findUnit,
  fireModesAvailable,
  rotateUnit,
  routTick,
  unitAt,
  validRangedTargets
} from "../../state/active-battle-state/active-battle-state.js";
import { ACTIVE_UNIT_GROUP_TYPE, getUnitGroupType } from "../../lib/active-unit-group.js";
import { flankHexes, frontHexes, rearHexes, zoneOf } from "../../lib/hex-facing.js";
import { createBattleActiveCanvas } from "./battle-active-canvas.js";
import { createBattleActiveLeftPanel, createBattleActiveRightPanel, FIRE_MODE_LABEL } from "./battle-active-panels.js";

// spearmen may also advance to a flank/rear hex (at ×2 MP cost, enforced by
// the mutator); every other unit is restricted to its front hexes
const moveTargetHexes = (unit) => {
  const fronts = frontHexes(unit.position, unit.facing);
  if (getUnitGroupType(unit.type) === ACTIVE_UNIT_GROUP_TYPE.SPEARMEN) {
    return [...fronts, ...flankHexes(unit.position, unit.facing), ...rearHexes(unit.position, unit.facing)];
  }
  return fronts;
};

const noopPage = () => ({ el: document.createElement("span"), destroy: () => void 0 });

/**
 * @param {{ store: Store, router: Router }} deps
 * @returns {{ el: HTMLElement, mount?: () => void, destroy: () => void }}
 */
const createBattleActivePage = ({ store, router }) => {
  if (store.get().activeBattle.phase !== BATTLE_PHASE.ACTIVE) {
    router.replace(ROUTES.BATTLE);
    return noopPage();
  }

  const map = getMap(store.get().maps, store.get().activeBattle.mapId);

  const el = document.createElement("section");
  el.className = "battle-active";

  if (!map) {
    el.innerHTML = `
      <p class="missing">No active battle.</p>
      <a href="${ROUTE_LINKS.BATTLE}">Continue</a>
    `;
    return { el, destroy: () => void 0 };
  }

  // transient UI state: whether the rotation handles / hp labels are drawn,
  // the last hovered unit shown in the right panel, and the fire mode picked
  // for the active unit's next attack (only meaningful while it's ranged)
  let handlesEnabled = true;
  let hpEnabled = true;
  let hoveredUnitId = null;
  let confirmingCapitulation = false;
  let selectedFireMode = "direct";

  const getState = () => store.get().activeBattle;
  const getActiveUnit = () => findUnit(getState(), getState().activeUnitId);
  const unitRangedOf = (unit) => UNIT_TYPES.find((t) => t.type === unit.type)?.ranged ?? null;
  const getActiveRanged = () => {
    const unit = getActiveUnit();
    return unit ? unitRangedOf(unit) : null;
  };

  // falls back to the first available mode (direct -> arc -> melee) when the
  // stored selection has no legal target for the current active unit
  const resolveSelectedFireMode = () => {
    const ranged = getActiveRanged();
    if (!ranged) {
      return null;
    }
    const available = fireModesAvailable(getState(), map);
    if (available[selectedFireMode]) {
      return selectedFireMode;
    }
    return ["direct", "arc", "melee"].find((mode) => available[mode]) ?? selectedFireMode;
  };

  // targets highlighted on the canvas: adjacent enemies for a non-ranged
  // active unit, or the current fire mode's legal targets for a ranged one
  const getAttackTargetIds = () => {
    const active = getActiveUnit();
    if (!active?.position) {
      return [];
    }
    if (getActiveRanged()) {
      return validRangedTargets(getState(), map, resolveSelectedFireMode());
    }
    return validRangedTargets(getState(), map, "melee");
  };

  const leftPanel = createBattleActiveLeftPanel({
    store,
    hooks: { resolveFireMode: resolveSelectedFireMode },
  });
  const rightPanel = createBattleActiveRightPanel({
    store,
    hooks: { getHoveredUnitId: () => hoveredUnitId },
  });

  const onHoverChange = (hovered) => {
    const unit = hovered?.type === "hex" ? unitAt(getState(), hovered.row, hovered.col) : null;
    const id = unit ? unit.id : null;
    if (id === hoveredUnitId) {
      return;
    }
    hoveredUnitId = id;
    rightPanel.render();
  };

  // a routed activation lands on the same phase check: bail to the dispatcher
  // once the battle is no longer active, otherwise the subscription repaints
  const syncPhase = () => {
    if (getState().phase !== BATTLE_PHASE.ACTIVE) {
      router.replace(ROUTES.BATTLE);
      return true;
    }
    return false;
  };

  // resolve auto-fleeing routed activations before waiting for player input
  const autoAdvanceRouted = (s) => {
    let guard = 0;
    while (s.activeBattle.phase === BATTLE_PHASE.ACTIVE) {
      const a = findUnit(s.activeBattle, s.activeBattle.activeUnitId);
      if (!a || !a.routed) {
        break;
      }
      routTick(s.activeBattle, map);
      guard += 1;
      if (guard > 1000) {
        break;
      }
    }
  };

  // every player action funnels through here: run the engine mutation plus
  // the routed cascade in one dispatch, then leave the phase if it changed
  const act = (mutate) => {
    store.set((s) => {
      mutate(s);
      autoAdvanceRouted(s);
    });
    syncPhase();
  };

  const canvas = createBattleActiveCanvas({
    store,
    map,
    hooks: {
      getActiveUnit,
      isHandlesEnabled: () => handlesEnabled,
      isHpEnabled: () => hpEnabled,
      onHoverChange,
      getAttackTargetIds,
      getMoveTargetHexes: () => {
        const a = getActiveUnit();
        return a?.position ? moveTargetHexes(a) : [];
      },
      onRotate: (facing) => {
        act((s) => rotateUnit(s.activeBattle, facing, map));
      },
      onHexClick: (row, col) => {
        const active = getActiveUnit();
        if (!active?.position || active.routed) {
          return;
        }
        const target = unitAt(getState(), row, col);
        const ranged = getActiveRanged();
        if (ranged && target) {
          const mode = resolveSelectedFireMode();
          if (validRangedTargets(getState(), map, mode).includes(target.id)) {
            act((s) => attack(s.activeBattle, target.id, map, mode));
            return;
          }
        }
        if (target && target.side !== active.side && zoneOf(active.position, active.facing, target.position) !== null) {
          act((s) => attack(s.activeBattle, target.id, map));
          return;
        }
        const isMoveTarget = moveTargetHexes(active).some((h) => h.row === row && h.col === col);
        if (!isMoveTarget) {
          return;
        }
        act((s) => advanceUnit(s.activeBattle, { row, col }, map));
      },
    },
  });

  el.innerHTML = `
    <h1>Battle</h1>
    <div class="workspace" data-role="workspace"></div>
    <div class="footer" data-role="footer"></div>
  `;
  el.querySelector("[data-role=workspace]").append(leftPanel.el, canvas.el, rightPanel.el);
  const footer = el.querySelector("[data-role=footer]");

  const fireModeButtonsHtml = () => {
    const ranged = getActiveRanged();
    if (!ranged) {
      return "";
    }
    const available = fireModesAvailable(getState(), map);
    const effective = resolveSelectedFireMode();
    return ["arc", "direct", "melee"].map((mode) => {
      const disabled = mode === "arc" ? !ranged.arc || !available.arc : !available[mode];
      const isActive = mode === effective;
      return `
        <button
          data-action="fire-mode"
          data-mode="${mode}"
          class="${isActive ? "fire-mode--active" : ""}"
          ${disabled ? "disabled" : ""}
        >${FIRE_MODE_LABEL[mode]}</button>
      `;
    }).join("");
  };

  const renderFooter = () => {
    if (getState().pendingBreakthrough) {
      footer.innerHTML = `
        <button data-action="breakthrough-apply">Прорыв</button>
        <button data-action="breakthrough-decline">Остаться</button>
      `;
      return;
    }
    footer.innerHTML = `
      ${fireModeButtonsHtml()}
      <button data-action="accelerate">Accelerate</button>
      <button data-action="end-activation">End Activation</button>
      ${confirmingCapitulation
      ? `<button data-action="capitulate-confirm">Капитулировать за ${getActiveUnit()?.side ?? ""}?</button>
         <button data-action="capitulate-cancel">Cancel</button>`
      : `<button data-action="capitulate">Capitulate</button>`}
      <button data-action="toggle-handles" class="${handlesEnabled ? "toggle-handles--active" : ""}">Rotate Handles</button>
      <button data-action="toggle-hp" class="${hpEnabled ? "toggle-hp--active" : ""}">Show HP</button>
    `;
  };

  el.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    event.stopPropagation();

    switch (target.dataset.action) {
      case "fire-mode":
        selectedFireMode = target.dataset.mode;
        renderFooter();
        leftPanel.render();
        canvas.requestRender();
        break;
      case "accelerate":
        act((s) => accelerate(s.activeBattle, map));
        break;
      case "end-activation":
        act((s) => endActivation(s.activeBattle, map));
        break;
      case "capitulate":
        confirmingCapitulation = true;
        renderFooter();
        break;
      case "capitulate-cancel":
        confirmingCapitulation = false;
        renderFooter();
        break;
      case "capitulate-confirm": {
        const side = getActiveUnit()?.side;
        confirmingCapitulation = false;
        if (!side) {
          renderFooter();
          break;
        }
        store.set((s) => capitulate(s.activeBattle, side));
        syncPhase();
        break;
      }
      case "toggle-handles":
        handlesEnabled = !handlesEnabled;
        renderFooter();
        canvas.requestRender();
        break;
      case "toggle-hp":
        hpEnabled = !hpEnabled;
        renderFooter();
        canvas.requestRender();
        break;
      case "breakthrough-apply":
        act((s) => applyBreakthrough(s.activeBattle, map));
        break;
      case "breakthrough-decline":
        act((s) => declineBreakthrough(s.activeBattle));
        break;
    }
  });

  const unsubscribe = store.subscribe(renderFooter);

  const mount = () => {
    canvas.mount();
    // a battle can be entered with a routed unit already active (e.g. after
    // a reload); resolve it before waiting for player input
    act(() => void 0);
  };

  const destroy = () => {
    canvas.destroy();
    leftPanel.destroy();
    rightPanel.destroy();
    unsubscribe();
  };

  return { el, mount, destroy };
};

export { createBattleActivePage };
