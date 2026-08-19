import type { Registry } from "./registry";
import type { Store } from "./store/types";

// The screenshot harness parks the store and the registry on `window`, so a test
// can assert state, or drive a domain function, without going through the UI.
type HarnessHandle = {
  readonly store: Store;
  readonly registry: Registry;
  readonly scenarioName: string;
};

declare global {
  interface Window {
    harness?: HarnessHandle;
  }
}

export type { HarnessHandle };
