import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { DEFAULT_PARAMS } from "../domain/generator/params";
import type { TGeneratorParams, THexMap } from "../domain/generator/types";

/** Everything the generator reads and writes: its input and its last output. */
const createGeneratorState = () => ({
  params: signal<TGeneratorParams>(DEFAULT_PARAMS),
  map: signal<THexMap | null>(null),
});

/**
 * Everything that only changes how the finished map is drawn. `cameraX` and
 * `cameraY` are in unit world space — the map's pixel layout at a hex size of
 * one — and `zoom` is how many screen pixels one of those units is worth.
 */
const createViewState = () => ({
  zoom: signal(1),
  cameraX: signal(0),
  cameraY: signal(0),
  viewportWidth: signal(0),
  viewportHeight: signal(0),
  hoveredIndex: signal(-1),
  selectedIslandId: signal(-1),
  showGrid: signal(true),
  showIslandOutlines: signal(true),
  showElevationShading: signal(true),
});

const createStore = () => ({
  generatorState: createGeneratorState(),
  viewState: createViewState(),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { StoreProvider, createStore, useStore };
