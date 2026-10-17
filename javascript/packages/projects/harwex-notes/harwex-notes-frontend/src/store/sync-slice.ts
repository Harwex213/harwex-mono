import { signal } from "@preact/signals-react";

// The link to the backend that reports changes made outside the app. "connecting" is the
// first attempt after the page loads; "offline" means contact was lost and the app is
// trying to restore it (SYNC-7).
type TSyncStatus = "connecting" | "online" | "offline";

const createSyncState = () => ({
  status: signal<TSyncStatus>("connecting"),
  // The version on disk of each image that changed while the app was open, by node id. A
  // Markdown image puts it into its URL, so the browser draws the new file instead of the
  // copy it holds (MD-5, SYNC-3).
  imageVersionById: signal<ReadonlyMap<string, string>>(new Map()),
});

type TSyncSlice = ReturnType<typeof createSyncState>;

export type { TSyncSlice, TSyncStatus };
export { createSyncState };
