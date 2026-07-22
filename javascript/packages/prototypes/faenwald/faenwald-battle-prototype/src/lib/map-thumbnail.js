import { DEFAULT_TERRAIN_ID, TERRAINS } from "../data/terrains.js";
import { gridPixelBounds, offsetToPixel } from "./hex-layout.js";
import { renderPointTopHexagon } from "./hexagon-render.js";

/**
 * Renders a map's full hex grid into an offscreen canvas and returns it as a
 * PNG data URL — the store-tile preview.
 *
 * Same fills and grid strokes as the editor canvas, so the thumbnail is a
 * faithful mini-map; the transparent background lets the tile's card
 * background show through the letterboxing.
 */

const HEX_HEIGHT = 128; // world units, top vertex to bottom vertex
const HEX_SIZE = HEX_HEIGHT / 2; // circumradius
const THUMB_HEIGHT = 240; // px — 2× the 120px preview slot, crisp on retina
const GRID_STROKE_PX = 1; // device px, matches the editor's grid line

const renderMapThumbnail = (map) => {
  /**
   * Terrain tokens live on :root — resolve them at generation time, like the
   * editor does per session.
   */
  const styles = getComputedStyle(document.documentElement);
  const fillByTerrain = Object.fromEntries(
    TERRAINS.map((t) => [t.id, styles.getPropertyValue(t.color).trim()]),
  );
  const gridColor = styles.getPropertyValue("--terrain-grid").trim();

  const bounds = gridPixelBounds(map.width, map.height, HEX_SIZE);
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;

  // half a stroke on each side so edge hex borders aren't clipped
  const scale = (THUMB_HEIGHT - GRID_STROKE_PX) / boundsHeight;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(boundsWidth * scale + GRID_STROKE_PX);
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    GRID_STROKE_PX / 2 - bounds.minX * scale,
    GRID_STROKE_PX / 2 - bounds.minY * scale,
  );

  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const { x, y } = offsetToPixel(col, row, HEX_SIZE);
      renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
        fill: { style: fillByTerrain[map.cells[row][col]] ?? fillByTerrain[DEFAULT_TERRAIN_ID] },
        stroke: { style: gridColor, width: GRID_STROKE_PX / scale },
      });
    }
  }

  return canvas.toDataURL("image/png");
};

export { renderMapThumbnail };
