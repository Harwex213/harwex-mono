import { STAT_META } from "../../data/unit.js";
import { ROUTE_LINKS, ROUTES } from "../../data/routing.js";
import { DEFAULT_TERRAIN_ID, TERRAINS } from "../../data/terrains.js";
import { getMap } from "../../state/maps-state/maps-state.js";
import { BATTLE_PHASE } from "../../data/battle.js";
import { findUnit, startBattle, unitAt } from "../../state/active-battle-state/active-battle-state.js";
import { renderPointTopHexagon } from "../../lib/hexagon-render.js";
import { gridPixelBounds, offsetToPixel, pixelToOffset } from "../../lib/hex-layout.js";
import { initializeAbstractCanvas } from "../../lib/abstract-canvas.js";
import {
  createUnitPainter,
  GRID_STROKE_PX,
  HEX_HEIGHT,
  HEX_SIZE,
  HOVER_STROKE_PX,
  SELECTED_STROKE_PX,
} from "../../lib/unit-render.js";
import {
  isDispositionComplete,
  placementCandidates,
  placeUnit,
  setRuler,
  setUnitFacing
} from "../../state/battle-disposition-state/battle-disposition-state.js";


// arrow labels for the facing picker, matching the vertex screen positions
const FACING_ARROWS = ["↗", "↑", "↖", "↙", "↓", "↘"];

const SIDE_TITLES = { attacker: "Attacker Units", defender: "Defender Units" };

const cellKey = (row, col) => `${row}:${col}`;

const initializeCanvas = (container, map, hooks) => {
  // tokens are static — resolve them once, not per frame
  const styles = getComputedStyle(container);
  const token = (name) => styles.getPropertyValue(name).trim();
  const fillByTerrain = Object.fromEntries(TERRAINS.map((t) => [t.id, token(t.color)]));
  const gridColor = token("--terrain-grid");
  const hoverColor = token("--terrain-hover");
  const candidateColor = token("--hex-candidate");
  const selectedColor = token("--hex-selected");
  const { drawUnit } = createUnitPainter(token);

  return initializeAbstractCanvas(container, {
    worldBounds: gridPixelBounds(map.width, map.height, HEX_SIZE),

    hitTest: (worldX, worldY) => {
      const { col, row } = pixelToOffset(worldX, worldY, HEX_SIZE);
      const inGrid = row >= 0 && row < map.height && col >= 0 && col < map.width;
      return inGrid ? { col, row } : null;
    },

    onActionStart: ({ target }) => hooks.onHexClick(target),

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

      // semi-transparent veil over every hex the selected unit may drop on
      for (const { row, col } of hooks.getCandidates()) {
        const { x, y } = offsetToPixel(col, row, HEX_SIZE);
        renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, { fill: { style: candidateColor } });
      }

      for (const unit of hooks.getUnits()) {
        if (unit.position) {
          drawUnit(ctx, unit);
        }
      }

      const selected = hooks.getSelectedUnit();
      if (selected?.position) {
        const { x, y } = offsetToPixel(selected.position.col, selected.position.row, HEX_SIZE);
        renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
          stroke: { style: selectedColor, width: SELECTED_STROKE_PX / camera.scale },
        });
      }

      if (hovered) {
        const { x, y } = offsetToPixel(hovered.col, hovered.row, HEX_SIZE);
        renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
          stroke: { style: hoverColor, width: HOVER_STROKE_PX / camera.scale },
        });
      }
    },
  });
};

const noopPage = () => ({ el: document.createElement("span"), destroy: () => void 0 });

/**
 * @param {{ store: Store, router: Router }} deps
 * @returns {{ el: HTMLElement, mount?: () => void, destroy: () => void }}
 */
const createBattleDispositionPage = ({ store, router }) => {
  if (store.get().activeBattle.phase !== BATTLE_PHASE.DISPOSITION) {
    router.replace(ROUTES.BATTLE);
    return noopPage();
  }

  const map = getMap(store.get().maps, store.get().activeBattle.mapId);

  const el = document.createElement("section");
  el.className = "battle-disposition";

  if (!map) {
    el.innerHTML = `
      <p class="missing">No battle awaiting disposition.</p>
      <a href="${ROUTE_LINKS.BATTLE}">Continue</a>
    `;
    return { el, destroy: () => void 0 };
  }

  // transient UI state: which unit is being placed/relocated, and the hexes
  // it may land on (kept as array for rendering, Set for click checks)
  let selectedUnitId = null;
  let candidates = [];
  let candidateKeys = new Set();

  el.innerHTML = `
    <h1>Размещение армий</h1>
    <div class="workspace">
      <aside class="panel" data-role="attacker-panel"></aside>
      <div class="canvas-panel" data-role="canvas-panel"></div>
      <aside class="panel" data-role="defender-panel"></aside>
    </div>
    <div class="footer" data-role="footer"></div>
  `;
  const attackerPanel = el.querySelector("[data-role=attacker-panel]");
  const defenderPanel = el.querySelector("[data-role=defender-panel]");
  const canvasPanel = el.querySelector("[data-role=canvas-panel]");
  const footer = el.querySelector("[data-role=footer]");

  const unitCardHtml = (unit) => `
    <button class="unit-card ${unit.id === selectedUnitId ? "unit-card--selected" : ""}"
            data-action="select-unit" data-unit-id="${unit.id}">
      <span>${unit.name}</span>
      <span>${STAT_META.map((m) => `${unit[m.id]} ${m.emoji}`).join(" ")}</span>
    </button>
  `;

  // facing picker + ruler crown toggle for a placed, selected unit
  const unitDetailHtml = (unit) => `
    <div class="unit-detail">
      <div class="unit-detail-title">${unit.name}</div>
      <div class="facing-control">
        ${FACING_ARROWS.map((arrow, facing) => `
          <button class="facing-btn ${facing === unit.facing ? "facing-btn--active" : ""}"
                  data-action="set-facing" data-unit-id="${unit.id}" data-facing="${facing}">${arrow}</button>
        `).join("")}
      </div>
      <button class="crown-toggle ${unit.isRulerUnit ? "crown-toggle--active" : ""}"
              data-action="toggle-ruler" data-unit-id="${unit.id}">👑 Ruler</button>
    </div>
  `;

  const panelHtml = (side) => {
    const units = store.get().activeBattle.units.filter((u) => u.side === side);
    const unplaced = units.filter((u) => u.position === null);
    const selected = units.find((u) => u.id === selectedUnitId && u.position !== null);
    return `
      <div class="panel-title">${SIDE_TITLES[side]}</div>
      <div class="panel-progress">placed ${units.length - unplaced.length}/${units.length}</div>
      ${unplaced.length ? unplaced.map(unitCardHtml).join("") : `<p class="all-placed">All units placed.</p>`}
      ${selected ? unitDetailHtml(selected) : ""}
    `;
  };

  const footerHtml = () =>
    `<button data-action="start-battle" ${isDispositionComplete(store.get().activeBattle) ? "" : "disabled"}>Start Battle</button>`;

  const getSelectedUnit = () =>
    selectedUnitId === null ? null : findUnit(store.get().activeBattle, selectedUnitId);

  const syncCandidates = () => {
    const unit = getSelectedUnit();
    candidates = unit ? placementCandidates(store.get().activeBattle, unit, map) : [];
    candidateKeys = new Set(candidates.map((c) => cellKey(c.row, c.col)));
  };

  let canvasApi = null;

  const render = () => {
    syncCandidates();
    attackerPanel.innerHTML = panelHtml("attacker");
    defenderPanel.innerHTML = panelHtml("defender");
    footer.innerHTML = footerHtml();
    canvasApi?.requestRender();
  };

  const select = (unitId) => {
    selectedUnitId = unitId;
    render();
  };

  const onHexClick = (target) => {
    if (!target) {
      select(null);
      return;
    }
    const selected = getSelectedUnit();
    // drop first: while relocating, occupied hexes are candidates (swap)
    if (selected && candidateKeys.has(cellKey(target.row, target.col))) {
      store.set((s) => placeUnit(s.activeBattle, selected.id, target.row, target.col));
      select(null);
      return;
    }
    const occupant = unitAt(store.get().activeBattle, target.row, target.col);
    if (occupant) {
      select(occupant.id === selectedUnitId ? null : occupant.id);
      return;
    }
    select(null);
  };

  el.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    event.stopPropagation();

    switch (target.dataset.action) {
      case "select-unit": {
        const unitId = Number(target.dataset.unitId);
        select(unitId === selectedUnitId ? null : unitId);
        break;
      }
      case "start-battle":
        store.set((s) => startBattle(s.activeBattle, map));
        router.push(ROUTES.BATTLE_ACTIVE);
        break;
      case "set-facing": {
        const unitId = Number(target.dataset.unitId);
        store.set((s) => setUnitFacing(s.activeBattle, unitId, Number(target.dataset.facing)));
        break;
      }
      case "toggle-ruler": {
        const unitId = Number(target.dataset.unitId);
        store.set((s) => setRuler(s.activeBattle, unitId));
        break;
      }
    }
  });

  const mount = () => {
    canvasApi = initializeCanvas(canvasPanel, map, {
      onHexClick,
      getCandidates: () => candidates,
      getSelectedUnit,
      getUnits: () => store.get().activeBattle.units,
    });
  };

  const unsubscribe = store.subscribe(render);

  const destroy = () => {
    canvasApi?.destroy();
    unsubscribe();
  };

  return { el, mount, destroy };
};

export { createBattleDispositionPage };
