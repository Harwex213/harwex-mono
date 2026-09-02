import "./index.css";
import { App } from "./ui/app";
import { createRegistry } from "./domain/registry-creator";
import { createRoot } from "react-dom/client";
import { createStore, StoreProvider } from "./store/store";

const main = () => {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const root = createRoot(container);
  const store = createStore();
  const registry = createRegistry(store);

  // Dev hook for scripted play-throughs and debugging in the console.
  (window as Window & { __ostrov?: unknown }).__ostrov = { store, registry };

  root.render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
