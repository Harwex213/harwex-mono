import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useRef } from "react";
import { edges, nodes, selectedId } from "../state/graph-state.js";
import { contentBounds, viewRect } from "../state/framing.js";
import { centreOnWorld, sizeOf } from "../state/viewport.js";

const MAP_WIDTH = 232;
const MAP_HEIGHT = 152;
/** Canvas units of air kept around whatever the map has to show. */
const MARGIN = 140;
const COLLAPSED_KEY = "imagen.minimap.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

const collapsed = signal(readCollapsed());

function setCollapsed(value: boolean): void {
  collapsed.value = value;
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // A browser that refuses storage still gets a working map.
  }
}

/**
 * Where to pin the marker for a window that has left the map, and which way it
 * should point: the direction from the middle of the map, stopped at the border.
 */
function offMapPointer(x: number, y: number): { x: number; y: number; angle: number } {
  const centreX = MAP_WIDTH / 2;
  const centreY = MAP_HEIGHT / 2;
  const dx = x - centreX;
  const dy = y - centreY;
  const reach = Math.min(
    (MAP_WIDTH / 2 - 14) / Math.max(Math.abs(dx), 0.001),
    (MAP_HEIGHT / 2 - 14) / Math.max(Math.abs(dy), 0.001),
  );
  return {
    x: centreX + dx * reach,
    y: centreY + dy * reach,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

interface Projection {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function project(projection: Projection, x: number, y: number): { x: number; y: number } {
  return {
    x: x * projection.scale + projection.offsetX,
    y: y * projection.scale + projection.offsetY,
  };
}

/**
 * The overview in the corner: the cards, the wires between them, and the window
 * drawn over them as a rectangle. Pressing anywhere on it puts that spot in the
 * middle of the window, and dragging steers, so the map is also the way home
 * when the canvas has been pushed out past everything.
 */
function Minimap(): React.JSX.Element | null {
  useSignals();
  const surfaceRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const cards = nodes.value;
  const area = contentBounds();

  if (cards.length === 0 || !area) {
    return null;
  }
  if (collapsed.value) {
    return (
      <button
        type="button"
        className="minimap__show"
        title="Show the map"
        onClick={() => {
          setCollapsed(false);
        }}
      >
        map
      </button>
    );
  }

  const view = viewRect();
  // The map is drawn to the cards, not to the window. A window parked a long way
  // off would otherwise squeeze the whole graph into a dot, and a map you cannot
  // read is no way home.
  const minX = area.minX - MARGIN;
  const minY = area.minY - MARGIN;
  const maxX = area.maxX + MARGIN;
  const maxY = area.maxY + MARGIN;
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const scale = Math.min(MAP_WIDTH / width, MAP_HEIGHT / height);
  const projection: Projection = {
    scale,
    offsetX: (MAP_WIDTH - width * scale) / 2 - minX * scale,
    offsetY: (MAP_HEIGHT - height * scale) / 2 - minY * scale,
  };

  const steer = (clientX: number, clientY: number) => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    const box = surface.getBoundingClientRect();
    centreOnWorld(
      (clientX - box.left - projection.offsetX) / scale,
      (clientY - box.top - projection.offsetY) / scale,
    );
  };

  const marker = project(projection, view.x, view.y);
  const markerWidth = Math.max(view.width * scale, 6);
  const markerHeight = Math.max(view.height * scale, 6);
  const onMap =
    marker.x < MAP_WIDTH &&
    marker.y < MAP_HEIGHT &&
    marker.x + markerWidth > 0 &&
    marker.y + markerHeight > 0;
  const pointer = offMapPointer(marker.x + markerWidth / 2, marker.y + markerHeight / 2);

  return (
    <div className="minimap">
      <div className="minimap__bar">
        <span>map</span>
        <button
          type="button"
          className="minimap__hide"
          title="Hide the map"
          onClick={() => {
            setCollapsed(true);
          }}
        >
          −
        </button>
      </div>
      <svg
        ref={surfaceRef}
        className="minimap__surface"
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        onPointerDown={(event) => {
          event.stopPropagation();
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          steer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (dragging.current) {
            steer(event.clientX, event.clientY);
          }
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        {edges.value.map((edge) => {
          const from = nodes.value.find((node) => node.id === edge.from);
          const to = nodes.value.find((node) => node.id === edge.to);
          if (!from || !to) {
            return null;
          }
          const fromSize = sizeOf(from.id);
          const toSize = sizeOf(to.id);
          const start = project(
            projection,
            from.x + fromSize.width / 2,
            from.y + fromSize.height / 2,
          );
          const end = project(projection, to.x + toSize.width / 2, to.y + toSize.height / 2);
          return (
            <line
              key={edge.id}
              className="minimap__wire"
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
            />
          );
        })}
        {cards.map((node) => {
          const size = sizeOf(node.id);
          const at = project(projection, node.x, node.y);
          const selected = selectedId.value === node.id;
          return (
            <rect
              key={node.id}
              className={`minimap__node minimap__node--${node.kind}${selected ? " minimap__node--selected" : ""}`}
              x={at.x}
              y={at.y}
              width={Math.max(size.width * scale, 3)}
              height={Math.max(size.height * scale, 3)}
              rx={1.5}
            />
          );
        })}
        {onMap ? (
          <rect
            className="minimap__view"
            x={marker.x}
            y={marker.y}
            width={markerWidth}
            height={markerHeight}
            rx={2}
          />
        ) : (
          <g
            className="minimap__away"
            transform={`translate(${pointer.x}, ${pointer.y}) rotate(${pointer.angle})`}
          >
            <path d="M 0 -6 L 11 0 L 0 6 Z" />
            <title>The window is off the map, this way. Press the map to come back.</title>
          </g>
        )}
      </svg>
    </div>
  );
}

export { Minimap };
