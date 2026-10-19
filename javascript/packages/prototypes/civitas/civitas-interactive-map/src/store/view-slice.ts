import { signal } from "@preact/signals-react";
import type { Point, View } from "../domain/index";

// The camera. Session state, never persisted.

type Viewport = { width: number; height: number };

function createViewSlice() {
  return {
    // `null` until the map size and a non-zero viewport are both known.
    // A fake default would render one wrong frame.
    view: signal<View | null>(null),
    viewport: signal<Viewport>({ width: 0, height: 0 }),
    dpr: signal(1),
    // The integer map pixel under the pointer.
    cursorMap: signal<Point | null>(null),
    panning: signal(false),
    // True at the fit scale. A resize re-fits a fitted view and keeps the scale
    // of a zoomed one. The view actions derive it on every write, so it never goes stale.
    viewFitted: signal(true),
  };
}

type TViewSlice = ReturnType<typeof createViewSlice>;

export { createViewSlice, type TViewSlice, type Viewport };
