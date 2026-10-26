import {
  screenToMap,
  type Point,
  type Province,
} from "../domain/index";
import type { TStore } from "./store";

// Read-only lookups for the UI and the actions.
// Each takes only the slices it reads, so a slice can call it before the store exists.

// `null` outside the map, on the sea and before the load, so callers need no guard.
function provinceAt(store: Pick<TStore, "map">, x: number, y: number): number | null {
  const loaded = store.map.assets.value;
  if (!loaded) {
    return null;
  }
  return loaded.index.provinceAt(x, y);
}

function provinceById(store: Pick<TStore, "map">, id: number): Province | null {
  const byId = store.map.provincesById.value;
  if (!byId) {
    return null;
  }
  return byId.get(id) ?? null;
}

// The last fallback covers the moments before the manifest loads.
function provinceDisplayName(store: Pick<TStore, "map">, id: number): string {
  const province = provinceById(store, id);
  if (province) {
    return province.name;
  }
  return "Province " + id;
}

// Reads with `.peek()` so that it never widens a dependency set. Callers are the
// label computed (already subscribed) and the renderer's frame callback (untracked).
function countryContainsPoint(
  store: Pick<TStore, "map" | "world">,
  countryId: number,
  x: number,
  y: number,
): boolean {
  const loaded = store.map.assets.peek();
  if (!loaded) {
    return false;
  }
  const provinceId = loaded.index.provinceAt(x, y);
  if (provinceId === null) {
    return false;
  }
  return store.world.countryOfProvince.peek().get(provinceId) === countryId;
}

// The integer map pixel under a screen point; `null` off the map or before the view exists.
function mapPixelAt(store: Pick<TStore, "map" | "view">, sx: number, sy: number): Point | null {
  const size = store.map.mapSize.value;
  const port = store.view.viewport.value;
  const current = store.view.view.value;
  if (!size || !current || port.width <= 0 || port.height <= 0) {
    return null;
  }
  const point = screenToMap(current, sx, sy);
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
    return null;
  }
  return { x, y };
}

export { countryContainsPoint, mapPixelAt, provinceAt, provinceById, provinceDisplayName };
