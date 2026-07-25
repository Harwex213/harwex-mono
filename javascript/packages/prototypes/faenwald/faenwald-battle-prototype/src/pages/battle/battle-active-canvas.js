import { DEFAULT_TERRAIN_ID, TERRAINS } from "../../data/terrains.js";
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
  VERTEX_OFFSET,
} from "../../lib/unit-render.js";

const HANDLE_RADIUS = HEX_SIZE * 0.12;
const HANDLE_DISTANCE = 0.9; // × vertex offset
const HANDLE_HIT_RADIUS = HEX_SIZE * 0.22;

/**
 * The battle scene: hex grid, move/attack highlights, units, rotation
 * handles. Subscribes to the store and repaints on every change (RAF-
 * batched); page-local UI inputs arrive through `hooks`, and the page calls
 * .requestRender() when only those change.
 *
 * @param {{ store: Store, map: HexMap, hooks: object }} deps
 * @returns {{ el: HTMLElement, mount: () => void, requestRender: () => void, destroy: () => void }}
 */
const createBattleActiveCanvas = ({ store, map, hooks }) => {
  const el = document.createElement("div");
  el.className = "canvas-panel";

  let api = null;

  // canvas setup resolves computed token values and measures the panel —
  // both need the element in the document, hence mount(), not creation time
  const mount = () => {
    const styles = getComputedStyle(el);
    const token = (name) => styles.getPropertyValue(name).trim();
    const fillByTerrain = Object.fromEntries(TERRAINS.map((t) => [t.id, token(t.color)]));
    const gridColor = token("--terrain-grid");
    const hoverColor = token("--terrain-hover");
    const candidateColor = token("--hex-candidate");
    const selectedColor = token("--hex-selected");
    const attackColor = token("--hex-attack");
    const ringColor = token("--unit-ring");
    const { drawUnit } = createUnitPainter(token);

    const drawUnitHp = (ctx, unit) => {
      const { x, y } = offsetToPixel(unit.position.col, unit.position.row, HEX_SIZE);
      ctx.fillStyle = "#000000";
      ctx.fillText(`${unit.hp}❤️`, x, y);
    };

    const handleCenters = (activeUnit) => {
      const { x, y } = offsetToPixel(activeUnit.position.col, activeUnit.position.row, HEX_SIZE);
      return VERTEX_OFFSET.map((v) => ({ x: x + v.x * HANDLE_DISTANCE, y: y + v.y * HANDLE_DISTANCE }));
    };

    api = initializeAbstractCanvas(el, {
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

        const units = store.get().activeBattle.units;
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
          for (const unit of units) {
            if (unit.position && targetIds.has(unit.id)) {
              const { x, y } = offsetToPixel(unit.position.col, unit.position.row, HEX_SIZE);
              renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
                stroke: { style: attackColor, width: SELECTED_STROKE_PX / camera.scale },
              });
            }
          }
        }

        for (const unit of units) {
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

        if (hooks.isHpEnabled()) {
          for (const unit of units) {
            if (unit.position) {
              drawUnitHp(ctx, unit);
            }
          }
        }

        hooks.onHoverChange(hovered);
      },
    });
  };

  const requestRender = () => api?.requestRender();

  const unsubscribe = store.subscribe(requestRender);

  const destroy = () => {
    api?.destroy();
    unsubscribe();
  };

  return { el, mount, requestRender, destroy };
};

export { createBattleActiveCanvas };
