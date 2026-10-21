import { createRoot } from "react-dom/client";
import { createRegistry } from "./actions/index";
import { createDatasources } from "./datasource/index";
import { StoreProvider, createStore } from "./store/index";
import { App } from "./app";
import "./index.css";

// The composition root: UI -> registry actions -> store and datasources.
const main = () => {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const store = createStore();
  const sources = createDatasources();
  const registry = createRegistry(store, sources);

  // No `StrictMode`: it double-invokes effects, and the map canvas service owns
  // the canvases. A second pass would resize and repaint them twice per change.
  createRoot(container).render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>,
  );
};

main();
