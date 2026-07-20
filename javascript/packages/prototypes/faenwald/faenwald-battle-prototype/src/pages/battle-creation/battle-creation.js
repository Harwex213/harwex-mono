import { ROUTES } from "../../data/routing.js";
import { BATTLE_CONFIG_MODULE } from "../../modules/battle-config.js";
import { MAPS_MODULE } from "../../modules/maps.js";
import { BATTLE_PHASE } from "../../modules/active-battle.js";
import { topNavHtml } from "../../components/top-nav.js";
import { MODEL } from "../../model/model.js";
import { STYLE } from "./style.js";
import { battleCreationHtml } from "./view.js";
import { CHANGE_ACTIONS, CLICK_ACTIONS } from "./actions.js";

const renderBattleCreation = ({ root, router }) => {
  const phase = MODEL.activeBattle.phase;
  if (phase === BATTLE_PHASE.DISPOSITION || phase === BATTLE_PHASE.ACTIVE) {
    router.replace(ROUTES.BATTLE);
    return () => {
    };
  }

  /**
   * Maps can only change on other pages, so a mapId pointing at a deleted map
   * is only observable at mount — normalize once here and render() stays
   * read-only.
   */
  if (!MAPS_MODULE.getMap(MODEL.maps, MODEL.battleConfig.mapId)) {
    BATTLE_CONFIG_MODULE.changeMap(MODEL.battleConfig, MODEL.maps.maps[0]?.id ?? null);
  }

  // local UI state: which unit's modifier combobox is open
  const ui = { comboForUnitId: null };

  const render = () => {
    root.innerHTML = `
      ${topNavHtml(router)}
      ${STYLE}
      ${battleCreationHtml({
      maps: MODEL.maps.maps,
      mapId: MODEL.battleConfig.mapId,
      attacker: MODEL.battleConfig.attacker,
      defender: MODEL.battleConfig.defender,
      modifiers: MODEL.modifiers,
      openComboUnitId: ui.comboForUnitId,
      problems: BATTLE_CONFIG_MODULE.validate(MODEL.battleConfig, MODEL.maps),
    })}
    `;

    if (ui.comboForUnitId !== null) {
      root.querySelector("[data-role=combo-input]")?.focus();
    }
  };

  const ctx = { model: MODEL, ui, router, render };

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");

    if (!el) {
      // click outside an open combobox closes it
      if (ui.comboForUnitId !== null && !event.target.closest("[data-role=combo]")) {
        ui.comboForUnitId = null;
        render();
      }
      return;
    }

    CLICK_ACTIONS[el.dataset.action]?.(ctx, el);
  };

  const onChange = (event) => {
    CHANGE_ACTIONS[event.target.dataset.action]?.(ctx, event.target);
  };

  // typing filters the open combobox locally — no re-render, so focus survives
  const onInput = (event) => {
    if (event.target.dataset.role !== "combo-input") {
      return;
    }

    const query = event.target.value.toLowerCase();
    for (const item of event.target.nextElementSibling.querySelectorAll("li")) {
      item.hidden = !item.textContent.toLowerCase().includes(query);
    }
  };

  const onKeydown = (event) => {
    if (ui.comboForUnitId === null) {
      return;
    }
    if (event.key === "Escape") {
      ui.comboForUnitId = null;
      render();
      return;
    }
    if (event.key === "Enter" && event.target.dataset.role === "combo-input") {
      const first = event.target.nextElementSibling.querySelector("li:not([hidden]) button");
      if (first) {
        CLICK_ACTIONS["pick-modifier"](ctx, first);
      }
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeydown);

  render();

  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    root.removeEventListener("input", onInput);
    root.removeEventListener("keydown", onKeydown);
    root.innerHTML = "";
  };
};

export { renderBattleCreation };
