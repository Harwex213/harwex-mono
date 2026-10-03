import { createRoot } from "react-dom/client";
import { createSession } from "./domain/game-actions";
import { createRegistry } from "./domain/registry-creator";
import { syncRouteFromHash } from "./domain/route-actions";
import { createStore, StoreProvider } from "./store/store";
import { App } from "./ui/app";

const main = () => {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const root = createRoot(container);

  const store = createStore();

  const registry = createRegistry(store);

  // There is no main menu: the game opens straight on the island, in the
  // stage where the player places the stronghold.
  createSession(store);

  // The address bar is the route. One listener reads it back into the store,
  // and the boot sync makes a deep link work on a cold load.
  window.addEventListener("hashchange", () => {
    syncRouteFromHash(store);
  });

  syncRouteFromHash(store);

  root.render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
