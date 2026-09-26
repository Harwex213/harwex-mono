import farmArtUrl from "../../assets/buildings/farm.webp";
import masonsGuildArtUrl from "../../assets/buildings/masons-guild.webp";
import mineArtUrl from "../../assets/buildings/mine.webp";
import observatoryArtUrl from "../../assets/buildings/observatory.webp";
import sawmillArtUrl from "../../assets/buildings/sawmill.webp";
import universityArtUrl from "../../assets/buildings/university.webp";
import villageArtUrl from "../../assets/buildings/village.webp";
import {
  BIOMES,
  DEAD_HEX_TOXICITY,
  HEX_SIZE_PX,
  createRng,
  hashString,
  hexCorners,
  hexToPixel,
} from "../../core/exports";
import { PALETTE } from "../palette";
import { worldToScreen } from "./camera";
import type { TBiomeId, TBuildingId, THex, TIsland } from "../../core/exports";
import type { TCamera, TScreenPoint } from "../../store/ui-state";
import type { TViewport } from "./camera";

/**
 * Everything the island canvas paints, in one pure-ish function. The only state
 * it keeps is two caches: the procedural biome tiles and the seven building
 * images, both of which are expensive to rebuild every frame.
 *
 * Reference look: `docs/01-spec-images/01-spec-image-1.png` — biome-coloured
 * hexes, buildings centred on their hex, a bright ownership outline glowing
 * around the whole island.
 */

const BUILDING_ART: Readonly<Record<TBuildingId, string>> = {
  farm: farmArtUrl,
  sawmill: sawmillArtUrl,
  mine: mineArtUrl,
  village: villageArtUrl,
  masons_guild: masonsGuildArtUrl,
  observatory: observatoryArtUrl,
  university: universityArtUrl,
};

/** Side of one cached biome tile, in pixels. */
const SWATCH_TILE_PX = 160;
const SWATCH_SPECKLE_COUNT = 28;
const SWATCH_SPECKLE_MIN_RATIO = 0.02;
const SWATCH_SPECKLE_SPAN_RATIO = 0.07;
const SWATCH_SPECKLE_MIN_ALPHA = 0.08;
const SWATCH_SPECKLE_SPAN_ALPHA = 0.18;
const SWATCH_GRADIENT_SKEW = 0.35;

/** The building art is drawn this much wider than the hex, as in the reference. */
const ART_SIZE_RATIO = 1.4;

/** The outline sits this far outside the hex edge, as a share of the hex size. */
const BORDER_GROW_RATIO = 1.08;
const BORDER_GLOW_PX = 16;
const BORDER_BLOOM_PX = 34;

const HEX_EDGE_COLOUR = "rgba(6, 14, 26, 0.55)";
const HEX_EDGE_WIDTH_PX = 1;
const GLYPH_ALPHA = 0.3;
const GLYPH_SIZE_RATIO = 0.8;
const DEAD_HEX_COLOUR = "rgba(58, 62, 68, 0.82)";
const TOXIC_TINT_MAX_ALPHA = 0.5;
const DIM_OVERLAY_COLOUR = "rgba(4, 10, 20, 0.55)";
const LEGAL_PULSE_MIN_ALPHA = 0.1;
const LEGAL_PULSE_SPAN_ALPHA = 0.2;
const LEGAL_PULSE_PERIOD_MS = 1200;
const DEMOLISH_TINT_COLOUR = "rgba(255, 90, 70, 0.28)";
/** The purge cursor paints every poisoned hex in mana violet. */
const PURGE_TINT_COLOUR = "rgba(158, 112, 255, 0.38)";
const PURGE_EDGE_COLOUR = "rgba(196, 164, 255, 0.9)";
const HOVER_WIDTH_PX = 3;
const SELECTED_WIDTH_PX = 4;
const TOXICITY_LABEL_SIZE_RATIO = 0.26;
const TOXICITY_LABEL_OFFSET_RATIO = 0.62;
const TOXICITY_LABEL_MIN_PX = 9;
const FULL_TURN_RAD = Math.PI * 2;
const HALF = 2;
const CULL_MARGIN_RATIO = 2;
const PERCENT_SCALE = 100;

const swatchCache = new Map<TBiomeId, HTMLCanvasElement>();
const artImages = new Map<TBuildingId, HTMLImageElement>();
const artListeners = new Set<() => void>();

type TDrawIslandInput = {
  readonly island: TIsland;
  readonly camera: TCamera;
  readonly viewport: TViewport;
  /** The viewed player's pennant colour; the island outline glows in it. */
  readonly ownerColour: string;
  readonly hoveredHexId: string | null;
  readonly selectedHexId: string | null;
  /** The hexes the armed building may go on, or `null` when nothing is armed. */
  readonly legalHexIds: readonly string[] | null;
  readonly demolishMode: boolean;
  /** True while the purge cursor is armed: every poisoned hex glows violet. */
  readonly purgeMode: boolean;
  readonly nowMs: number;
};

/**
 * A biome swatch is generated, because the spec ships no biome art (plan §4.4):
 * the two-stop gradient of `BIOMES[id].colours` plus seeded speckles.
 */
const paintBiomeSwatch = (
  ctx: CanvasRenderingContext2D,
  biome: TBiomeId,
  width: number,
  height: number,
): void => {
  const info = BIOMES[biome];
  const gradient = ctx.createLinearGradient(0, 0, width * SWATCH_GRADIENT_SKEW, height);
  gradient.addColorStop(0, info.colours[0]);
  gradient.addColorStop(1, info.colours[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const rng = createRng(hashString(biome));
  const shortSide = Math.min(width, height);
  for (let index = 0; index < SWATCH_SPECKLE_COUNT; index += 1) {
    const centreX = rng.next() * width;
    const centreY = rng.next() * height;
    const radius = (SWATCH_SPECKLE_MIN_RATIO + rng.next() * SWATCH_SPECKLE_SPAN_RATIO) * shortSide;
    ctx.globalAlpha = SWATCH_SPECKLE_MIN_ALPHA + rng.next() * SWATCH_SPECKLE_SPAN_ALPHA;
    ctx.fillStyle = index % HALF === 0 ? info.colours[0] : info.colours[1];
    ctx.beginPath();
    ctx.arc(centreX, centreY, radius, 0, FULL_TURN_RAD);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

const swatchTile = (biome: TBiomeId): HTMLCanvasElement => {
  const cached = swatchCache.get(biome);
  if (cached !== undefined) {
    return cached;
  }

  const tile = document.createElement("canvas");
  tile.width = SWATCH_TILE_PX;
  tile.height = SWATCH_TILE_PX;
  const ctx = tile.getContext("2d");
  if (ctx !== null) {
    paintBiomeSwatch(ctx, biome, SWATCH_TILE_PX, SWATCH_TILE_PX);
  }
  swatchCache.set(biome, tile);

  return tile;
};

const artImage = (building: TBuildingId): HTMLImageElement => {
  const cached = artImages.get(building);
  if (cached !== undefined) {
    return cached;
  }

  const image = new Image();
  image.onload = () => {
    for (const listener of artListeners) {
      listener();
    }
  };
  image.src = BUILDING_ART[building];
  artImages.set(building, image);

  return image;
};

/** The canvas repaints once each building image has decoded. */
const subscribeBuildingArt = (listener: () => void): (() => void) => {
  artListeners.add(listener);

  return () => {
    artListeners.delete(listener);
  };
};

const hexPath = (centre: TScreenPoint, size: number): Path2D => {
  const path = new Path2D();
  const corners = hexCorners(centre.x, centre.y, size);
  corners.forEach((corner, index) => {
    if (index === 0) {
      path.moveTo(corner.x, corner.y);

      return;
    }
    path.lineTo(corner.x, corner.y);
  });
  path.closePath();

  return path;
};

const appendHexPath = (path: Path2D, centre: TScreenPoint, size: number): void => {
  const corners = hexCorners(centre.x, centre.y, size);
  corners.forEach((corner, index) => {
    if (index === 0) {
      path.moveTo(corner.x, corner.y);

      return;
    }
    path.lineTo(corner.x, corner.y);
  });
  path.closePath();
};

/**
 * The glowing ownership border: every hex is filled once, oversized, into a
 * single path. The real hexes then cover the middle and only the rim is left.
 * No edge-to-neighbour table is needed, so no hex math leaves `src/core`.
 */
const drawIslandBorder = (
  ctx: CanvasRenderingContext2D,
  centres: ReadonlyMap<string, TScreenPoint>,
  size: number,
  colour: string,
): void => {
  const border = new Path2D();
  for (const centre of centres.values()) {
    appendHexPath(border, centre, size * BORDER_GROW_RATIO);
  }

  ctx.save();
  ctx.fillStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = BORDER_GLOW_PX;
  ctx.fill(border);
  ctx.shadowBlur = BORDER_BLOOM_PX;
  ctx.fill(border);
  ctx.restore();
};

const drawHexGround = (
  ctx: CanvasRenderingContext2D,
  hex: THex,
  centre: TScreenPoint,
  size: number,
  path: Path2D,
): void => {
  ctx.save();
  ctx.clip(path);
  ctx.drawImage(swatchTile(hex.biome), centre.x - size, centre.y - size, size * HALF, size * HALF);

  if (hex.toxicity >= DEAD_HEX_TOXICITY) {
    ctx.fillStyle = DEAD_HEX_COLOUR;
    ctx.fillRect(centre.x - size, centre.y - size, size * HALF, size * HALF);
  } else if (hex.toxicity > 0) {
    ctx.globalAlpha = (hex.toxicity / PERCENT_SCALE) * TOXIC_TINT_MAX_ALPHA;
    ctx.fillStyle = PALETTE.toxic;
    ctx.fillRect(centre.x - size, centre.y - size, size * HALF, size * HALF);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  ctx.strokeStyle = HEX_EDGE_COLOUR;
  ctx.lineWidth = HEX_EDGE_WIDTH_PX;
  ctx.stroke(path);
};

const drawHexContent = (
  ctx: CanvasRenderingContext2D,
  hex: THex,
  centre: TScreenPoint,
  size: number,
): void => {
  if (hex.building === null) {
    ctx.save();
    ctx.globalAlpha = GLYPH_ALPHA;
    ctx.fillStyle = PALETTE.text;
    ctx.font = `${Math.round(size * GLYPH_SIZE_RATIO)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(BIOMES[hex.biome].glyph, centre.x, centre.y);
    ctx.restore();
  } else {
    const image = artImage(hex.building);
    if (image.complete === true && image.naturalWidth > 0) {
      const artSize = size * ART_SIZE_RATIO;
      ctx.drawImage(image, centre.x - artSize / HALF, centre.y - artSize / HALF, artSize, artSize);
    }
  }

  if (hex.toxicity > 0) {
    ctx.save();
    ctx.fillStyle = hex.toxicity >= DEAD_HEX_TOXICITY ? PALETTE.danger : PALETTE.toxic;
    ctx.font = `600 ${Math.max(TOXICITY_LABEL_MIN_PX, Math.round(size * TOXICITY_LABEL_SIZE_RATIO))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = PALETTE.bgDeep;
    ctx.lineWidth = HEX_EDGE_WIDTH_PX * HALF;
    ctx.strokeText(String(hex.toxicity), centre.x, centre.y + size * TOXICITY_LABEL_OFFSET_RATIO);
    ctx.fillText(String(hex.toxicity), centre.x, centre.y + size * TOXICITY_LABEL_OFFSET_RATIO);
    ctx.restore();
  }
};

const drawHexOverlay = (
  ctx: CanvasRenderingContext2D,
  hex: THex,
  path: Path2D,
  input: TDrawIslandInput,
  pulseAlpha: number,
): void => {
  const legal = input.legalHexIds;
  if (legal !== null) {
    ctx.save();
    if (legal.includes(hex.id) === true) {
      ctx.globalAlpha = pulseAlpha;
      ctx.fillStyle = PALETTE.toxic;
      ctx.fill(path);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = PALETTE.toxic;
      ctx.lineWidth = HOVER_WIDTH_PX;
      ctx.stroke(path);
    } else {
      ctx.fillStyle = DIM_OVERLAY_COLOUR;
      ctx.fill(path);
    }
    ctx.restore();
  }

  if (input.demolishMode === true) {
    ctx.save();
    ctx.fillStyle = DEMOLISH_TINT_COLOUR;
    ctx.fill(path);
    ctx.restore();
  }

  if (input.purgeMode === true && hex.toxicity > 0) {
    ctx.save();
    ctx.fillStyle = PURGE_TINT_COLOUR;
    ctx.fill(path);
    ctx.strokeStyle = PURGE_EDGE_COLOUR;
    ctx.lineWidth = HOVER_WIDTH_PX;
    ctx.stroke(path);
    ctx.restore();
  }

  if (hex.id === input.hoveredHexId) {
    ctx.save();
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = HOVER_WIDTH_PX;
    ctx.stroke(path);
    ctx.restore();
  }

  if (hex.id === input.selectedHexId) {
    ctx.save();
    ctx.strokeStyle = PALETTE.text;
    ctx.lineWidth = SELECTED_WIDTH_PX;
    ctx.shadowColor = PALETTE.gold;
    ctx.shadowBlur = BORDER_GLOW_PX;
    ctx.stroke(path);
    ctx.restore();
  }
};

const drawIsland = (ctx: CanvasRenderingContext2D, input: TDrawIslandInput): void => {
  const { camera, island, viewport } = input;
  const size = HEX_SIZE_PX * camera.scale;
  const hexes = Object.values(island.hexes);
  const centres = new Map<string, TScreenPoint>();
  for (const hex of hexes) {
    const world = hexToPixel(hex.q, hex.r, HEX_SIZE_PX);
    centres.set(hex.id, worldToScreen(world, camera, viewport));
  }

  drawIslandBorder(ctx, centres, size, input.ownerColour);

  const margin = size * CULL_MARGIN_RATIO;
  const phase = (input.nowMs % LEGAL_PULSE_PERIOD_MS) / LEGAL_PULSE_PERIOD_MS;
  const pulseAlpha = LEGAL_PULSE_MIN_ALPHA
    + LEGAL_PULSE_SPAN_ALPHA * (0.5 + 0.5 * Math.sin(phase * FULL_TURN_RAD));

  for (const hex of hexes) {
    const centre = centres.get(hex.id);
    if (centre === undefined) {
      continue;
    }
    if (centre.x < -margin || centre.x > viewport.width + margin) {
      continue;
    }
    if (centre.y < -margin || centre.y > viewport.height + margin) {
      continue;
    }

    const path = hexPath(centre, size);
    drawHexGround(ctx, hex, centre, size, path);
    drawHexContent(ctx, hex, centre, size);
    drawHexOverlay(ctx, hex, path, input, pulseAlpha);
  }
};

export type { TDrawIslandInput };

export { BUILDING_ART, drawIsland, paintBiomeSwatch, subscribeBuildingArt };
