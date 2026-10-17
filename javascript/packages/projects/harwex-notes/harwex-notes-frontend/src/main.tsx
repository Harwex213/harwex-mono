import { createRoot } from "react-dom/client";
import { createMockApi } from "./api/mock-api";
import { createTrpcApi } from "./api/api";
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

  const api = __API_MOCKED__ ? createMockApi() : createTrpcApi(__API_URL__);

  const registry = createRegistry(store, api);

  void registry.loadTreeAction();

  // Switching to another browser tab and closing the page both hide it first. Pending
  // saves go out at that moment instead of after their debounce (DOC-3, APP-6).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      registry.pageHiddenAction();
    }
  });
  window.addEventListener("pagehide", () => {
    registry.pageHiddenAction();
  });

  root.render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
