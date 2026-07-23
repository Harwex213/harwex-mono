import { ROUTES } from "../../data/routing.js";
import { changeMap, validateConfig } from "../../state/battle-config.js";
import { getMap } from "../../state/maps.js";
import { BATTLE_PHASE } from "../../state/active-battle.js";
import { mapsHtml, sidesHtml, startHtml } from "./view.js";
import { CHANGE_ACTIONS, CLICK_ACTIONS } from "./actions.js";

const noopPage = () => ({ el: document.createElement("span"), destroy: () => void 0 });

/**
 * @param {{ store: Store, router: Router }} deps
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
const createBattleCreationPage = ({ store, router }) => {
  const phase = store.get().activeBattle.phase;
  if (phase === BATTLE_PHASE.DISPOSITION || phase === BATTLE_PHASE.ACTIVE) {
    router.replace(ROUTES.BATTLE);
    return noopPage();
  }

  /**
   * Maps can only change on other pages, so a mapId pointing at a deleted map
   * is only observable at creation — normalize once here and render() stays
   * read-only.
   */
  if (!getMap(store.get().maps, store.get().battleConfig.mapId)) {
    store.set((s) => changeMap(s.battleConfig, s.maps.maps[0]?.id ?? null));
  }

  // local UI state: which unit's modifier combobox is open
  const ui = { comboForUnitId: null };

  const el = document.createElement("section");
  el.className = "battle-creation";
  el.innerHTML = `
    <h2 class="box-label">Select a map</h2>
    <div class="maps" data-role="maps"></div>
    <hr>
    <h2 class="box-label">Specify units</h2>
    <div class="sides" data-role="sides"></div>
    <div class="start" data-role="start"></div>
  `;
  const mapsEl = el.querySelector("[data-role=maps]");
  const sidesEl = el.querySelector("[data-role=sides]");
  const startEl = el.querySelector("[data-role=start]");

  const render = () => {
    const s = store.get();
    mapsEl.innerHTML = mapsHtml(s.maps.maps, s.battleConfig.mapId);
    sidesEl.innerHTML = sidesHtml(s.battleConfig.attacker, s.battleConfig.defender, {
      modifiers: s.modifiers,
      openComboUnitId: ui.comboForUnitId,
    });
    startEl.innerHTML = startHtml(validateConfig(s.battleConfig, s.maps));

    if (ui.comboForUnitId !== null) {
      el.querySelector("[data-role=combo-input]")?.focus();
    }
  };

  const ctx = { store, ui, router, render };

  // A handled action must not bubble past the page: an action can navigate,
  // and a legacy page mounted mid-dispatch listens on <main> — the still-
  // bubbling event would trigger its same-named data-action handler.
  el.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");

    if (!target) {
      // click outside an open combobox closes it
      if (ui.comboForUnitId !== null && !event.target.closest("[data-role=combo]")) {
        ui.comboForUnitId = null;
        render();
      }
      return;
    }

    event.stopPropagation();
    CLICK_ACTIONS[target.dataset.action]?.(ctx, target);
  });

  el.addEventListener("change", (event) => {
    if (CHANGE_ACTIONS[event.target.dataset.action]) {
      event.stopPropagation();
      CHANGE_ACTIONS[event.target.dataset.action](ctx, event.target);
    }
  });

  // typing filters the open combobox locally — no re-render, so focus survives
  el.addEventListener("input", (event) => {
    if (event.target.dataset.role !== "combo-input") {
      return;
    }

    const query = event.target.value.toLowerCase();
    for (const item of event.target.nextElementSibling.querySelectorAll("li")) {
      item.hidden = !item.textContent.toLowerCase().includes(query);
    }
  });

  el.addEventListener("keydown", (event) => {
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
  });

  const unsubscribe = store.subscribe(render);

  return { el, destroy: unsubscribe };
};

export { createBattleCreationPage };
