import { createRoot } from "react-dom/client";
import { createApi } from "./api";
import { createLobbySeed } from "./fixtures/lobby";
import { createRegistry } from "./registry";
import { createStore } from "./store/createStore";
import { App } from "./ui/App";
import { AppProviders } from "./ui/context";
import { ReadyFlag } from "./ui/ReadyFlag";

// The app entry is the only place that wires the layers together:
//
//   fixtures ─▶ store ─▶ registry(store, api) ─▶ ui
//
// The seed comes from `fixtures/` while the api layer is empty. When the api
// lands, this is the one file that changes.

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing from index.html");
}

const store = createStore(createLobbySeed());
const registry = createRegistry({
  store,
  api: createApi(),
});

createRoot(container).render(
  <AppProviders store={store} registry={registry}>
    <App />
    <ReadyFlag />
  </AppProviders>,
);
