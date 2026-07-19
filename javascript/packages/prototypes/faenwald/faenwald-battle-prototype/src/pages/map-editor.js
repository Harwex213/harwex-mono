import { ROUTE_LINKS } from "../data/routing.js";
import { DEFAULT_TERRAIN_ID, TERRAINS } from "../data/terrains.js";
import { MAPS_MODULE } from "../modules/maps.js";
import { MODEL } from "../model/model.js";
import { renderMapThumbnail } from "../modules/map-thumbnail.js";
import { topNavHtml } from "../components/top-nav.js";
import { renderPointTopHexagon } from "../modules/hexagon-render.js";
import { gridPixelBounds, offsetToPixel, pixelToOffset } from "../modules/hex-layout.js";
import { initializeAbstractCanvas } from "../modules/abstract-canvas.js";

// swatch fills come from data, but inline style="" is banned — generate one
// scoped rule per terrain instead, each referencing its semantic token
const SWATCH_RULES = TERRAINS.map((t) => `.me .swatch--${t.id} { background: var(${t.color}); }`).join("\n    ");

const STYLE = `
  <style>
    .me { font-family: var(--font-body); color: var(--text-primary); padding: var(--space-8); }
    .me a { color: var(--text-secondary); }
    .me a:hover { color: var(--text-primary); }
    .me .header { display: flex; align-items: center; gap: var(--space-7); margin-bottom: var(--space-7); }
    .me .map-name { min-width: 240px; font: inherit; color: var(--text-primary); background: var(--bg-control); border: 1px solid var(--border-medium); border-radius: var(--radius-sm); padding: var(--space-4) var(--space-6); }
    .me .map-name:focus { border-color: var(--border-accent-muted); outline: none; }
    .me .dims { color: var(--text-muted); }
    .me .workspace { display: grid; grid-template-columns: minmax(0, 1fr) 240px; grid-template-rows: 1fr; gap: var(--space-8); align-items: start; }
    .me .canvas-panel { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--card-bg); border: 1px dashed var(--border-medium); border-radius: var(--card-radius); }
    .me .canvas-panel canvas { cursor: crosshair; touch-action: none; }
    .me .palette { display: flex; flex-direction: column; gap: var(--space-2); background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--card-radius); padding: var(--space-6); }
    .me .palette-title { font-family: var(--font-display); color: var(--text-accent); padding: var(--space-2) var(--space-4) var(--space-4); }
    .me .terrain { display: flex; align-items: center; gap: var(--space-5); font: inherit; text-align: left; color: var(--text-secondary); background: none; border: 1px solid transparent; border-radius: var(--radius-sm); padding: var(--space-4) var(--space-5); cursor: pointer; }
    .me .terrain:hover { color: var(--text-primary); background: var(--bg-control-subtle-hover); }
    .me .terrain--selected { color: var(--text-primary); background: var(--bg-accent); border-color: var(--border-accent-muted); }
    .me .swatch { width: 18px; height: 18px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); }
    ${SWATCH_RULES}
    .me .missing { color: var(--text-muted); }
  </style>
`;

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

const initializeCanvas = (container, map, getBrush) => {
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
    MAPS_MODULE.setMapCell(MODEL.maps, map.id, target.row, target.col, brush);
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
        MAPS_MODULE.commitMap(MODEL.maps, map.id);
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

const renderMapEditor = (params = {}, router) => {
  // transient UI state: the brush terrain the canvas paints with
  let selectedTerrainId = DEFAULT_TERRAIN_ID;

  const PALETTE_ASIDE_ID = "me-palette";
  const MAP_EDITOR_ID = "map-editor";

  const terrainHtml = (terrain) => `
    <button class="terrain ${terrain.id === selectedTerrainId ? "terrain--selected" : ""}"
            data-action="select-terrain" data-terrain-id="${terrain.id}">
      <span class="swatch swatch--${terrain.id}"></span>
      <span>${terrain.name}</span>
    </button>
  `;

  const asideHtml = () => `
    <div class="palette-title">Terrain</div>
    ${TERRAINS.map(terrainHtml).join("")}
  `

  const mapEditorHtml = (root, map) => {
    if (!map) {
      root.innerHTML = `
        ${topNavHtml(router)}
        ${STYLE}
        <section class="me">
          <p class="missing">Map not found.</p>
          <a href="${ROUTE_LINKS.MAPS}">← Back to maps</a>
        </section>
      `;
      return;
    }

    root.innerHTML = `
      ${topNavHtml(router)}
      ${STYLE}
      <section class="me">
        <div class="header">
          <a href="${ROUTE_LINKS.MAPS}">← Maps</a>
          <input class="map-name" data-role="map-name" value="${esc(map.name)}" placeholder="map name">
          <span class="dims">${map.width} × ${map.height} hexes</span>
        </div>
        <div class="workspace">
          <div id="${MAP_EDITOR_ID}" class="canvas-panel">
          </div>
          <aside id="${PALETTE_ASIDE_ID}" class="palette">
            ${asideHtml()}
          </aside>
        </div>
      </section>
    `;
  };

  const root = document.querySelector("main");
  const mapId = params.mapId;
  const map = MAPS_MODULE.getMap(MODEL.maps, mapId);

  mapEditorHtml(root, map);

  const aside = document.getElementById(PALETTE_ASIDE_ID);
  const mapEditor = document.getElementById(MAP_EDITOR_ID);

  const teardownCanvas = map ? initializeCanvas(mapEditor, map, () => selectedTerrainId) : null;

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) {
      return;
    }

    switch (el.dataset.action) {
      case "select-terrain":
        selectedTerrainId = el.dataset.terrainId;
        aside.innerHTML = asideHtml();
        break;
    }
  };

  // live rename commits on every keystroke; no re-render — nothing on the page
  // derives from the name, and repainting would drop the caret (see modifiers-table)
  const onInput = (event) => {
    if (event.target.dataset.role === "map-name") {
      MAPS_MODULE.renameMap(MODEL.maps, mapId, event.target.value);
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);

  return () => {
    teardownCanvas?.();
    // one generation per editing session; commitMap() dropped the image on the
    // first stroke, and the maps page covers sessions this teardown never ends
    if (map) {
      MAPS_MODULE.setMapImage(MODEL.maps, map.id, renderMapThumbnail(map));
    }
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.innerHTML = "";
  };
};

export { renderMapEditor };
