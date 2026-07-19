import { ROUTES } from "../data/routing.js";
import { MAPS_MODULE } from "../modules/maps.js";
import { renderMapThumbnail } from "../modules/map-thumbnail.js";
import { topNavHtml } from "../components/top-nav.js";
import { MODEL } from "../model/model.js";

const STYLE = `
  <style>
    .msp { font-family: var(--font-body); color: var(--text-primary); padding: var(--space-8); }
    .msp .box-label { display: inline-block; margin: 0 0 var(--space-7); padding: var(--space-5) var(--space-8); font-family: var(--font-display); font-size: var(--font-size-xl); font-weight: var(--font-weight-normal); color: var(--text-accent); }
    .msp hr { border: none; border-top: 1px solid var(--border-default); margin: 0 0 var(--space-7); }
    .msp .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--space-8) var(--space-7); align-items: start; }
    .msp .tile { display: flex; flex-direction: column; gap: var(--space-4); cursor: pointer; }
    .msp .preview { height: 120px; display: flex; align-items: center; justify-content: center; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--card-radius); overflow: hidden; }
    .msp .preview img { width: 100%; height: 100%; object-fit: contain; }
    .msp .tile:hover .preview { border-color: var(--border-accent-muted); }
    .msp .glyph { font-size: var(--font-size-xl); color: var(--text-faint); }
    .msp .caption { display: flex; align-items: center; gap: var(--space-4); }
    .msp .name { flex: 1; padding: var(--space-4) var(--space-6); border: 1px solid var(--border-default); border-radius: var(--radius-sm); text-align: center; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .msp .delete { font: inherit; color: var(--text-primary); background: var(--bg-control); border: 1px solid var(--border-medium); border-radius: var(--radius-sm); padding: var(--space-4) var(--space-5); cursor: pointer; }
    .msp .delete:hover { background: var(--bg-control-hover); }
    .msp .add { height: 120px; display: flex; align-items: center; justify-content: center; font: inherit; color: var(--text-primary); background: var(--bg-control-subtle); border: 1px dashed var(--border-medium); border-radius: var(--card-radius); cursor: pointer; }
    .msp .add:hover { background: var(--bg-control-subtle-hover); border-color: var(--border-accent-muted); }
  </style>
`;

// attribute-safe interpolation for user-entered text
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderMapsStore = (params, router) => {
  const root = document.querySelector("main");

  const tileHtml = (map) => `
    <div class="tile" data-action="open" data-map-id="${map.id}">
      <div class="preview">
        ${map.image ? `<img src="${esc(map.image)}" alt="">` : `<span class="glyph">⬡</span>`}
      </div>
      <div class="caption">
        <span class="name">${esc(map.name)}</span>
        <button class="delete" data-action="delete" data-map-id="${map.id}" title="Delete">🗑️</button>
      </div>
    </div>
  `;

  // one rule covers every stale-preview case (new maps, legacy static-catalog
  // PNG paths, editor sessions whose teardown never ran): a map whose image
  // isn't a generated data URL gets one rendered from its cells and persisted
  const refreshThumbnails = () => {
    for (const map of MODEL.maps.maps) {
      if (!map.image?.startsWith("data:")) {
        MAPS_MODULE.setMapImage(MODEL.maps, map.id, renderMapThumbnail(map));
      }
    }
  };

  const render = () => {
    refreshThumbnails();
    root.innerHTML = `
      ${topNavHtml(router)}
      ${STYLE}
      <section class="msp">
        <h2 class="box-label">Maps Store</h2>
        <hr>
        <div class="grid">
          <button class="add" data-action="create">＋ Add</button>
          ${MODEL.maps.maps.map(tileHtml).join("")}
        </div>
      </section>
    `;
  };

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;

    const mapId = el.dataset.mapId;

    switch (el.dataset.action) {
      case "create": {
        const map = MAPS_MODULE.createMap(MODEL.maps);
        router.push(ROUTES.MAP_EDITOR, { mapId: map.id });
        break;
      }
      case "open":
        router.push(ROUTES.MAP_EDITOR, { mapId });
        break;
      case "delete":
        if (confirm("Delete this map?")) {
          MAPS_MODULE.deleteMap(MODEL.maps, mapId);
          render();
        }
        break;
    }
  };

  root.addEventListener("click", onClick);
  render();

  return () => {
    root.removeEventListener("click", onClick);
    root.innerHTML = "";
  };
};

export { renderMapsStore };
