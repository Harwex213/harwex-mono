import { createRoot } from "react-dom/client";
import { createRegistry } from "../src/actions/index";
import { createDatasources } from "../src/datasource/index";
import { StoreProvider, createStore } from "../src/store/index";
import { App } from "../src/app";
import "../src/index.css";
import "../src/ui/theme.css";

// Entry of the screenshot build. Same as `src/main.tsx`, plus a readiness hook.
// The tests serve `assets/countries.json` through `page.route`. Assets and worker stay real.

type E2EHook = {
  ready(): boolean;
};

declare global {
  interface Window {
    __civitasE2E?: E2EHook;
  }
}

const main = () => {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const store = createStore();
  const sources = createDatasources();
  const registry = createRegistry(store, sources);

  // The tests poll this. Ready means assets loaded and the border scans finished.
  window.__civitasE2E = {
    ready(): boolean {
      if (store.map.phase.peek() !== "ready") {
        return false;
      }
      if (store.borders.phase.peek() !== "ready") {
        return false;
      }
      if (store.world.countries.peek().length > 0 && store.borders.countryStats.peek() === null) {
        return false;
      }
      return true;
    },
  };

  createRoot(container).render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>,
  );
};

main();
