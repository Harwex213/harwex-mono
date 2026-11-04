import { signal } from "@preact/signals-react";
import type { ServerMap } from "../../datasource/index";
import type { ServerLayout } from "../../domain/index";

// The backend: the maps dialog, the map opened from it, and what that map holds
// there.

type ServerMapsState = {
  status: "loading" | "ready" | "failed";
  maps: ServerMap[];
  error: string | null;
  // A new map being uploaded, and why the last upload failed.
  creating: boolean;
  createError: string | null;
};

function createServerSlice() {
  // The open maps dialog, or `null` when it is closed.
  const dialog = signal<ServerMapsState | null>(null);
  // Bumped on every open and close, so a late answer to a closed dialog is dropped.
  const requestId = signal(0);
  // The map the editor shows, when it came from the backend. A map from the
  // asset library or a drop has none, and cannot be saved.
  const map = signal<ServerMap | null>(null);
  // The countries and provinces stored for `map`, as last fetched.
  const layout = signal<ServerLayout | null>(null);

  return { dialog, requestId, map, layout };
}

type TServerSlice = ReturnType<typeof createServerSlice>;

export {
  createServerSlice,
  type ServerMapsState,
  type TServerSlice,
};
