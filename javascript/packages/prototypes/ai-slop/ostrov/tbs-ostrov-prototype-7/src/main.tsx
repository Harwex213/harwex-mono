import { createRoot } from "react-dom/client";
import { App } from "./ui/app";
import { createRegistry } from "./domain/registry-creator";
import { createStore, StoreProvider } from "./store/store";

const main = () => {
  const container = document.querySelector("#root");
  if (!container) {
    throw new Error("No root was found to mount app");
  }

  const root = createRoot(container);

  const store = createStore();

  const registry = createRegistry(store);

  root.render(
    <StoreProvider value={store}>
      <App registry={registry} />
    </StoreProvider>
  );
};

main();
