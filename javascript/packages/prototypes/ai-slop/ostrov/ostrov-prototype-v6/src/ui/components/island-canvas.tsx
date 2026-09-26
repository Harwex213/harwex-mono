import { useSignals } from "@preact/signals-react/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBiome } from "../../core/biomes";
import { canBuildOn, getBuilding } from "../../core/buildings";
import { isDead } from "../../core/tax";
import {
  AXIAL_DIRECTIONS,
  HEX_SIZE,
  hexBounds,
  hexCornerPoints,
  hexEdge,
  hexId,
  hexToPixel,
} from "../../core/hex";
import { useStore } from "../../store/store";
import type { FC, PointerEvent as ReactPointerEvent } from "react";
import type { TBuildingId, THex } from "../../core/types";
import type {
  TBuildOnHexAction,
  THoverHexAction,
  TRequestDemolishAction,
  TSelectHexAction,
  TSetCameraAction,
} from "../../domain/registry";

/** The building art is square and slightly narrower than the hex it stands on. */
const ART_SPAN = HEX_SIZE * 1.45;
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.6;
/** One wheel notch. Zoom is geometric, so a notch is a constant ratio. */
const ZOOM_STEP = 1.12;
/**
 * The HUD floats over the canvas, so fitting centres the island in what is left
 * free: the turn panel above, the bottom bar below.
 */
const FIT_INSET_TOP_PX = 96;
const FIT_INSET_BOTTOM_PX = 196;
const FIT_INSET_SIDE_PX = 48;
/** A pointer that moved less than this between down and up was a click. */
const DRAG_SLOP_PX = 4;

const CORNER_POINTS = hexCornerPoints(HEX_SIZE);

type TView = {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
};

type TIslandCanvasRegistrySlice = {
  buildOnHexAction: TBuildOnHexAction;
  hoverHexAction: THoverHexAction;
  requestDemolishAction: TRequestDemolishAction;
  selectHexAction: TSelectHexAction;
  setCameraAction: TSetCameraAction;
};

type TIslandCanvasProps = {
  registry: TIslandCanvasRegistrySlice;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Which visual state a hex is in, which is also its modifier class. */
const hexStateClass = (
  hex: THex,
  armedBuildingId: TBuildingId | null,
  demolishMode: boolean,
) => {
  if (demolishMode) {
    return hex.building === null ? "hex--blocked" : "hex--demolishable";
  }

  if (!armedBuildingId) {
    return "";
  }

  const building = getBuilding(armedBuildingId);
  const allowed = hex.building === null && canBuildOn(building, hex.biome);

  return allowed ? "hex--buildable" : "hex--blocked";
};

const IslandCanvas: FC<TIslandCanvasProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const player = store.derived.viewedPlayer.value;
  const armedBuildingId = store.ui.armedBuilding.value;
  const demolishMode = store.ui.demolishMode.value;
  const hoveredHexId = store.ui.hoveredHexId.value;
  const selectedHexId = store.ui.selectedHexId.value;
  const isReadonly = store.derived.isReadonly.value;

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; moved: number; captured: boolean } | null>(null);
  /** How far the pointer travelled in the gesture that just ended. */
  const lastMovedRef = useRef(0);
  const [view, setView] = useState<TView>({ x: 0, y: 0, scale: 1 });

  const hexes = player?.island.hexes ?? [];
  const playerId = player?.id ?? null;

  /** Centres the island in the viewport and picks the scale that fits it. */
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container || hexes.length === 0) {
      return;
    }

    const bounds = hexBounds(hexes, HEX_SIZE);
    const width = container.clientWidth - FIT_INSET_SIDE_PX * 2;
    const height = container.clientHeight - FIT_INSET_TOP_PX - FIT_INSET_BOTTOM_PX;
    const scale = clamp(
      Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY)),
      MIN_SCALE,
      MAX_SCALE,
    );

    setView({
      scale,
      x: FIT_INSET_SIDE_PX + width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
      y: FIT_INSET_TOP_PX + height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
    });
  }, [hexes.length, playerId]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  useEffect(() => {
    registry.setCameraAction(view);
  }, [registry, view]);

  // Wheel has to be bound by hand: React's own listener is passive, so it
  // cannot stop the page from scrolling behind the canvas.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      // A trackpad pinch arrives as ctrl+wheel; both it and a mouse wheel zoom.
      const notches = event.deltaY / 100;

      setView((current) => {
        const scale = clamp(current.scale * Math.pow(ZOOM_STEP, -notches), MIN_SCALE, MAX_SCALE);
        const ratio = scale / current.scale;

        return {
          scale,
          x: pointerX - (pointerX - current.x) * ratio,
          y: pointerY - (pointerY - current.y) * ratio,
        };
      });
    };

    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", onWheel);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The pointer is captured only once it starts to drag. Capturing it here
    // would retarget the click to the container, and no hex would ever be hit.
    dragRef.current = { x: event.clientX, y: event.clientY, moved: 0, captured: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = event.clientX;
    drag.y = event.clientY;

    if (!drag.captured && drag.moved > DRAG_SLOP_PX) {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.captured = true;
    }

    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.captured) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    lastMovedRef.current = drag?.moved ?? 0;
    dragRef.current = null;
  };

  /** The click right after a pan is part of the pan, not a click on a hex. */
  const wasDragged = () => lastMovedRef.current > DRAG_SLOP_PX;

  const onHexEnter = (hex: THex) => {
    const center = hexToPixel(hex.q, hex.r, HEX_SIZE);

    registry.hoverHexAction(hex.id, {
      x: view.x + center.x * view.scale,
      y: view.y + center.y * view.scale - HEX_SIZE * view.scale,
    });
  };

  const onHexClick = (hex: THex) => {
    if (wasDragged()) {
      return;
    }

    if (!isReadonly && demolishMode) {
      registry.requestDemolishAction(hex.id);

      return;
    }

    if (!isReadonly && armedBuildingId) {
      registry.buildOnHexAction(hex.id);

      return;
    }

    registry.selectHexAction(hex.id);
  };

  const present = new Set(hexes.map((hex) => hex.id));
  const rimEdges = hexes.flatMap((hex) =>
    AXIAL_DIRECTIONS.flatMap((step, direction) => {
      if (present.has(hexId(hex.q + step.q, hex.r + step.r))) {
        return [];
      }

      return [{ key: `${hex.id}:${direction}`, ...hexEdge(hex.q, hex.r, direction, HEX_SIZE) }];
    }),
  );

  return (
    <div
      className="island-canvas"
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => registry.hoverHexAction(null, null)}
    >
      <svg className="island-canvas__svg" role="presentation">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {rimEdges.map((edge) => (
            <line
              className="island-rim"
              key={edge.key}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
            />
          ))}

          {hexes.map((hex) => {
            const center = hexToPixel(hex.q, hex.r, HEX_SIZE);
            const biome = getBiome(hex.biome);
            const building = hex.building ? getBuilding(hex.building) : null;
            const stateClass = isReadonly ? "" : hexStateClass(hex, armedBuildingId, demolishMode);
            const isHovered = hex.id === hoveredHexId;
            const isSelected = hex.id === selectedHexId;

            return (
              <g
                key={hex.id}
                className={`hex ${stateClass} ${isDead(hex) ? "hex--dead" : ""} ${isHovered ? "hex--hovered" : ""} ${isSelected ? "hex--selected" : ""}`}
                transform={`translate(${center.x} ${center.y})`}
                onPointerEnter={() => onHexEnter(hex)}
                onPointerLeave={() => registry.hoverHexAction(null, null)}
                onClick={() => onHexClick(hex)}
              >
                <polygon
                  className="hex__face"
                  points={CORNER_POINTS}
                  fill={biome.color}
                  stroke={biome.edgeColor}
                />

                {hex.toxicity > 0 ? (
                  <polygon
                    className="hex__toxicity"
                    points={CORNER_POINTS}
                    fill="#9bff4f"
                    opacity={hex.toxicity / 160}
                  />
                ) : null}

                {isDead(hex) ? (
                  <text className="hex__dead" textAnchor="middle" dominantBaseline="central">
                    {"☠️"}
                  </text>
                ) : null}

                {building ? (
                  <image
                    className="hex__art"
                    href={building.art}
                    x={-ART_SPAN / 2}
                    y={-ART_SPAN / 2 - HEX_SIZE * 0.18}
                    width={ART_SPAN}
                    height={ART_SPAN}
                    preserveAspectRatio="xMidYMid meet"
                  />
                ) : null}

              </g>
            );
          })}

          {hexes.map((hex) => {
            const center = hexToPixel(hex.q, hex.r, HEX_SIZE);
            const stateClass = isReadonly ? "" : hexStateClass(hex, armedBuildingId, demolishMode);
            const isHovered = hex.id === hoveredHexId;
            const isSelected = hex.id === selectedHexId;
            if (!stateClass && !isHovered && !isSelected) {
              return null;
            }

            return (
              <polygon
                key={`outline-${hex.id}`}
                className={`hex-outline ${stateClass} ${isHovered ? "hex--hovered" : ""} ${isSelected ? "hex--selected" : ""}`}
                points={CORNER_POINTS}
                transform={`translate(${center.x} ${center.y})`}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
};

export { IslandCanvas };
