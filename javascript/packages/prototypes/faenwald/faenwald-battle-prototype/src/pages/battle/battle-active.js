import { STAT_META, UNIT_TYPES } from "../../data/unit.js";
import { ROUTE_LINKS, ROUTES } from "../../data/routing.js";
import { DEFAULT_TERRAIN_ID, TERRAINS } from "../../data/terrains.js";
import { MAPS_MODULE } from "../../modules/maps.js";
import { ACTIVE_BATTLE_MODULE, BATTLE_PHASE } from "../../modules/active-battle.js";
import { ACTIVE_UNIT_GROUP_TYPE, GROUP_CYCLE, getUnitGroupType } from "../../modules/active-unit-group.js";
import { frontHexes, flankHexes, rearHexes, zoneOf } from "../../modules/hex-facing.js";
import { topNavHtml } from "../../components/top-nav.js";
import { renderPointTopHexagon } from "../../modules/hexagon-render.js";
import { gridPixelBounds, offsetToPixel, pixelToOffset } from "../../modules/hex-layout.js";
import { initializeAbstractCanvas } from "../../modules/abstract-canvas.js";
import { MODEL } from "../../model/model.js";

const STYLE = `
  <style>
    .ba {
      font-family: var(--font-body);
      color: var(--text-primary);
      padding: var(--space-8);
    }

    .ba h1 {
      margin: 0 0 var(--space-7);
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      color: var(--text-accent);
      text-align: center;
    }

    .ba .workspace {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr) 260px;
      gap: var(--space-8);
      height: 70vh;
    }

    .ba .canvas-panel {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--card-bg);
      border: 1px dashed var(--border-medium);
      border-radius: var(--card-radius);
    }

    .ba .canvas-panel canvas {
      cursor: pointer;
      touch-action: none;
    }

    .ba .panel {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--card-radius);
      padding: var(--space-6);
      overflow-y: auto;
    }

    .ba .panel-title {
      font-family: var(--font-display);
      color: var(--text-accent);
      padding: var(--space-2) var(--space-4) 0;
    }

    .ba .group-queue {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: 0 var(--space-4);
    }

    .ba .group-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      color: var(--text-secondary);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
    }

    .ba .group-row--active {
      color: var(--text-primary);
      background: var(--bg-accent);
    }

    .ba .active-unit-card,
    .ba .hover-unit-card {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0 var(--space-4);
      padding: var(--space-4) var(--space-5);
      background: var(--bg-control-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
    }

    .ba .active-unit-name,
    .ba .hover-unit-name {
      color: var(--text-primary);
      text-align: center;
    }

    .ba .active-unit-stats,
    .ba .hover-unit-stats {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--space-3);
      color: var(--text-secondary);
    }

    .ba .active-unit-fire-info {
      color: var(--text-secondary);
      text-align: center;
    }

    .ba .log {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0 var(--space-4);
      padding: var(--space-3);
      max-height: 40%;
      overflow-y: auto;
      background: var(--bg-control-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
    }

    .ba .log-line {
      color: var(--text-secondary);
    }

    .ba .missing {
      margin: 0;
      padding: 0 var(--space-4);
      color: var(--text-muted);
    }

    .ba .footer {
      display: flex;
      justify-content: center;
      gap: var(--space-5);
      margin-top: var(--space-8);
    }

    .ba .footer button {
      font: inherit;
      color: var(--text-primary);
      background: var(--bg-control);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-sm);
      padding: var(--space-5) var(--space-8);
      cursor: pointer;
    }

    .ba .footer button:hover {
      background: var(--bg-control-hover);
    }

    .ba .footer button:disabled {
      color: var(--text-muted);
      border-color: var(--border-default);
      background: transparent;
      cursor: default;
    }

    .ba .footer button.toggle-handles--active {
      color: var(--text-primary);
      background: var(--bg-accent);
      border-color: var(--border-accent-muted);
    }

    .ba .footer button.fire-mode--active {
      color: var(--text-primary);
      background: var(--bg-accent);
      border-color: var(--border-accent-muted);
    }

    .ba a {
      color: var(--text-secondary);
    }

    .ba a:hover {
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
const CROWN_EMOJI_SIZE = HEX_SIZE * 0.5;
const HANDLE_RADIUS = HEX_SIZE * 0.12;
const HANDLE_DISTANCE = 0.9; // × vertex offset
const HANDLE_HIT_RADIUS = HEX_SIZE * 0.22;

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

// spearmen may also advance to a flank/rear hex (at ×2 MP cost, enforced by
// the mutator); every other unit is restricted to its front hexes
const moveTargetHexes = (unit) => {
  const fronts = frontHexes(unit.position, unit.facing);
  if (getUnitGroupType(unit.type) === ACTIVE_UNIT_GROUP_TYPE.SPEARMEN) {
    return [...fronts, ...flankHexes(unit.position, unit.facing), ...rearHexes(unit.position, unit.facing)];
  }
  return fronts;
};

const initializeCanvas = (container, map, hooks) => {
  // tokens are static — resolve them once, not per frame
  const styles = getComputedStyle(container);
  const token = (name) => styles.getPropertyValue(name).trim();
  const fillByTerrain = Object.fromEntries(TERRAINS.map((t) => [t.id, token(t.color)]));
  const gridColor = token("--terrain-grid");
  const hoverColor = token("--terrain-hover");
  const candidateColor = token("--hex-candidate");
  const selectedColor = token("--hex-selected");
  const attackColor = token("--hex-attack");
  const discBySide = { attacker: token("--unit-attacker"), defender: token("--unit-defender") };
  const ringColor = token("--unit-ring");
  const emojiFont = `${UNIT_EMOJI_SIZE}px ${token("--font-body")}`;

  const drawFacingIndicator = (ctx, x, y, facing) => {
    const offset = VERTEX_OFFSET[facing];
    const len = Math.hypot(offset.x, offset.y) || 1;
    const dir = { x: offset.x / len, y: offset.y / len };
    const perp = { x: -dir.y, y: dir.x };
    const tip = { x: x + dir.x * UNIT_DISC_RADIUS * 0.95, y: y + dir.y * UNIT_DISC_RADIUS * 0.95 };
    const baseCenter = { x: x + dir.x * UNIT_DISC_RADIUS * 0.4, y: y + dir.y * UNIT_DISC_RADIUS * 0.4 };
    const baseHalf = UNIT_DISC_RADIUS * 0.3;
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

  const handleCenters = (activeUnit) => {
    const { x, y } = offsetToPixel(activeUnit.position.col, activeUnit.position.row, HEX_SIZE);
    return VERTEX_OFFSET.map((v) => ({ x: x + v.x * HANDLE_DISTANCE, y: y + v.y * HANDLE_DISTANCE }));
  };

  return initializeAbstractCanvas(container, {
    worldBounds: gridPixelBounds(map.width, map.height, HEX_SIZE),

    hitTest: (worldX, worldY) => {
      const active = hooks.getActiveUnit();
      if (active?.position && hooks.isHandlesEnabled()) {
        const centers = handleCenters(active);
        for (let f = 0; f < centers.length; f += 1) {
          const dist = Math.hypot(worldX - centers[f].x, worldY - centers[f].y);
          if (dist < HANDLE_HIT_RADIUS) {
            return { type: "rotate", facing: f };
          }
        }
      }
      const { col, row } = pixelToOffset(worldX, worldY, HEX_SIZE);
      const inGrid = row >= 0 && row < map.height && col >= 0 && col < map.width;
      return inGrid ? { type: "hex", row, col } : null;
    },

    onActionStart: ({ target }) => {
      if (!target) {
        return;
      }
      if (target.type === "rotate") {
        hooks.onRotate(target.facing);
        return;
      }
      hooks.onHexClick(target.row, target.col);
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

      const active = hooks.getActiveUnit();

      // veil the active unit's move targets — its advance targets
      if (active?.position) {
        for (const { row, col } of hooks.getMoveTargetHexes()) {
          if (row >= 0 && row < map.height && col >= 0 && col < map.width) {
            const { x, y } = offsetToPixel(col, row, HEX_SIZE);
            renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, { fill: { style: candidateColor } });
          }
        }
      }

      // outline the active unit's attack targets — adjacent enemies for a
      // non-ranged unit, or the current fire mode's legal targets otherwise
      if (active?.position) {
        const targetIds = new Set(hooks.getAttackTargetIds());
        for (const unit of MODEL.activeBattle.units) {
          if (unit.position && targetIds.has(unit.id)) {
            const { x, y } = offsetToPixel(unit.position.col, unit.position.row, HEX_SIZE);
            renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
              stroke: { style: attackColor, width: SELECTED_STROKE_PX / camera.scale },
            });
          }
        }
      }

      for (const unit of MODEL.activeBattle.units) {
        if (unit.position) {
          drawUnit(ctx, unit);
        }
      }

      if (active?.position) {
        const { x, y } = offsetToPixel(active.position.col, active.position.row, HEX_SIZE);
        renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
          stroke: { style: selectedColor, width: SELECTED_STROKE_PX / camera.scale },
        });

        if (hooks.isHandlesEnabled()) {
          for (const center of handleCenters(active)) {
            ctx.beginPath();
            ctx.arc(center.x, center.y, HANDLE_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = selectedColor;
            ctx.fill();
            ctx.lineWidth = 1 / camera.scale;
            ctx.strokeStyle = ringColor;
            ctx.stroke();
          }
        }
      }

      if (hovered?.type === "hex") {
        const { x, y } = offsetToPixel(hovered.col, hovered.row, HEX_SIZE);
        renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
          stroke: { style: hoverColor, width: HOVER_STROKE_PX / camera.scale },
        });
      }

      hooks.onHoverChange(hovered);
    },
  });
};

const renderBattleActive = ({ root, params, router }) => {
  if (MODEL.activeBattle.phase !== BATTLE_PHASE.ACTIVE) {
    router.replace(ROUTES.BATTLE);
    return () => {};
  }

  const map = MAPS_MODULE.getMap(MODEL.maps, MODEL.activeBattle.mapId);

  if (!map) {
    root.innerHTML = `
      ${topNavHtml(router)}
      ${STYLE}
      <section class="ba">
        <p class="missing">No active battle.</p>
        <a href="${ROUTE_LINKS.BATTLE}">Continue</a>
      </section>
    `;
    return () => {
      root.innerHTML = "";
    };
  }

  // transient UI state: whether the rotation handles are drawn, the last
  // hovered unit shown in the right panel, and the fire mode picked for the
  // active unit's next attack (only meaningful while it's a ranged unit)
  let handlesEnabled = true;
  let hoveredUnitId = null;
  let confirmingCapitulation = false;
  let selectedFireMode = "direct";

  const LEFT_PANEL_ID = "ba-left-panel";
  const RIGHT_PANEL_ID = "ba-right-panel";
  const CANVAS_PANEL_ID = "ba-canvas-panel";
  const FOOTER_ID = "ba-footer";

  const FIRE_MODE_LABEL = { arc: "Навес", direct: "Прямой", melee: "Ближний" };

  const getState = () => MODEL.activeBattle;
  const getActiveUnit = () => ACTIVE_BATTLE_MODULE.findUnit(getState(), getState().activeUnitId);
  const unitRangedOf = (unit) => UNIT_TYPES.find((t) => t.type === unit.type)?.ranged ?? null;
  const getActiveRanged = () => {
    const unit = getActiveUnit();
    return unit ? unitRangedOf(unit) : null;
  };

  // falls back to the first available mode (direct -> arc -> melee) when the
  // stored selection has no legal target for the current active unit
  const resolveSelectedFireMode = () => {
    const ranged = getActiveRanged();
    if (!ranged) {
      return null;
    }
    const available = ACTIVE_BATTLE_MODULE.fireModesAvailable(getState(), map);
    if (available[selectedFireMode]) {
      return selectedFireMode;
    }
    return ["direct", "arc", "melee"].find((mode) => available[mode]) ?? selectedFireMode;
  };

  const unitStatsHtml = (unit) => `
    <span>MP ${unit.movePoints}</span>
    ${unitRangedOf(unit) ? `<span>ammo ${unit.ammo}</span>` : ""}
    ${STAT_META.map((m) => `<span>${m.id === "morale" ? ACTIVE_BATTLE_MODULE.effectiveMorale(getState(), unit) : unit[m.id]} ${m.emoji}</span>`).join("")}
  `;

  const activeUnitCardHtml = (unit) => {
    const ranged = unitRangedOf(unit);
    return `
      <div class="active-unit-card">
        <div class="active-unit-name">${unit.name}</div>
        <div class="active-unit-stats">${unitStatsHtml(unit)}</div>
        ${ranged
          ? `<div class="active-unit-fire-info">
              Режим: ${FIRE_MODE_LABEL[resolveSelectedFireMode()] ?? ""}
              ${unit.cooldown > 0 ? ` · перезарядка ${unit.cooldown}` : ""}
            </div>`
          : ""}
      </div>
    `;
  };

  const hoverUnitCardHtml = (unit) => `
    <div class="hover-unit-card">
      <div class="hover-unit-name">${unit.name}</div>
      <div class="hover-unit-stats">${unitStatsHtml(unit)}</div>
    </div>
  `;

  const leftPanelHtml = () => {
    const state = getState();
    const activeUnit = getActiveUnit();
    const groupRows = GROUP_CYCLE
      .filter((g) => state.units.some((u) =>
        u.side === g.side && getUnitGroupType(u.type) === g.type && u.position !== null && !u.destroyed))
      .map((g) => {
        const isActive = state.activeGroup?.side === g.side && state.activeGroup?.type === g.type;
        return `
          <div class="group-row ${isActive ? "group-row--active" : ""}">
            <span>${GROUP_EMOJI[g.type] ?? "❓"}</span>
            <span>${g.side} ${g.type}</span>
          </div>
        `;
      })
      .join("");

    return `
      <div class="panel-title">Раунд ${state.round}</div>
      <div class="group-queue">${groupRows}</div>
      ${activeUnit ? activeUnitCardHtml(activeUnit) : `<p class="missing">No active unit.</p>`}
    `;
  };

  const rightPanelHtml = () => {
    const state = getState();
    const hoveredUnit = hoveredUnitId === null ? null : ACTIVE_BATTLE_MODULE.findUnit(state, hoveredUnitId);
    const logHtml = state.log
      .slice()
      .reverse()
      .map((line) => `<div class="log-line">${line}</div>`)
      .join("");
    return `
      <div class="panel-title">Info</div>
      ${hoveredUnit ? hoverUnitCardHtml(hoveredUnit) : `<p class="missing">Hover a unit for details.</p>`}
      <div class="panel-title">Log</div>
      <div class="log">${logHtml}</div>
    `;
  };

  const fireModeButtonsHtml = () => {
    const ranged = getActiveRanged();
    if (!ranged) {
      return "";
    }
    const available = ACTIVE_BATTLE_MODULE.fireModesAvailable(getState(), map);
    const effective = resolveSelectedFireMode();
    return ["arc", "direct", "melee"].map((mode) => {
      const disabled = mode === "arc" ? !ranged.arc || !available.arc : !available[mode];
      const isActive = mode === effective;
      return `
        <button
          data-action="fire-mode"
          data-mode="${mode}"
          class="${isActive ? "fire-mode--active" : ""}"
          ${disabled ? "disabled" : ""}
        >${FIRE_MODE_LABEL[mode]}</button>
      `;
    }).join("");
  };

  const footerHtml = () => {
    if (getState().pendingBreakthrough) {
      return `
        <button data-action="breakthrough-apply">Прорыв</button>
        <button data-action="breakthrough-decline">Остаться</button>
      `;
    }
    return `
    ${fireModeButtonsHtml()}
    <button data-action="accelerate">Accelerate</button>
    <button data-action="end-activation">End Activation</button>
    ${confirmingCapitulation
      ? `<button data-action="capitulate-confirm">Капитулировать за ${getActiveUnit()?.side ?? ""}?</button>
         <button data-action="capitulate-cancel">Cancel</button>`
      : `<button data-action="capitulate">Capitulate</button>`}
    <button data-action="toggle-handles" class="${handlesEnabled ? "toggle-handles--active" : ""}">Rotate Handles</button>
  `;
  };

  root.innerHTML = `
    ${topNavHtml(router)}
    ${STYLE}
    <section class="ba">
      <h1>Battle</h1>
      <div class="workspace">
        <aside id="${LEFT_PANEL_ID}" class="panel">${leftPanelHtml()}</aside>
        <div id="${CANVAS_PANEL_ID}" class="canvas-panel"></div>
        <aside id="${RIGHT_PANEL_ID}" class="panel">${rightPanelHtml()}</aside>
      </div>
      <div id="${FOOTER_ID}" class="footer">${footerHtml()}</div>
    </section>
  `;

  const leftPanel = document.getElementById(LEFT_PANEL_ID);
  const rightPanel = document.getElementById(RIGHT_PANEL_ID);
  const canvasPanel = document.getElementById(CANVAS_PANEL_ID);
  const footer = document.getElementById(FOOTER_ID);

  let canvasApi = null;

  const refresh = () => {
    leftPanel.innerHTML = leftPanelHtml();
    rightPanel.innerHTML = rightPanelHtml();
    footer.innerHTML = footerHtml();
    canvasApi?.requestRender();
  };

  // a routed activation lands on the same phase check: bail to the dispatcher
  // once the battle is no longer active, otherwise repaint in place
  const syncPhase = () => {
    if (getState().phase !== BATTLE_PHASE.ACTIVE) {
      router.replace(ROUTES.BATTLE);
      return true;
    }
    return false;
  };

  const autoAdvanceRouted = () => {
    let guard = 0;
    while (getState().phase === BATTLE_PHASE.ACTIVE) {
      const a = getActiveUnit();
      if (!a || !a.routed) {
        break;
      }
      ACTIVE_BATTLE_MODULE.routTick(getState(), map);
      guard += 1;
      if (guard > 1000) {
        break;
      }
    }
  };

  const afterAction = () => {
    autoAdvanceRouted();
    if (!syncPhase()) {
      refresh();
    }
  };

  const onHoverChange = (hovered) => {
    const unit = hovered?.type === "hex" ? ACTIVE_BATTLE_MODULE.unitAt(getState(), hovered.row, hovered.col) : null;
    const id = unit ? unit.id : null;
    if (id === hoveredUnitId) {
      return;
    }
    hoveredUnitId = id;
    rightPanel.innerHTML = rightPanelHtml();
  };

  // targets highlighted on the canvas: adjacent enemies for a non-ranged
  // active unit, or the current fire mode's legal targets for a ranged one
  const getAttackTargetIds = () => {
    const active = getActiveUnit();
    if (!active?.position) {
      return [];
    }
    if (getActiveRanged()) {
      return ACTIVE_BATTLE_MODULE.validRangedTargets(getState(), map, resolveSelectedFireMode());
    }
    return ACTIVE_BATTLE_MODULE.validRangedTargets(getState(), map, "melee");
  };

  canvasApi = initializeCanvas(canvasPanel, map, {
    getActiveUnit,
    isHandlesEnabled: () => handlesEnabled,
    onHoverChange,
    getAttackTargetIds,
    getMoveTargetHexes: () => {
      const a = getActiveUnit();
      return a?.position ? moveTargetHexes(a) : [];
    },
    onRotate: (facing) => {
      ACTIVE_BATTLE_MODULE.rotateUnit(getState(), facing, map);
      afterAction();
    },
    onHexClick: (row, col) => {
      const active = getActiveUnit();
      if (!active?.position || active.routed) {
        return;
      }
      const target = ACTIVE_BATTLE_MODULE.unitAt(getState(), row, col);
      const ranged = getActiveRanged();
      if (ranged && target) {
        const mode = resolveSelectedFireMode();
        if (ACTIVE_BATTLE_MODULE.validRangedTargets(getState(), map, mode).includes(target.id)) {
          ACTIVE_BATTLE_MODULE.attack(getState(), target.id, map, mode);
          afterAction();
          return;
        }
      }
      if (target && target.side !== active.side && zoneOf(active.position, active.facing, target.position) !== null) {
        ACTIVE_BATTLE_MODULE.attack(getState(), target.id, map);
        afterAction();
        return;
      }
      const isMoveTarget = moveTargetHexes(active).some((h) => h.row === row && h.col === col);
      if (!isMoveTarget) {
        return;
      }
      ACTIVE_BATTLE_MODULE.advanceUnit(getState(), { row, col }, map);
      afterAction();
    },
  });

  // a battle can be entered with a routed unit already active (e.g. after a
  // reload); resolve it before waiting for player input
  afterAction();

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) {
      return;
    }

    switch (el.dataset.action) {
      case "fire-mode":
        selectedFireMode = el.dataset.mode;
        footer.innerHTML = footerHtml();
        canvasApi.requestRender();
        break;
      case "accelerate":
        ACTIVE_BATTLE_MODULE.accelerate(getState(), map);
        afterAction();
        break;
      case "end-activation":
        ACTIVE_BATTLE_MODULE.endActivation(getState(), map);
        afterAction();
        break;
      case "capitulate":
        confirmingCapitulation = true;
        footer.innerHTML = footerHtml();
        break;
      case "capitulate-cancel":
        confirmingCapitulation = false;
        footer.innerHTML = footerHtml();
        break;
      case "capitulate-confirm": {
        const side = getActiveUnit()?.side;
        confirmingCapitulation = false;
        if (!side) {
          footer.innerHTML = footerHtml();
          break;
        }
        ACTIVE_BATTLE_MODULE.capitulate(getState(), side);
        syncPhase();
        break;
      }
      case "toggle-handles":
        handlesEnabled = !handlesEnabled;
        footer.innerHTML = footerHtml();
        canvasApi.requestRender();
        break;
      case "breakthrough-apply":
        ACTIVE_BATTLE_MODULE.applyBreakthrough(getState(), map);
        afterAction();
        break;
      case "breakthrough-decline":
        ACTIVE_BATTLE_MODULE.declineBreakthrough(getState());
        afterAction();
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

export { renderBattleActive };
