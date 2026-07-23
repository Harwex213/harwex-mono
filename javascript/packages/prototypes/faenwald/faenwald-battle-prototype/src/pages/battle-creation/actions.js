import { ROUTES } from "../../data/routing.js";
import {
  assignUnitType,
  changeMap,
  createUnit,
  createUnitModifier,
  removeUnit,
  removeUnitModifier
} from "../../state/battle-config-state/battle-config-state.js";
import {
  BATTLE_PHASE,
  resetActiveBattle,
  startBattleDisposition
} from "../../state/active-battle-state/active-battle-state.js";

/**
 * User intents, keyed by `data-action`. Every handler is `(ctx, el)` where
 * `ctx` is the page context ({ store, ui, router, render }) and `el` the
 * element carrying the `data-*` payload. Store dispatches repaint through the
 * page's subscription; only pure-UI changes (combobox open/close) call
 * ctx.render() themselves.
 *
 * Click and change intents live in separate maps so a click on a form
 * control can't dispatch its change intent twice (radios/selects fire both
 * events for one interaction).
 */

const CLICK_ACTIONS = {
  "add-unit": (ctx, el) => {
    ctx.store.set((s) => createUnit(s.battleConfig, el.dataset.side));
  },

  "remove-unit": (ctx, el) => {
    const unitId = Number(el.dataset.unitId);
    if (ctx.ui.comboForUnitId === unitId) {
      ctx.ui.comboForUnitId = null;
    }
    ctx.store.set((s) => removeUnit(s.battleConfig, unitId));
  },

  "remove-modifier": (ctx, el) => {
    const { unitId, collectionId, modifierId } = el.dataset;
    ctx.store.set((s) => removeUnitModifier(s.battleConfig, Number(unitId), collectionId, modifierId));
  },

  "open-combo": (ctx, el) => {
    ctx.ui.comboForUnitId = Number(el.dataset.unitId);
    ctx.render();
  },

  "pick-modifier": (ctx, el) => {
    const { unitId, collectionId, modifierId } = el.dataset;
    ctx.ui.comboForUnitId = null;
    ctx.store.set((s) => createUnitModifier(s.battleConfig, Number(unitId), collectionId, modifierId));
  },

  "start-battle": (ctx) => {
    ctx.store.set((s) => {
      if (s.activeBattle.phase === BATTLE_PHASE.FINISHED) {
        resetActiveBattle(s.activeBattle);
      }
      startBattleDisposition(s.activeBattle, s.battleConfig, s.modifiers);
    });
    ctx.router.push(ROUTES.BATTLE);
  },
};

const CHANGE_ACTIONS = {
  "select-map": (ctx, el) => {
    ctx.store.set((s) => changeMap(s.battleConfig, el.value));
  },

  "set-type": (ctx, el) => {
    ctx.store.set((s) => assignUnitType(s.battleConfig, Number(el.dataset.unitId), el.value || null));
  },
};

export { CLICK_ACTIONS, CHANGE_ACTIONS };
