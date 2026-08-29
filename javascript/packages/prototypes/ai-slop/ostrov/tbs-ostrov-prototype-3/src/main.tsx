import { createRoot } from "react-dom/client";
import { INITIAL_SEED, StoreProvider, createStore } from "./store/store";
import { createRegistry } from "./domain/registry-creator";
import { App } from "./ui/app";
import "./index.css";

const main = () => {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  /** `?seed=...` makes a sky shareable as a plain link. */
  const seedText = new URLSearchParams(window.location.search).get("seed") || INITIAL_SEED;
  const store = createStore(seedText);
  const registry = createRegistry(store);

  createRoot(container).render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
