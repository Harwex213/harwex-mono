import { ROUTE_LINKS } from "../data/routing.js";
import { DEFAULT_TERRAIN_ID, TERRAINS } from "../data/terrains.js";
import { commitMap, getMap, renameMap, setMapCell } from "../modules/maps-store.js";
import { topNavHtml } from "../components/top-nav.js";
import { renderPointTopHexagon } from "../modules/hexagon-render.js";
import { gridPixelBounds, offsetToPixel, pixelToOffset } from "../modules/hex-layout.js";

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
const FIT_MARGIN = 24; // css px kept around the fitted map
const ZOOM_STEP = 1.1; // per wheel tick, multiplicative
const ZOOM_OUT_LIMIT = 0.5; // × fit scale
const ZOOM_IN_LIMIT = 8; // × fit scale
const GRID_STROKE_PX = 1; // screen px, constant under zoom
const HOVER_STROKE_PX = 2;

// Camera-driven hex canvas: world coordinates are fixed (hex (0,0) centered on
// the origin), the camera {x, y, scale} maps world → css px and render() bakes
// it into ctx.setTransform together with dpr. Left-drag paints getBrush()'s
// terrain, middle/right-drag pans, wheel zooms anchored at the cursor.
// Returns a cleanup function — the page teardown must call it.
const initializeCanvas = (container, map, getBrush) => {
  const dpr = window.devicePixelRatio;

  // tokens are static — resolve them once, not per frame
  const styles = getComputedStyle(container);
  const fillByTerrain = Object.fromEntries(
    TERRAINS.map((t) => [t.id, styles.getPropertyValue(t.color).trim()]),
  );
  const gridColor = styles.getPropertyValue("--terrain-grid").trim();
  const hoverColor = styles.getPropertyValue("--terrain-hover").trim();

  const bounds = gridPixelBounds(map.width, map.height, HEX_SIZE);
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;

  const camera = { x: 0, y: 0, scale: 1 };
  let fitScale = 1; // basis for the zoom clamp; tracks panel size
  let userMoved = false; // resize refits the camera only until the first pan/zoom
  let hovered = null; // { col, row } under the cursor
  let mode = null; // { type: "pan", lastX, lastY } | { type: "paint", dirty }

  let canvas;
  let ctx;
  let rafId = 0;

  const render = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * camera.x, dpr * camera.y);

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
  };

  // coalesce event floods (pointermove, wheel) into one paint per frame
  const requestRender = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      render();
    });
  };

  const cellAt = (event) => {
    const rect = canvas.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - camera.x) / camera.scale;
    const worldY = (event.clientY - rect.top - camera.y) / camera.scale;
    const { col, row } = pixelToOffset(worldX, worldY, HEX_SIZE);
    const inGrid = row >= 0 && row < map.height && col >= 0 && col < map.width;
    return inGrid ? { col, row } : null;
  };

  const paintAt = (event) => {
    const cell = cellAt(event);
    const brush = getBrush();
    if (!cell || map.cells[cell.row][cell.col] === brush) return;
    setMapCell(map.id, cell.row, cell.col, brush);
    mode.dirty = true;
    requestRender();
  };

  const onPointerDown = (event) => {
    if (mode) return;
    if (event.button === 0) {
      mode = { type: "paint", dirty: false };
      paintAt(event);
    } else if (event.button === 1 || event.button === 2) {
      event.preventDefault(); // middle button would start autoscroll
      mode = { type: "pan", lastX: event.clientX, lastY: event.clientY };
    } else {
      return;
    }
    // last: it throws on synthetic pointers (tests), and losing capture only
    // costs drag-past-the-edge tracking
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (mode?.type === "pan") {
      camera.x += event.clientX - mode.lastX;
      camera.y += event.clientY - mode.lastY;
      mode.lastX = event.clientX;
      mode.lastY = event.clientY;
      userMoved = true;
      requestRender();
      return;
    }
    if (mode?.type === "paint") {
      paintAt(event);
    }
    const cell = cellAt(event);
    if (cell?.col !== hovered?.col || cell?.row !== hovered?.row) {
      hovered = cell;
      requestRender();
    }
  };

  // one stroke = one localStorage write, and only if it changed something
  const onPointerUp = () => {
    if (mode?.type === "paint" && mode.dirty) {
      commitMap();
    }
    mode = null;
  };

  const onPointerLeave = () => {
    if (hovered) {
      hovered = null;
      requestRender();
    }
  };

  const onWheel = (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const scale = Math.min(
      fitScale * ZOOM_IN_LIMIT,
      Math.max(fitScale * ZOOM_OUT_LIMIT, camera.scale * factor),
    );
    if (scale === camera.scale) return;
    // keep the world point under the cursor fixed across the scale change
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    camera.x = screenX - ((screenX - camera.x) / camera.scale) * scale;
    camera.y = screenY - ((screenY - camera.y) / camera.scale) * scale;
    camera.scale = scale;
    userMoved = true;
    requestRender();
  };

  const _initialize = (width, height) => {
    if (!canvas) {
      canvas = document.createElement("canvas");
      container.appendChild(canvas);
      ctx = canvas.getContext("2d");

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      canvas.addEventListener("pointerleave", onPointerLeave);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    fitScale = Math.max(
      0.01,
      Math.min((width - 2 * FIT_MARGIN) / boundsWidth, (height - 2 * FIT_MARGIN) / boundsHeight),
    );
    if (!userMoved) {
      camera.scale = fitScale;
      camera.x = (width - boundsWidth * fitScale) / 2 - bounds.minX * fitScale;
      camera.y = (height - boundsHeight * fitScale) / 2 - bounds.minY * fitScale;
    }

    render();
  };

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === container) {
        const size = entry.contentBoxSize[0];

        if (size) {
          _initialize(size.inlineSize, size.blockSize);
        }
      }
    }
  });
  resizeObserver.observe(container);

  return () => {
    resizeObserver.disconnect();
    if (rafId) cancelAnimationFrame(rafId);
  };
};

const renderMapEditor = (params = {}) => {
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
        ${topNavHtml()}
        ${STYLE}
        <section class="me">
          <p class="missing">Map not found.</p>
          <a href="${ROUTE_LINKS.MAPS}">← Back to maps</a>
        </section>
      `;
      return;
    }

    root.innerHTML = `
      ${topNavHtml()}
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
  const map = getMap(mapId);

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
      renameMap(mapId, event.target.value);
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);

  return () => {
    teardownCanvas?.();
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.innerHTML = "";
  };
};

export { renderMapEditor };
