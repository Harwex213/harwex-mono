import { createBattleCreationPage } from "./pages/battle-creation/battle-creation.js";
import { createModifiersCollectionPage } from "./pages/modifiers-collection.js";
import { createModifiersTablePage } from "./pages/modifiers-table.js";
import { createMapsStorePage } from "./pages/maps-store.js";
import { createMapEditorPage } from "./pages/map-editor.js";
import { battlePhaseRoute } from "./pages/battle/battle.js";
import { createBattleDispositionPage } from "./pages/battle/battle-disposition.js";
import { createBattleActivePage } from "./pages/battle/battle-active.js";
import { createBattleFinishedPage } from "./pages/battle/battle-finished.js";
import { Router } from "./router.js";
import { ROUTES } from "./data/routing.js";
import { createStore } from "./store.js";
import { createInitialState } from "./state/app-state.js";
import { createTopNav } from "./components/top-nav.js";
import { MAPS_LS_KEY, MODIFIERS_LS_KEY } from "./data/local-storage-keys.js";
import { hydrateMaps, serializeMaps } from "./state/maps-state/maps-state.js";
import { hydrateModifiers, serializeModifiers } from "./state/modifiers-state/modifiers-state.js";
import { createBattleConfig } from "./state/battle-config-state/battle-config-state.js";

const voidFn = () => void 0;

// Pages: createXPage({ store, router, params }) → { el, destroy }. Pages that
// must measure layout or resolve computed styles (canvas) also return an
// optional mount(), called right after el is inserted into <main>.
const PAGES = [
  [ROUTES.BATTLE_CREATION, createBattleCreationPage],
  [ROUTES.BATTLE_DISPOSITION, createBattleDispositionPage],
  [ROUTES.BATTLE_ACTIVE, createBattleActivePage],
  [ROUTES.BATTLE_FINISHED, createBattleFinishedPage],
  [ROUTES.MODIFIERS_COLLECTIONS, createModifiersCollectionPage],
  [ROUTES.MODIFIERS, createModifiersTablePage],
  [ROUTES.MAPS, createMapsStorePage],
  [ROUTES.MAP_EDITOR, createMapEditorPage],
];

const registerAllPages = (root, router, store) => {
  let finalizePage = voidFn;
  let navToken = 0;

  const registerPage = (pageRoute, createPage) => {
    router.registerRoute(pageRoute, (params) => {
      finalizePage();
      finalizePage = voidFn; // a re-entrant resolve must not re-run this teardown
      const myToken = ++navToken;
      const page = createPage({ store, router, params });
      if (myToken !== navToken) {
        // a nested navigation replaced us — don't clobber its DOM or teardown
        page.destroy();
        return;
      }
      root.replaceChildren(page.el);
      page.mount?.();
      finalizePage = () => page.destroy();
    });
  };

  for (const [pageRoute, createPage] of PAGES) {
    registerPage(pageRoute, createPage);
  }

  router.registerRoute(ROUTES.ROOT, () => {
    router.replace(ROUTES.BATTLE_CREATION);
  });

  router.registerRoute(ROUTES.BATTLE, () => {
    router.replace(battlePhaseRoute(store.get().activeBattle));
  });
};

/**
 * The composition root is the only place the environment (localStorage) is
 * touched. Actions are pure; a mutator that must reach storage bumps its
 * domain's `rev`, and this subscriber writes the domain out when the rev
 * moves. Subscribed before hydration so a seeding hydrate (rev bump) writes
 * the seeds back.
 */
const attachPersister = (store) => {
  let mapsRev = store.get().maps.rev;
  let modifiersRev = store.get().modifiers.rev;
  store.subscribe((s) => {
    if (s.maps.rev !== mapsRev) {
      mapsRev = s.maps.rev;
      localStorage.setItem(MAPS_LS_KEY, serializeMaps(s.maps));
    }
    if (s.modifiers.rev !== modifiersRev) {
      modifiersRev = s.modifiers.rev;
      localStorage.setItem(MODIFIERS_LS_KEY, serializeModifiers(s.modifiers));
    }
  });
};

const main = () => {
  const store = createStore(createInitialState());

  attachPersister(store);
  store.set((s) => {
    hydrateMaps(s.maps, localStorage.getItem(MAPS_LS_KEY));
    hydrateModifiers(s.modifiers, localStorage.getItem(MODIFIERS_LS_KEY));
    // persistence-backed state hydrates before battleConfig reads it for its default map
    s.battleConfig = createBattleConfig(s.maps);
  });

  const root = document.querySelector("main");
  const router = new Router();

  const topNav = createTopNav({ store, router });
  document.body.prepend(topNav.el);

  registerAllPages(root, router, store);
};

main();
