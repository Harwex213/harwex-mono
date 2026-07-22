import { ROUTES } from "../../data/routing.js";
import { assignUnitType, changeMap, createUnit, createUnitModifier, removeUnit, removeUnitModifier } from "../../state/battle-config.js";
import { BATTLE_PHASE, resetActiveBattle, startBattleDisposition } from "../../state/active-battle.js";

/**
 * User intents, keyed by `data-action`. Every handler is `(ctx, el)` where
 * `ctx` is the page context ({ model, ui, router, render }) and `el` the
 * element carrying the `data-*` payload. Handlers that change what's on
 * screen call ctx.render() themselves — there is no automatic repaint.
 *
 * Click and change intents live in separate maps so a click on a form
 * control can't dispatch its change intent twice (radios/selects fire both
 * events for one interaction).
 */

const CLICK_ACTIONS = {
  "add-unit": (ctx, el) => {
    createUnit(ctx.model.battleConfig, el.dataset.side);
    ctx.render();
  },

  "remove-unit": (ctx, el) => {
    const unitId = Number(el.dataset.unitId);
    removeUnit(ctx.model.battleConfig, unitId);
    if (ctx.ui.comboForUnitId === unitId) {
      ctx.ui.comboForUnitId = null;
    }
    ctx.render();
  },

  "remove-modifier": (ctx, el) => {
    const { unitId, collectionId, modifierId } = el.dataset;
    removeUnitModifier(ctx.model.battleConfig, Number(unitId), collectionId, modifierId);
    ctx.render();
  },

  "open-combo": (ctx, el) => {
    ctx.ui.comboForUnitId = Number(el.dataset.unitId);
    ctx.render();
  },

  "pick-modifier": (ctx, el) => {
    const { unitId, collectionId, modifierId } = el.dataset;
    createUnitModifier(ctx.model.battleConfig, Number(unitId), collectionId, modifierId);
    ctx.ui.comboForUnitId = null;
    ctx.render();
  },

  "start-battle": (ctx) => {
    if (ctx.model.activeBattle.phase === BATTLE_PHASE.FINISHED) {
      resetActiveBattle(ctx.model.activeBattle);
    }
    startBattleDisposition(ctx.model.activeBattle, ctx.model.battleConfig, ctx.model.modifiers);
    ctx.router.push(ROUTES.BATTLE);
  },
};

const CHANGE_ACTIONS = {
  "select-map": (ctx, el) => {
    changeMap(ctx.model.battleConfig, el.value);
    ctx.render();
  },

  "set-type": (ctx, el) => {
    assignUnitType(ctx.model.battleConfig, Number(el.dataset.unitId), el.value || null);
    ctx.render();
  },
};

export { CLICK_ACTIONS, CHANGE_ACTIONS };
