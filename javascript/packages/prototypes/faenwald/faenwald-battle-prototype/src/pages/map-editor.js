import { ROUTE_LINKS } from "../data/routing.js";
import { DEFAULT_TERRAIN_ID, TERRAINS } from "../data/terrains.js";
import { commitMap, getMap, renameMap, setMapCell, setMapImage } from "../state/maps.js";
import { renderMapThumbnail } from "../lib/map-thumbnail.js";
import { renderPointTopHexagon } from "../lib/hexagon-render.js";
import { gridPixelBounds, offsetToPixel, pixelToOffset } from "../lib/hex-layout.js";
import { initializeAbstractCanvas } from "../lib/abstract-canvas.js";

// swatch fills come from data, but inline style="" is banned — generate one
// scoped rule per terrain instead, each referencing its semantic token; the
// static rules live in map-editor.css, these can't (they're data-driven)
const SWATCH_RULES = TERRAINS.map(
  (t) => `.map-editor .swatch--${t.id} {
      background: var(${t.color});
    }`,
).join("\n\n    ");

// attribute-safe interpolation for user-entered text
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const HEX_HEIGHT = 128; // world units, top vertex to bottom vertex
const HEX_SIZE = HEX_HEIGHT / 2; // circumradius
const GRID_STROKE_PX = 1; // screen px, constant under zoom
const HOVER_STROKE_PX = 2;

const initializeCanvas = (container, map, getBrush, store) => {
  // tokens are static — resolve them once, not per frame
  const styles = getComputedStyle(container);
  const fillByTerrain = Object.fromEntries(
    TERRAINS.map((t) => [t.id, styles.getPropertyValue(t.color).trim()]),
  );
  const gridColor = styles.getPropertyValue("--terrain-grid").trim();
  const hoverColor = styles.getPropertyValue("--terrain-hover").trim();

  let dirty = false; // did this stroke change any cell?

  const paintAt = ({ target, requestRender }) => {
    const brush = getBrush();
    if (!target || map.cells[target.row][target.col] === brush) {
      return;
    }
    // in-memory only (no rev bump), so a drag isn't a storage write per hex —
    // the canvas repaints itself, no store notification needed
    setMapCell(store.get().maps, map.id, target.row, target.col, brush);
    dirty = true;
    requestRender();
  };

  const { destroy } = initializeAbstractCanvas(container, {
    worldBounds: gridPixelBounds(map.width, map.height, HEX_SIZE),

    hitTest: (worldX, worldY) => {
      const { col, row } = pixelToOffset(worldX, worldY, HEX_SIZE);
      const inGrid = row >= 0 && row < map.height && col >= 0 && col < map.width;
      return inGrid ? { col, row } : null;
    },

    onActionStart: (state) => {
      dirty = false;
      paintAt(state);
    },

    onActionMove: paintAt,

    // one stroke = one localStorage write, and only if it changed something
    onActionEnd: () => {
      if (dirty) {
        store.set((s) => commitMap(s.maps, map.id));
      }
    },

    render: ({ ctx, camera, hovered }) => {
      for (let row = 0; row < map.height; row++) {
        for (let col = 0; col < map.width; col++) {
          const { x, y } = offsetToPixel(col, row, HEX_SIZE);
          renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
            fill: { style: fillByTerrain[map.cells[row][col]] ?? fillByTerrain[DEFAULT_TERRAIN_ID] },
            stroke: { style: gridColor, width: GRID_STROKE_PX / camera.scale },
          });
        }
      }

      if (hovered) {
        const { x, y } = offsetToPixel(hovered.col, hovered.row, HEX_SIZE);
        renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
          stroke: { style: hoverColor, width: HOVER_STROKE_PX / camera.scale },
        });
      }
    },
  });

  return destroy;
};

/**
 * @param {{ store: Store, router: Router, params: { mapId?: string } }} deps
 * @returns {{ el: HTMLElement, mount?: () => void, destroy: () => void }}
 */
const createMapEditorPage = ({ store, router, params = {} }) => {
  const mapId = params.mapId;
  const map = getMap(store.get().maps, mapId);

  const el = document.createElement("section");
  el.className = "map-editor";

  if (!map) {
    el.innerHTML = `
      <p class="missing">Map not found.</p>
      <a href="${ROUTE_LINKS.MAPS}">← Back to maps</a>
    `;
    return { el, destroy: () => void 0 };
  }

  // transient UI state: the brush terrain the canvas paints with
  let selectedTerrainId = DEFAULT_TERRAIN_ID;

  const terrainHtml = (terrain) => `
    <button class="terrain ${terrain.id === selectedTerrainId ? "terrain--selected" : ""}"
            data-action="select-terrain" data-terrain-id="${terrain.id}">
      <span class="swatch swatch--${terrain.id}"></span>
      <span>${terrain.name}</span>
    </button>
  `;

  const paletteHtml = () => `
    <div class="palette-title">Terrain</div>
    ${TERRAINS.map(terrainHtml).join("")}
  `;

  el.innerHTML = `
    <style>${SWATCH_RULES}</style>
    <div class="header">
      <a href="${ROUTE_LINKS.MAPS}">← Maps</a>
      <input class="map-name" data-role="map-name" value="${esc(map.name)}" placeholder="map name">
      <span class="dims">${map.width} × ${map.height} hexes</span>
    </div>
    <div class="workspace">
      <div class="canvas-panel" data-role="canvas-panel"></div>
      <aside class="palette" data-role="palette">
        ${paletteHtml()}
      </aside>
    </div>
  `;
  const nameEl = el.querySelector("[data-role=map-name]");
  const canvasPanelEl = el.querySelector("[data-role=canvas-panel]");
  const paletteEl = el.querySelector("[data-role=palette]");

  el.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    event.stopPropagation();

    switch (target.dataset.action) {
      case "select-terrain":
        selectedTerrainId = target.dataset.terrainId;
        paletteEl.innerHTML = paletteHtml();
        break;
    }
  });

  // live rename commits on every keystroke; muted from repaint — nothing on the
  // page derives from the name, and repainting would drop the caret
  let muteRender = false;
  el.addEventListener("input", (event) => {
    if (event.target.dataset.role === "map-name") {
      muteRender = true;
      store.set((s) => renameMap(s.maps, mapId, event.target.value));
      muteRender = false;
    }
  });

  const render = (s) => {
    if (muteRender) {
      return;
    }
    const current = getMap(s.maps, mapId);
    if (current && document.activeElement !== nameEl) {
      nameEl.value = current.name;
    }
  };

  // canvas init needs the element laid out and computed styles resolvable —
  // both require being in the document, hence mount(), not creation time
  let teardownCanvas = null;
  const mount = () => {
    teardownCanvas = initializeCanvas(canvasPanelEl, map, () => selectedTerrainId, store);
  };

  const unsubscribe = store.subscribe(render);

  const destroy = () => {
    teardownCanvas?.();
    unsubscribe();
    // one generation per editing session; commitMap() dropped the image on the
    // first stroke, and the maps page covers sessions this teardown never ends
    store.set((s) => setMapImage(s.maps, map.id, renderMapThumbnail(map)));
  };

  return { el, mount, destroy };
};

export { createMapEditorPage };
