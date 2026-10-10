import { createRoot } from "react-dom/client";
import { createStore, StoreProvider } from "./store/store";
import { createRegistry } from "./domain/registry-creator";
import { loadState, startPersistence } from "./domain/persistence";
import { App } from "./ui/app";
import "./ui/styles.css";

const main = () => {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const root = createRoot(container);

  const store = createStore(loadState());

  const registry = createRegistry(store);

  startPersistence(store);

  root.render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
