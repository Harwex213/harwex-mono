import { signal } from "@preact/signals-react";
import type { MapImage } from "../../datasource/index";

// The map library dialog.

// What a pick in the map library does: open the image as the base map, or load
// it as a provinces export into the open map.
type LibraryMode = "map" | "provinces";

type LibraryState = {
  mode: LibraryMode;
  status: "loading" | "ready" | "failed";
  images: MapImage[];
  error: string | null;
};

function createLibrarySlice() {
  // The open dialog, or `null` when it is closed.
  const state = signal<LibraryState | null>(null);
  // Bumped on every open and close, so the answer of a list request the
  // operator has already closed or reopened the dialog over is dropped.
  const requestId = signal(0);

  return { state, requestId };
}

type TLibrarySlice = ReturnType<typeof createLibrarySlice>;

export {
  createLibrarySlice,
  type LibraryMode,
  type LibraryState,
  type TLibrarySlice,
};
