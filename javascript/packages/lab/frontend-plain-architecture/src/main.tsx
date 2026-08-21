import { createRoot } from "react-dom/client";
import { createApi } from "./api";
import { createLobbySeed } from "./fixtures/lobby";
import { createRegistry } from "./registry";
import { createStore } from "./store/createStore";
import { App } from "./ui/App";
import { AppProviders } from "./ui/context";
import { ReadyFlag } from "./ui/ReadyFlag";

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
