import { createRoot } from "react-dom/client";
import { StoreProvider, createStore } from "./store/store";
import { createRegistry } from "./domain/registry-creator";
import { App } from "./ui/app";
import "./index.css";

const main = () => {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const root = createRoot(container);
  const store = createStore();
  const registry = createRegistry(store);

  // `?seed=...` makes an island shareable as a plain link.
  const seedText = new URLSearchParams(window.location.search).get("seed");
  registry.startIslandAction(seedText ?? undefined);

  root.render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
