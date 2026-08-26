import { createRoot } from "react-dom/client";
import { createMockApi } from "./api/mock-api";
import { createRegistry } from "./domain/registry-creator";
import { createStore, StoreProvider } from "./store/store";
import { App } from "./ui/app";
import "./ui/app.css";

const main = () => {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const root = createRoot(container);

  const store = createStore();

  const api = createMockApi();

  const registry = createRegistry(store, api);

  void registry.loadTreeAction();

  root.render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
