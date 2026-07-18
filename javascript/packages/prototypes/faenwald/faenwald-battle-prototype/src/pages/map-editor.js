import { ROUTE_LINKS } from "../data/routing.js";
import { TERRAINS, DEFAULT_TERRAIN_ID } from "../data/terrains.js";
import { getMap, renameMap } from "../modules/maps-store.js";
import { topNavHtml } from "../components/top-nav.js";

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
    .me .workspace { display: grid; grid-template-columns: 1fr 240px; gap: var(--space-8); align-items: start; }
    .me .canvas-panel { min-height: 520px; display: flex; align-items: center; justify-content: center; background: var(--card-bg); border: 1px dashed var(--border-medium); border-radius: var(--card-radius); }
    .me .placeholder { color: var(--text-muted); }
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

const renderMapEditor = (params = {}) => {
  const root = document.querySelector("main");
  const mapId = params.mapId;

  // transient UI state: the brush terrain; selectable now, paints nothing
  // until the canvas renderer lands
  let selectedTerrainId = DEFAULT_TERRAIN_ID;

  const terrainHtml = (terrain) => `
    <button class="terrain ${terrain.id === selectedTerrainId ? "terrain--selected" : ""}"
            data-action="select-terrain" data-terrain-id="${terrain.id}">
      <span class="swatch swatch--${terrain.id}"></span>
      <span>${terrain.name}</span>
    </button>
  `;

  const render = () => {
    const map = getMap(mapId);

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
          <div class="canvas-panel">
            <span class="placeholder">Hex canvas — coming soon</span>
          </div>
          <aside class="palette">
            <div class="palette-title">Terrain</div>
            ${TERRAINS.map(terrainHtml).join("")}
          </aside>
        </div>
      </section>
    `;
  };

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;

    switch (el.dataset.action) {
      case "select-terrain":
        selectedTerrainId = el.dataset.terrainId;
        render();
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
  render();

  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.innerHTML = "";
  };
};

export { renderMapEditor };
