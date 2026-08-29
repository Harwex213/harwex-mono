import type { TVaultLock } from "./vault-lock.types.js";

// Default for the in-memory vault and for tests: FsDataAccess already serialises
// callers through its own queue, so nothing extra is needed.
const createPassthroughVaultLock = (): TVaultLock => {
  return { runExclusive: (task) => task() };
};

export { createPassthroughVaultLock };
