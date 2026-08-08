import { config } from "@hw/ostrov-prototype-v2-config";
import { computed, signal } from "@preact/signals-react";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import type { IslandMap, Tile } from "../map/island";
import { generateIsland } from "../map/island";
import type { Camera } from "./camera";

const ISLAND_SIZE = config.island.tileCount;

const seed = signal(config.island.seed);
const island = signal<IslandMap>(generateIsland({ seed: seed.value, size: ISLAND_SIZE }));
const camera = signal<Camera>({ x: 0, y: 0, scale: 1 });
const hovered = signal<Axial | null>(null);
const selected = signal<Axial | null>(null);
const dragging = signal(false);

const hoveredTile = computed<Tile | null>(() => {
  const hex = hovered.value;
  if (!hex) {
    return null;
  }
  return island.value.byKey.get(hexKey(hex.q, hex.r)) ?? null;
});

const selectedTile = computed<Tile | null>(() => {
  const hex = selected.value;
  if (!hex) {
    return null;
  }
  return island.value.byKey.get(hexKey(hex.q, hex.r)) ?? null;
});

/** Rebuilds the island from a fresh seed and drops the current selection. */
function reseed(next: number): void {
  seed.value = next >>> 0;
  island.value = generateIsland({ seed: seed.value, size: ISLAND_SIZE });
  selected.value = null;
  hovered.value = null;
}

export { camera, dragging, hovered, hoveredTile, island, reseed, seed, selected, selectedTile };
