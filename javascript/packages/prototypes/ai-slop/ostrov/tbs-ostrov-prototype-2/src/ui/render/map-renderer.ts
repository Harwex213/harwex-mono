import { HEX_CORNER_ANGLES, hexWidth, mapPixelSize } from "../../domain/hex/layout";
import { neighbourIndexInDirection } from "../../domain/hex/coords";
import { visibleRange } from "../../domain/hex/camera";
import {
  DIM_WASH,
  GRID_STROKE,
  HOVER_OUTLINE,
  ISLAND_OUTLINE,
  OCEAN_BACKDROP,
  SELECTED_OUTLINE,
  SHADES_PER_TERRAIN,
  SHADE_STEPS,
  TERRAIN_SHADES,
} from "./palette";
import type { TCamera, TViewport, TVisibleRange } from "../../domain/hex/camera";
import type { THexMap } from "../../domain/generator/types";

/**
 * Hex size, in pixels, of the offscreen picture of the whole map. Zoomed out
 * further than this the viewport just blits a scaled slice of that picture:
 * drawing 160 000 hexes costs about sixty milliseconds, which is fine once per
 * map but far too slow once per pan frame. Zoomed in closer, the viewport draws
 * the cells it can actually see, which by then is a few thousand.
 */
const OVERVIEW_MAX_HEX = 4;

/**
 * Ceiling on the size of that picture. At four pixels per hex an 800x800 map
 * would need a 5548x4804 canvas, which is over a hundred megabytes; the overview
 * is drawn coarser instead, and the viewport switches to drawing live cells at a
 * correspondingly lower zoom.
 */
const OVERVIEW_PIXEL_BUDGET = 12_000_000;

/** Grid lines are noise below this hex size, and would swallow the fill. */
const GRID_MIN_ZOOM = 6;

type TDrawFlags = {
  showGrid: boolean;
  showIslandOutlines: boolean;
  showElevationShading: boolean;
};

/** Maps unit world space onto the target canvas: `screen = world * scale + origin`. */
type TPaint = {
  scale: number;
  originX: number;
  originY: number;
};

/** The offscreen picture of a whole map, and the hex size it was drawn at. */
type TOverview = {
  canvas: HTMLCanvasElement;
  hexSize: number;
};

type TViewportOptions = {
  map: THexMap;
  overview: TOverview | null;
  camera: TCamera;
  viewport: TViewport;
  hoveredIndex: number;
  selectedIslandId: number;
  flags: TDrawFlags;
};

const CORNER_COS = HEX_CORNER_ANGLES.map((angle) => Math.cos(angle));
const CORNER_SIN = HEX_CORNER_ANGLES.map((angle) => Math.sin(angle));

/**
 * Traces one hex into the context's current path. Everything here draws hex by
 * hex rather than collecting the map into one big `Path2D`: a path holding all
 * 160 000 hexes takes over a second just to build, while the same hexes drawn
 * one at a time take about sixty milliseconds.
 */
const traceHex = (context: CanvasRenderingContext2D, x: number, y: number, size: number): void => {
  context.moveTo(x + size * CORNER_COS[0]!, y + size * CORNER_SIN[0]!);
  context.lineTo(x + size * CORNER_COS[1]!, y + size * CORNER_SIN[1]!);
  context.lineTo(x + size * CORNER_COS[2]!, y + size * CORNER_SIN[2]!);
  context.lineTo(x + size * CORNER_COS[3]!, y + size * CORNER_SIN[3]!);
  context.lineTo(x + size * CORNER_COS[4]!, y + size * CORNER_SIN[4]!);
  context.lineTo(x + size * CORNER_COS[5]!, y + size * CORNER_SIN[5]!);
  context.closePath();
};

/** Index into `TERRAIN_SHADES` for one cell. */
const shadeSlot = (map: THexMap, index: number, shading: boolean): number => {
  const terrain = map.cells.terrain[index]!;
  if (!shading) {
    return terrain * SHADES_PER_TERRAIN + SHADE_STEPS;
  }

  const { seaLevel } = map.params;
  let position = 0;
  if (map.cells.isLand[index] === 1) {
    position = map.cells.elevation[index]!;
  } else if (seaLevel > 0) {
    position = (seaLevel - map.cells.height[index]!) / seaLevel;
  }

  const step = Math.min(SHADE_STEPS - 1, Math.max(0, Math.floor(position * SHADE_STEPS)));

  return terrain * SHADES_PER_TERRAIN + step;
};

/**
 * Fills every cell of `range`. Passing `onlyIsland` restricts the fill to a
 * single island, which is how the selected island is lifted back out of the
 * dimming wash.
 */
const paintCells = (
  context: CanvasRenderingContext2D,
  map: THexMap,
  range: TVisibleRange,
  paint: TPaint,
  flags: TDrawFlags,
  onlyIsland: number = -1
): void => {
  const size = paint.scale;
  const columnWidth = hexWidth(size);
  const drawGrid = flags.showGrid && size >= GRID_MIN_ZOOM;
  let currentSlot = -1;

  if (drawGrid) {
    context.strokeStyle = GRID_STROKE;
    context.lineWidth = 0.5;
  }

  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    const rowStart = row * map.width;
    const y = (1.5 * row + 1) * size + paint.originY;
    const rowShift = (0.5 * (row & 1) + 0.5) * columnWidth + paint.originX;

    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      const index = rowStart + col;
      if (onlyIsland !== -1 && map.cells.islandId[index] !== onlyIsland) {
        continue;
      }

      const slot = shadeSlot(map, index, flags.showElevationShading);
      if (slot !== currentSlot) {
        context.fillStyle = TERRAIN_SHADES[slot]!;
        currentSlot = slot;
      }

      context.beginPath();
      traceHex(context, col * columnWidth + rowShift, y, size);
      context.fill();
      if (drawGrid) {
        context.stroke();
      }
    }
  }
};

/** Strokes the edges where land meets water or a different island. */
const paintOutlines = (
  context: CanvasRenderingContext2D,
  map: THexMap,
  range: TVisibleRange,
  paint: TPaint,
  colour: string,
  onlyIsland: number = -1
): void => {
  const size = paint.scale;
  const columnWidth = hexWidth(size);

  context.strokeStyle = colour;
  context.lineWidth = Math.max(0.7, size * 0.14);
  context.lineCap = "round";

  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    const rowStart = row * map.width;
    const y = (1.5 * row + 1) * size + paint.originY;
    const rowShift = (0.5 * (row & 1) + 0.5) * columnWidth + paint.originX;

    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      const index = rowStart + col;
      const islandId = map.cells.islandId[index]!;
      if (islandId === -1) {
        continue;
      }
      if (onlyIsland !== -1 && islandId !== onlyIsland) {
        continue;
      }

      const x = col * columnWidth + rowShift;
      let traced = false;

      for (let direction = 0; direction < 6; direction += 1) {
        const neighbour = neighbourIndexInDirection(index, direction, map.width, map.height);
        if (neighbour !== -1 && map.cells.islandId[neighbour] === islandId) {
          continue;
        }

        if (!traced) {
          context.beginPath();
          traced = true;
        }

        const next = (direction + 1) % 6;
        context.moveTo(x + size * CORNER_COS[direction]!, y + size * CORNER_SIN[direction]!);
        context.lineTo(x + size * CORNER_COS[next]!, y + size * CORNER_SIN[next]!);
      }

      if (traced) {
        context.stroke();
      }
    }
  }
};

const wholeMapRange = (map: THexMap): TVisibleRange => ({
  minCol: 0,
  maxCol: map.width - 1,
  minRow: 0,
  maxRow: map.height - 1,
});

/** Largest hex size the overview can use for this map without blowing the budget. */
const overviewHexFor = (map: THexMap): number => {
  const unit = mapPixelSize(map.width, map.height, 1);

  return Math.min(OVERVIEW_MAX_HEX, Math.sqrt(OVERVIEW_PIXEL_BUDGET / (unit.x * unit.y)));
};

/** Renders the whole map once, as coarsely as the pixel budget demands. */
const buildOverview = (map: THexMap, flags: TDrawFlags): TOverview => {
  const hexSize = overviewHexFor(map);
  const size = mapPixelSize(map.width, map.height, hexSize);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size.x);
  canvas.height = Math.ceil(size.y);

  const context = canvas.getContext("2d");
  if (!context) {
    return { canvas, hexSize };
  }

  const range = wholeMapRange(map);
  const paint: TPaint = { scale: hexSize, originX: 0, originY: 0 };

  context.fillStyle = OCEAN_BACKDROP;
  context.fillRect(0, 0, canvas.width, canvas.height);
  paintCells(context, map, range, paint, { ...flags, showGrid: false });

  if (flags.showIslandOutlines) {
    paintOutlines(context, map, range, paint, ISLAND_OUTLINE);
  }

  return { canvas, hexSize };
};

/** World-space rectangle covering an island's cells, with half a hex of margin. */
const islandBounds = (map: THexMap, islandId: number) => {
  const island = map.islands[islandId];
  if (!island) {
    return null;
  }

  const columnWidth = hexWidth(1);
  const left = island.minCol * columnWidth;
  const top = 1.5 * island.minRow + 1;

  return {
    x: left - 0.2,
    y: top - 1.2,
    width: (island.maxCol - island.minCol) * columnWidth + columnWidth * 2,
    height: 1.5 * (island.maxRow - island.minRow) + 2.4,
  };
};

const drawViewport = (canvas: HTMLCanvasElement, options: TViewportOptions): void => {
  const { map, camera, viewport, flags } = options;
  const context = canvas.getContext("2d");
  if (!context || viewport.width <= 0 || viewport.height <= 0) {
    return;
  }

  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(viewport.width * ratio);
  const pixelHeight = Math.round(viewport.height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = OCEAN_BACKDROP;
  context.fillRect(0, 0, viewport.width, viewport.height);

  const paint: TPaint = {
    scale: camera.zoom,
    originX: viewport.width / 2 - camera.x * camera.zoom,
    originY: viewport.height / 2 - camera.y * camera.zoom,
  };
  const range = visibleRange(camera, viewport, map.width, map.height);
  const overview = options.overview;
  const useOverview = overview !== null && camera.zoom < overview.hexSize;

  if (useOverview && overview) {
    const blitScale = camera.zoom / overview.hexSize;
    context.drawImage(
      overview.canvas,
      paint.originX,
      paint.originY,
      overview.canvas.width * blitScale,
      overview.canvas.height * blitScale
    );
  } else {
    paintCells(context, map, range, paint, flags);
    if (flags.showIslandOutlines) {
      paintOutlines(context, map, range, paint, ISLAND_OUTLINE);
    }
  }

  const bounds = options.selectedIslandId === -1 ? null : islandBounds(map, options.selectedIslandId);
  if (bounds) {
    context.fillStyle = DIM_WASH;
    context.fillRect(0, 0, viewport.width, viewport.height);

    if (useOverview && overview) {
      // Lift the island back out of the wash by redrawing its corner of the
      // overview, then ring it so it is findable at a glance.
      context.drawImage(
        overview.canvas,
        bounds.x * overview.hexSize,
        bounds.y * overview.hexSize,
        bounds.width * overview.hexSize,
        bounds.height * overview.hexSize,
        bounds.x * camera.zoom + paint.originX,
        bounds.y * camera.zoom + paint.originY,
        bounds.width * camera.zoom,
        bounds.height * camera.zoom
      );
      context.strokeStyle = SELECTED_OUTLINE;
      context.lineWidth = 1.5;
      context.strokeRect(
        bounds.x * camera.zoom + paint.originX,
        bounds.y * camera.zoom + paint.originY,
        bounds.width * camera.zoom,
        bounds.height * camera.zoom
      );
    } else {
      paintCells(context, map, range, paint, flags, options.selectedIslandId);
      paintOutlines(context, map, range, paint, SELECTED_OUTLINE, options.selectedIslandId);
    }
  }

  const hovered = options.hoveredIndex;
  if (hovered >= 0 && hovered < map.cells.height.length) {
    const col = hovered % map.width;
    const row = (hovered - col) / map.width;
    const columnWidth = hexWidth(camera.zoom);
    const x = (col + 0.5 * (row & 1) + 0.5) * columnWidth + paint.originX;
    const y = (1.5 * row + 1) * camera.zoom + paint.originY;

    context.strokeStyle = HOVER_OUTLINE;
    context.lineWidth = 2;
    context.beginPath();
    traceHex(context, x, y, Math.max(3, camera.zoom));
    context.stroke();
  }
};

export type { TDrawFlags, TOverview };
export { buildOverview, drawViewport };
