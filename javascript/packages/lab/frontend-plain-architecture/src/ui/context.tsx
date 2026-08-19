import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Registry } from "../registry";
import type { Store } from "../store/types";

// The only two things the UI layer depends on. Both arrive through context, so
// a component can be mounted against any store and any registry — which is the
// whole reason the screenshot harness needs eight lines.

const StoreContext = createContext<Store | null>(null);
const RegistryContext = createContext<Registry | null>(null);

type AppProvidersProps = {
  readonly store: Store;
  readonly registry: Registry;
  readonly children: ReactNode;
};

function AppProviders({ store, registry, children }: AppProvidersProps) {
  return (
    <StoreContext.Provider value={store}>
      <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
    </StoreContext.Provider>
  );
}

function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useStore() was called outside <AppProviders>");
  }
  return store;
}

function useRegistry(): Registry {
  const registry = useContext(RegistryContext);
  if (!registry) {
    throw new Error("useRegistry() was called outside <AppProviders>");
  }
  return registry;
}

export { AppProviders, useRegistry, useStore };
