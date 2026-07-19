import { STAT_META } from "../../data/unit.js";
import { ROUTE_LINKS, ROUTES } from "../../data/routing.js";
import { DEFAULT_TERRAIN_ID, TERRAINS } from "../../data/terrains.js";
import { MAPS_MODULE } from "../../modules/maps.js";
import { ACTIVE_BATTLE_MODULE, BATTLE_PHASE } from "../../modules/active-battle.js";
import { ACTIVE_UNIT_GROUP_TYPE, getUnitGroupType } from "../../modules/active-unit-group.js";
import { topNavHtml } from "../../components/top-nav.js";
import { renderPointTopHexagon } from "../../modules/hexagon-render.js";
import { gridPixelBounds, offsetToPixel, pixelToOffset } from "../../modules/hex-layout.js";
import { initializeAbstractCanvas } from "../../modules/abstract-canvas.js";
import { MODEL } from "../../model/model.js";
import { BATTLE_DISPOSITION_MODULE } from "../../modules/battle-disposition.js";

const STYLE = `
  <style>
    .bd {
      font-family: var(--font-body);
      color: var(--text-primary);
      padding: var(--space-8);
    }

    .bd h1 {
      margin: 0 0 var(--space-7);
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      color: var(--text-accent);
      text-align: center;
    }

    .bd .workspace {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr) 260px;
      gap: var(--space-8);
      height: 70vh;
    }

    .bd .canvas-panel {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--card-bg);
      border: 1px dashed var(--border-medium);
      border-radius: var(--card-radius);
    }

    .bd .canvas-panel canvas {
      cursor: pointer;
      touch-action: none;
    }

    .bd .panel {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--card-radius);
      padding: var(--space-6);
      overflow-y: auto;
    }

    .bd .panel-title {
      font-family: var(--font-display);
      color: var(--text-accent);
      padding: var(--space-2) var(--space-4) 0;
    }

    .bd .panel-progress {
      color: var(--text-muted);
      padding: 0 var(--space-4) var(--space-4);
    }

    .bd .unit-card {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      font: inherit;
      text-align: center;
      color: var(--text-secondary);
      background: var(--bg-control-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      padding: var(--space-4) var(--space-5);
      cursor: pointer;
    }

    .bd .unit-card:hover {
      color: var(--text-primary);
      background: var(--bg-control-subtle-hover);
    }

    .bd .unit-card--selected {
      color: var(--text-primary);
      background: var(--bg-accent);
      border-color: var(--border-accent-muted);
    }

    .bd .all-placed {
      margin: 0;
      padding: 0 var(--space-4);
      color: var(--text-muted);
    }

    .bd .footer {
      display: flex;
      justify-content: center;
      margin-top: var(--space-8);
    }

    .bd .footer button {
      font: inherit;
      color: var(--text-primary);
      background: var(--bg-control);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-sm);
      padding: var(--space-5) var(--space-8);
      cursor: pointer;
    }

    .bd .footer button:hover {
      background: var(--bg-control-hover);
    }

    .bd .footer button:disabled {
      color: var(--text-muted);
      border-color: var(--border-default);
      background: transparent;
      cursor: default;
    }

    .bd .missing {
      color: var(--text-muted);
    }

    .bd a {
      color: var(--text-secondary);
    }

    .bd a:hover {
      color: var(--text-primary);
    }
  </style>
`;

const HEX_HEIGHT = 128; // world units, top vertex to bottom vertex
const HEX_SIZE = HEX_HEIGHT / 2; // circumradius
const GRID_STROKE_PX = 1; // screen px, constant under zoom
const HOVER_STROKE_PX = 2;
const SELECTED_STROKE_PX = 4;
const UNIT_DISC_RADIUS = HEX_SIZE * 0.6; // world units — part of the scene, scales with zoom
const UNIT_EMOJI_SIZE = HEX_SIZE * 0.7;

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

      for (const unit of MODEL.activeBattle.units) {
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

const renderBattleDisposition = (params, router) => {
  const root = document.querySelector("main");
  const map = MAPS_MODULE.getMap(MODEL.maps, MODEL.activeBattle.mapId);

  if (MODEL.activeBattle.phase !== BATTLE_PHASE.DISPOSITION || !map) {
    root.innerHTML = `
      ${topNavHtml(router)}
      ${STYLE}
      <section class="bd">
        <p class="missing">No battle awaiting disposition.</p>
        <a href="${ROUTE_LINKS.BATTLE}">Continue</a>
      </section>
    `;
    return () => {
      root.innerHTML = "";
    };
  }

  // transient UI state: which unit is being placed/relocated, and the hexes
  // it may land on (kept as array for rendering, Set for click checks)
  let selectedUnitId = null;
  let candidates = [];
  let candidateKeys = new Set();

  const ATTACKER_PANEL_ID = "bd-attacker-panel";
  const DEFENDER_PANEL_ID = "bd-defender-panel";
  const CANVAS_PANEL_ID = "bd-canvas-panel";
  const FOOTER_ID = "bd-footer";

  const unitCardHtml = (unit) => `
    <button class="unit-card ${unit.id === selectedUnitId ? "unit-card--selected" : ""}"
            data-action="select-unit" data-unit-id="${unit.id}">
      <span>${unit.name}</span>
      <span>${STAT_META.map((m) => `${unit[m.id]} ${m.emoji}`).join(" ")}</span>
    </button>
  `;

  const panelHtml = (side) => {
    const units = MODEL.activeBattle.units.filter((u) => u.side === side);
    const unplaced = units.filter((u) => u.position === null);
    return `
      <div class="panel-title">${SIDE_TITLES[side]}</div>
      <div class="panel-progress">placed ${units.length - unplaced.length}/${units.length}</div>
      ${unplaced.length ? unplaced.map(unitCardHtml).join("") : `<p class="all-placed">All units placed.</p>`}
    `;
  };

  const footerHtml = () =>
    `<button data-action="start-battle" ${BATTLE_DISPOSITION_MODULE.isDispositionComplete(MODEL.activeBattle) ? "" : "disabled"}>Start Battle</button>`;

  root.innerHTML = `
    ${topNavHtml(router)}
    ${STYLE}
    <section class="bd">
      <h1>Размещение армий</h1>
      <div class="workspace">
        <aside id="${ATTACKER_PANEL_ID}" class="panel">${panelHtml("attacker")}</aside>
        <div id="${CANVAS_PANEL_ID}" class="canvas-panel"></div>
        <aside id="${DEFENDER_PANEL_ID}" class="panel">${panelHtml("defender")}</aside>
      </div>
      <div id="${FOOTER_ID}" class="footer">${footerHtml()}</div>
    </section>
  `;

  const attackerPanel = document.getElementById(ATTACKER_PANEL_ID);
  const defenderPanel = document.getElementById(DEFENDER_PANEL_ID);
  const canvasPanel = document.getElementById(CANVAS_PANEL_ID);
  const footer = document.getElementById(FOOTER_ID);

  const getSelectedUnit = () => (selectedUnitId === null ? null : ACTIVE_BATTLE_MODULE.findUnit(MODEL.activeBattle, selectedUnitId));

  const syncCandidates = () => {
    const unit = getSelectedUnit();
    candidates = unit ? BATTLE_DISPOSITION_MODULE.placementCandidates(MODEL.activeBattle, unit, map) : [];
    candidateKeys = new Set(candidates.map((c) => cellKey(c.row, c.col)));
  };

  let canvasApi = null;

  const refresh = () => {
    syncCandidates();
    attackerPanel.innerHTML = panelHtml("attacker");
    defenderPanel.innerHTML = panelHtml("defender");
    footer.innerHTML = footerHtml();
    canvasApi?.requestRender();
  };

  const select = (unitId) => {
    selectedUnitId = unitId;
    refresh();
  };

  const onHexClick = (target) => {
    if (!target) {
      select(null);
      return;
    }
    const selected = getSelectedUnit();
    // drop first: while relocating, occupied hexes are candidates (swap)
    if (selected && candidateKeys.has(cellKey(target.row, target.col))) {
      BATTLE_DISPOSITION_MODULE.placeUnit(MODEL.activeBattle, selected.id, target.row, target.col);
      select(null);
      return;
    }
    const occupant = ACTIVE_BATTLE_MODULE.unitAt(MODEL.activeBattle, target.row, target.col);
    if (occupant) {
      select(occupant.id === selectedUnitId ? null : occupant.id);
      return;
    }
    select(null);
  };

  canvasApi = initializeCanvas(canvasPanel, map, {
    onHexClick,
    getCandidates: () => candidates,
    getSelectedUnit,
  });

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) {
      return;
    }

    switch (el.dataset.action) {
      case "select-unit": {
        const unitId = Number(el.dataset.unitId);
        select(unitId === selectedUnitId ? null : unitId);
        break;
      }
      case "start-battle":
        ACTIVE_BATTLE_MODULE.startBattle(MODEL.activeBattle);
        router.push(ROUTES.BATTLE_ACTIVE);
        break;
    }
  };

  root.addEventListener("click", onClick);

  return () => {
    canvasApi.destroy();
    root.removeEventListener("click", onClick);
    root.innerHTML = "";
  };
};

export { renderBattleDisposition };
