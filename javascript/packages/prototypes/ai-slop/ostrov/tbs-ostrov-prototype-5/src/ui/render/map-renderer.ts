import { neighbourIndexInDirection } from "../../domain/hex/coords";
import { HEX_CORNER_ANGLES, mapPixelSize, offsetToPixel } from "../../domain/hex/layout";
import { BUILDING_DEFS } from "../../domain/game/buildings";
import {
  COAST_STROKE,
  GRID_STROKE,
  HOVER_OUTLINE,
  IDLE_BADGE,
  OCEAN_BACKDROP,
  PLACEABLE_OUTLINE,
  SELECTED_OUTLINE,
  SITE_STROKE,
  TERRAIN_STYLES,
} from "./palette";
import type { TBuildingKind, TPlacedBuilding } from "../../domain/game/types";
import type { TWorld } from "../../domain/world/types";

type TRenderOptions = {
  world: TWorld;
  buildings: readonly (TPlacedBuilding | null)[];
  hexSize: number;
  hoveredIndex: number;
  selectedIndex: number;
  pendingKind: TBuildingKind | null;
  working: ReadonlySet<number>;
  idle: ReadonlySet<number>;
  showYields: boolean;
};

type TRgb = {
  r: number;
  g: number;
  b: number;
};

const rgbCache = new Map<string, TRgb>();

const parseHexColour = (colour: string): TRgb => {
  const cached = rgbCache.get(colour);
  if (cached) {
    return cached;
  }

  const value = Number.parseInt(colour.slice(1), 16);
  const rgb = { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  rgbCache.set(colour, rgb);

  return rgb;
};

const shade = (colour: string, factor: number): string => {
  const { r, g, b } = parseHexColour(colour);
  const clamp = (channel: number) => Math.min(255, Math.max(0, Math.round(channel * factor)));

  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
};

const traceHex = (context: CanvasRenderingContext2D, x: number, y: number, size: number): void => {
  context.beginPath();
  for (let corner = 0; corner < HEX_CORNER_ANGLES.length; corner += 1) {
    const angle = HEX_CORNER_ANGLES[corner]!;
    const cornerX = x + size * Math.cos(angle);
    const cornerY = y + size * Math.sin(angle);
    if (corner === 0) {
      context.moveTo(cornerX, cornerY);

      continue;
    }
    context.lineTo(cornerX, cornerY);
  }
  context.closePath();
};

/** Land brightens as it rises, water darkens as it deepens. */
const tileFill = (fill: string, height: number, isLand: boolean, seaLevel: number): string => {
  if (isLand) {
    const above = seaLevel >= 1 ? 0 : (height - seaLevel) / (1 - seaLevel);

    return shade(fill, 0.86 + 0.3 * Math.min(1, Math.max(0, above)));
  }

  const depth = seaLevel <= 0 ? 0 : Math.min(1, Math.max(0, (seaLevel - height) / seaLevel));

  return shade(fill, 1.12 - 0.5 * depth);
};

const drawBuilding = (
  context: CanvasRenderingContext2D,
  building: TPlacedBuilding,
  x: number,
  y: number,
  size: number,
  isIdle: boolean
): void => {
  const definition = BUILDING_DEFS[building.kind];
  const glyphSize = Math.max(11, size * 0.86);

  if (building.remaining > 0) {
    context.save();
    context.strokeStyle = SITE_STROKE;
    context.lineWidth = 2;
    context.setLineDash([4, 3]);
    context.beginPath();
    context.arc(x, y, size * 0.52, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    context.globalAlpha = 0.55;
  }

  context.font = `${glyphSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(definition.glyph, x, y + glyphSize * 0.04);
  context.globalAlpha = 1;

  if (building.remaining > 0) {
    context.fillStyle = SITE_STROKE;
    context.font = `600 ${Math.max(9, size * 0.42)}px system-ui, sans-serif`;
    context.fillText(`${building.remaining}`, x, y + size * 0.62);

    return;
  }

  if (isIdle) {
    context.fillStyle = IDLE_BADGE;
    context.beginPath();
    context.arc(x + size * 0.42, y - size * 0.42, Math.max(3, size * 0.14), 0, Math.PI * 2);
    context.fill();
  }
};

const drawMap = (canvas: HTMLCanvasElement, options: TRenderOptions): void => {
  const { world, hexSize } = options;
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const pixelSize = mapPixelSize(world.width, world.height, hexSize);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const cssWidth = Math.ceil(pixelSize.x);
  const cssHeight = Math.ceil(pixelSize.y);

  if (canvas.width !== Math.round(cssWidth * ratio) || canvas.height !== Math.round(cssHeight * ratio)) {
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
  }
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = OCEAN_BACKDROP;
  context.fillRect(0, 0, cssWidth, cssHeight);

  const pendingTerrain = options.pendingKind === null ? null : BUILDING_DEFS[options.pendingKind].terrain;

  for (const tile of world.tiles) {
    const centre = offsetToPixel(tile.col, tile.row, hexSize);
    context.fillStyle = tileFill(TERRAIN_STYLES[tile.terrain].fill, tile.height, tile.isLand, world.seaLevel);
    traceHex(context, centre.x, centre.y, hexSize);
    context.fill();

    if (tile.isLand) {
      context.strokeStyle = GRID_STROKE;
      context.lineWidth = 0.75;
      context.stroke();
    }
  }

  context.lineWidth = Math.max(1.2, hexSize * 0.1);
  context.lineCap = "round";
  context.strokeStyle = COAST_STROKE;

  for (const tile of world.tiles) {
    if (!tile.isCoast) {
      continue;
    }

    const centre = offsetToPixel(tile.col, tile.row, hexSize);
    for (let direction = 0; direction < 6; direction += 1) {
      const neighbour = neighbourIndexInDirection(tile.index, direction, world.width, world.height);
      if (neighbour !== -1 && world.tiles[neighbour]!.isLand) {
        continue;
      }

      const first = HEX_CORNER_ANGLES[direction]!;
      const second = HEX_CORNER_ANGLES[(direction + 1) % 6]!;
      context.beginPath();
      context.moveTo(centre.x + hexSize * Math.cos(first), centre.y + hexSize * Math.sin(first));
      context.lineTo(centre.x + hexSize * Math.cos(second), centre.y + hexSize * Math.sin(second));
      context.stroke();
    }
  }

  if (pendingTerrain !== null) {
    context.strokeStyle = PLACEABLE_OUTLINE;
    context.lineWidth = 2;
    for (const tile of world.tiles) {
      if (tile.terrain !== pendingTerrain || options.buildings[tile.index]) {
        continue;
      }

      const centre = offsetToPixel(tile.col, tile.row, hexSize);
      traceHex(context, centre.x, centre.y, hexSize * 0.88);
      context.stroke();
    }
  }

  if (options.showYields) {
    for (const building of options.buildings) {
      if (!building) {
        continue;
      }

      const tile = world.tiles[building.tileIndex]!;
      const centre = offsetToPixel(tile.col, tile.row, hexSize);
      drawBuilding(context, building, centre.x, centre.y, hexSize, options.idle.has(building.tileIndex));
    }
  }

  const hovered = world.tiles[options.hoveredIndex];
  if (hovered) {
    const centre = offsetToPixel(hovered.col, hovered.row, hexSize);
    context.strokeStyle = HOVER_OUTLINE;
    context.lineWidth = 2;
    traceHex(context, centre.x, centre.y, hexSize * 0.96);
    context.stroke();
  }

  const selected = world.tiles[options.selectedIndex];
  if (selected) {
    const centre = offsetToPixel(selected.col, selected.row, hexSize);
    context.strokeStyle = SELECTED_OUTLINE;
    context.lineWidth = 3;
    traceHex(context, centre.x, centre.y, hexSize * 0.92);
    context.stroke();
  }
};

export type { TRenderOptions };
export { drawMap };
