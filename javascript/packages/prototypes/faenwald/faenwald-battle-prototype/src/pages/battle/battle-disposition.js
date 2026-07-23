import { STAT_META } from "../../data/unit.js";
import { ROUTE_LINKS, ROUTES } from "../../data/routing.js";
import { DEFAULT_TERRAIN_ID, TERRAINS } from "../../data/terrains.js";
import { getMap } from "../../state/maps.js";
import { BATTLE_PHASE, findUnit, startBattle, unitAt } from "../../state/active-battle.js";
import { ACTIVE_UNIT_GROUP_TYPE, getUnitGroupType } from "../../lib/active-unit-group.js";
import { renderPointTopHexagon } from "../../lib/hexagon-render.js";
import { gridPixelBounds, offsetToPixel, pixelToOffset } from "../../lib/hex-layout.js";
import { initializeAbstractCanvas } from "../../lib/abstract-canvas.js";
import { isDispositionComplete, placeUnit, placementCandidates, setRuler, setUnitFacing } from "../../state/battle-disposition.js";

const HEX_HEIGHT = 128; // world units, top vertex to bottom vertex
const HEX_SIZE = HEX_HEIGHT / 2; // circumradius
const GRID_STROKE_PX = 1; // screen px, constant under zoom
const HOVER_STROKE_PX = 2;
const SELECTED_STROKE_PX = 4;
const UNIT_DISC_RADIUS = HEX_SIZE * 0.6; // world units — part of the scene, scales with zoom
const UNIT_EMOJI_SIZE = HEX_SIZE * 0.7;
const CROWN_EMOJI_SIZE = HEX_SIZE * 0.5;

// world-px offset from a hex center to each of its 6 vertices, indexed by facing
const HEX_HALF_WIDTH = (Math.sqrt(3) / 2) * HEX_SIZE;
const VERTEX_OFFSET = [
  { x: HEX_HALF_WIDTH, y: -HEX_SIZE / 2 },
  { x: 0, y: -HEX_SIZE },
  { x: -HEX_HALF_WIDTH, y: -HEX_SIZE / 2 },
  { x: -HEX_HALF_WIDTH, y: HEX_SIZE / 2 },
  { x: 0, y: HEX_SIZE },
  { x: HEX_HALF_WIDTH, y: HEX_SIZE / 2 },
];

// arrow labels for the facing picker, matching the vertex screen positions
const FACING_ARROWS = ["↗", "↑", "↖", "↙", "↓", "↘"];

const GROUP_EMOJI = {
  [ACTIVE_UNIT_GROUP_TYPE.CAVALRY]: "🐎",
  [ACTIVE_UNIT_GROUP_TYPE.ARCHERS]: "🏹",
  [ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY]: "⚔️",
  [ACTIVE_UNIT_GROUP_TYPE.SPEARMEN]: "🔱",
};

// weight class shows as the disc's ring: light none, medium thin, heavy
// thick; the dedicated ranged types (archer, longbowman, …) carry no grade
const RING_WIDTH_BY_GRADE = { medium: 0.06, heavy: 0.14 }; // × HEX_SIZE
const unitRingWidth = (unitType) => (RING_WIDTH_BY_GRADE[unitType.split("-")[0]] ?? 0) * HEX_SIZE;

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
  const discBySide = { attacker: token("--unit-attacker"), defender: token("--unit-defender") };
  const ringColor = token("--unit-ring");
  const emojiFont = `${UNIT_EMOJI_SIZE}px ${token("--font-body")}`;

  // short filled triangle from the disc center toward the front vertex
  const drawFacingIndicator = (ctx, x, y, facing) => {
    const offset = VERTEX_OFFSET[facing];
    const len = Math.hypot(offset.x, offset.y) || 1;
    const dir = { x: offset.x / len, y: offset.y / len };
    const perp = { x: -dir.y, y: dir.x };
    const tipDist = UNIT_DISC_RADIUS * 0.95;
    const baseDist = UNIT_DISC_RADIUS * 0.4;
    const baseHalf = UNIT_DISC_RADIUS * 0.3;
    const tip = { x: x + dir.x * tipDist, y: y + dir.y * tipDist };
    const baseCenter = { x: x + dir.x * baseDist, y: y + dir.y * baseDist };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(baseCenter.x + perp.x * baseHalf, baseCenter.y + perp.y * baseHalf);
    ctx.lineTo(baseCenter.x - perp.x * baseHalf, baseCenter.y - perp.y * baseHalf);
    ctx.closePath();
    ctx.fillStyle = ringColor;
    ctx.fill();
  };

  const drawUnit = (ctx, unit) => {
    const { x, y } = offsetToPixel(unit.position.col, unit.position.row, HEX_SIZE);
    ctx.beginPath();
    ctx.arc(x, y, UNIT_DISC_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = discBySide[unit.side];
    ctx.fill();
    const ringWidth = unitRingWidth(unit.type);
    if (ringWidth) {
      ctx.lineWidth = ringWidth;
      ctx.strokeStyle = ringColor;
      ctx.stroke();
    }
    ctx.font = emojiFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(GROUP_EMOJI[getUnitGroupType(unit.type)] ?? "❓", x, y);
    drawFacingIndicator(ctx, x, y, unit.facing);
    if (unit.isRulerUnit) {
      ctx.font = `${CROWN_EMOJI_SIZE}px ${token("--font-body")}`;
      ctx.fillText("👑", x - UNIT_DISC_RADIUS * 0.7, y - UNIT_DISC_RADIUS * 0.7);
    }
  };

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
  const attackerPanel = el.querySelector('[data-role="attacker-panel"]');
  const defenderPanel = el.querySelector('[data-role="defender-panel"]');
  const canvasPanel = el.querySelector('[data-role="canvas-panel"]');
  const footer = el.querySelector('[data-role="footer"]');

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
