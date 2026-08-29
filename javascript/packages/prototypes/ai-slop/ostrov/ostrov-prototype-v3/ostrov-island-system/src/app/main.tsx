import { createRoot } from "react-dom/client";
import { StoreProvider, createStore } from "./store/store";
import { createRegistry } from "./domain/registry-creator";
import { App } from "./ui/app";
import type { TAppRegistry } from "./domain/registry";
import "./index.css";

/**
 * `?seed=...&land=...` makes a generated island shareable as a plain link.
 * Anything missing or unrecognised is left at its default.
 */
const applyLocation = (registry: TAppRegistry) => {
  const params = new URLSearchParams(window.location.search);
  const seedText = params.get("seed");
  const landCount = Number(params.get("land"));

  if (Number.isFinite(landCount) && landCount > 0) {
    registry.setConfigValueAction("landCount", landCount);
  }

  if (seedText) {
    registry.setSeedTextAction(seedText);
    registry.regenerateIslandAction();
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
