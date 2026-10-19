import { signal } from "@preact/signals-react";
import type { BorderTiles } from "../domain/index";
import type { BorderStats } from "../datasource/index";

// The border tiles from the worker. `Path2D` is a drawing object, so the map
// canvas builds paths and the store keeps plain tiles.

type BorderPhase = "idle" | "scanning" | "ready" | "failed";

function createBordersSlice() {
  return {
    phase: signal<BorderPhase>("idle"),
    error: signal<string | null>(null),
    stats: signal<BorderStats | null>(null),
    countryStats: signal<BorderStats | null>(null),
    provinceTiles: signal<BorderTiles | null>(null),
    countryTiles: signal<BorderTiles | null>(null),
  };
}

type TBordersSlice = ReturnType<typeof createBordersSlice>;

export { createBordersSlice, type BorderPhase, type TBordersSlice };
