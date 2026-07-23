import { ROUTES } from "../data/routing.js";
import { createMap, deleteMap, setMapImage } from "../state/maps-state/maps-state.js";
import { renderMapThumbnail } from "../lib/map-thumbnail.js";

// attribute-safe interpolation for user-entered text
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * @param {{ store: Store, router: Router }} deps
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
const createMapsStorePage = ({ store, router }) => {
  const el = document.createElement("section");
  el.className = "maps-store";
  el.innerHTML = `
    <h2 class="maps-store-label">Maps Store</h2>
    <hr>
    <div class="maps-store-grid" data-role="grid">
      <button class="maps-store-add" data-action="create">＋ Add</button>
    </div>
  `;
  const gridEl = el.querySelector("[data-role=grid]");
  const addEl = gridEl.querySelector("[data-action=create]");

  const tileEl = (map) => {
    const tile = document.createElement("div");
    tile.className = "maps-store-tile";
    tile.dataset.action = "open";
    tile.dataset.mapId = map.id;
    tile.innerHTML = `
      <div class="maps-store-preview">
        ${map.image ? `<img src="${esc(map.image)}" alt="">` : `<span class="maps-store-glyph">⬡</span>`}
      </div>
      <div class="maps-store-caption">
        <span class="maps-store-name">${esc(map.name)}</span>
        <button class="maps-store-delete" data-action="delete" data-map-id="${map.id}" title="Delete">🗑️</button>
      </div>
    `;
    return tile;
  };

  // one rule covers every stale-preview case (new maps, legacy static-catalog
  // PNG paths, editor sessions whose teardown never ran): a map whose image
  // isn't a generated data URL gets one rendered from its cells and persisted.
  // Runs once at creation — not from render(), a subscriber must not dispatch.
  const staleMaps = store.get().maps.maps.filter((map) => !map.image?.startsWith("data:"));
  if (staleMaps.length > 0) {
    store.set((s) => {
      for (const map of staleMaps) {
        setMapImage(s.maps, map.id, renderMapThumbnail(map));
      }
    });
  }

  const render = (s) => {
    gridEl.replaceChildren(addEl, ...s.maps.maps.map(tileEl));
  };

  el.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    // don't leak the action past the page — a navigation here can mount a
    // legacy page mid-dispatch whose <main> listener would see this event
    event.stopPropagation();

    const mapId = target.dataset.mapId;

    switch (target.dataset.action) {
      case "create": {
        let map;
        store.set((s) => {
          map = createMap(s.maps);
        });
        router.push(ROUTES.MAP_EDITOR, { mapId: map.id });
        break;
      }
      case "open":
        router.push(ROUTES.MAP_EDITOR, { mapId });
        break;
      case "delete":
        if (confirm("Delete this map?")) {
          store.set((s) => deleteMap(s.maps, mapId));
        }
        break;
    }
  });

  const unsubscribe = store.subscribe(render);

  return { el, destroy: unsubscribe };
};

export { createMapsStorePage };
