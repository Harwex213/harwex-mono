import { createRoot } from "react-dom/client";
import { App } from "./ui/app";
import { createRegistry } from "./domain/registry-creator";
import { parseHash } from "./store/route-state";
import { createStore, StoreProvider } from "./store/store";
import { installDevHook } from "./dev/dev-hook";

const main = () => {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const root = createRoot(container);

  const store = createStore();

  const registry = createRegistry(store);

  // Always installed: the probe drives the prototype through `window.__ostrov`.
  installDevHook(store, registry);

  // One listener for the whole route. `navigate` rewrites the same hash, which
  // fires no further `hashchange`, so this cannot loop.
  const applyHash = () => {
    const route = parseHash(window.location.hash);
    registry.navigate(route.page, route.viewedPlayerId);
  };

  applyHash();
  window.addEventListener("hashchange", applyHash);

  root.render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
