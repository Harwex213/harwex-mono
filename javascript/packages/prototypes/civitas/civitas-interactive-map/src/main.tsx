import { createRoot } from "react-dom/client";
import { createRegistry } from "./actions/index";
import { createDatasources } from "./datasource/index";
import { StoreProvider, createStore } from "./store/index";
import { App } from "./app";
import "./index.css";
// After `./index.css`, so its `:root` block wins and maps the base palette onto `--civ-*`.
import "./ui/theme.css";

// The composition root: UI -> registry actions -> store and datasources.
const main = () => {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const store = createStore();
  const sources = createDatasources();
  const registry = createRegistry(store, sources);

  // No `StrictMode`: its double effects would resize and repaint each canvas twice.
  createRoot(container).render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>,
  );
};

main();
