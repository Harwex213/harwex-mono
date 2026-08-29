import { App } from "./ui/app";
import { StoreProvider, createStore } from "./store/store";
import { createRegistry } from "./domain/registry-creator";
import { createRoot } from "react-dom/client";
import type { TAppRegistry } from "./domain/registry";
import "./index.css";

/**
 * `?seed=...` makes a generated world shareable as a plain link. Anything
 * missing or unrecognised is left at its default.
 */
const applyLocation = (registry: TAppRegistry) => {
  const params = new URLSearchParams(window.location.search);
  const seedText = params.get("seed");

  if (seedText) {
    registry.setSeedTextAction(seedText);
    registry.regenerateWorldAction();
  }
};

const main = () => {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const root = createRoot(container);
  const store = createStore();
  const registry = createRegistry(store);

  applyLocation(registry);

  root.render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
