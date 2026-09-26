import { hashFor } from "../store/route-state";
import type { TPage } from "../store/route-state";
import type { TStore } from "../store/store";

/**
 * Sets the route signals and writes the address bar. Writing the same hash back
 * fires no `hashchange`, so the listener in `main.tsx` may call this freely.
 */
const navigateAction = (store: TStore, page: TPage, playerId: string | null = null): void => {
  const viewedPlayerId = page === "island" ? playerId : null;

  store.route.page.value = page;
  store.route.viewedPlayerId.value = viewedPlayerId;

  const hash = hashFor(page, viewedPlayerId);
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
};

export { navigateAction };
