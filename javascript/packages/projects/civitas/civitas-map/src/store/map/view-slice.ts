import { signal } from "@preact/signals-react";
import type { View } from "../../domain/index";

// The camera and the size of the canvas it looks through.

function createViewSlice() {
  const view = signal<View>({ scale: 1, x: 0, y: 0 });
  // In CSS pixels. `{ 1, 1 }` until the canvas has been measured.
  const viewport = signal({ width: 1, height: 1 });
  // A map can finish loading before the canvas has been measured. A fit asked
  // for then waits here until `measureViewport` runs.
  const fitPending = signal(false);

  return { view, viewport, fitPending };
}

type TViewSlice = ReturnType<typeof createViewSlice>;

export {
  createViewSlice,
  type TViewSlice,
};
