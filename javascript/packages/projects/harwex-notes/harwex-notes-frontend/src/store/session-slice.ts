import { signal } from "@preact/signals-react";
import type { TJsonValue } from "@hw/harwex-notes-protocol";

// UI state the backend keeps across reloads (SESS). The tree part of it (expanded folders,
// selected row) lives in the fs slice and is saved from there; this slice holds the rest.
const createSessionState = () => ({
  // App-wide settings by key, loaded once with the tree.
  settings: signal<Readonly<Record<string, TJsonValue>>>({}),
  // The last failed save of a setting. Session state is secondary, so it never blocks work.
  error: signal<string | null>(null),
});

type TSessionSlice = ReturnType<typeof createSessionState>;

export type { TSessionSlice };
export { createSessionState };
