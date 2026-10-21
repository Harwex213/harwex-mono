import { createRoot } from "react-dom/client";
import { createRegistry } from "../src/actions/index";
import { STATE_KEY, createDatasources, createMemoryStorage } from "../src/datasource/index";
import { StoreProvider, createStore } from "../src/store/index";
import { App } from "../src/app";
import { createFixtureDoc } from "./fixture";
import "../src/index.css";
import "../src/ui/theme.css";

// Entry of the screenshot build. Same as `src/main.tsx`, but storage is in memory.
// It starts with the fixture world, or empty with `?world=empty`. Assets and worker stay real.

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

  const storage = createMemoryStorage();
  const world = new URLSearchParams(window.location.search).get("world");
  if (world !== "empty") {
    storage.setItem(STATE_KEY, JSON.stringify(createFixtureDoc()));
  }
  const hasCountries = world !== "empty";

  const store = createStore();
  const sources = createDatasources({ storage });
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
      if (hasCountries && store.borders.countryStats.peek() === null) {
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
