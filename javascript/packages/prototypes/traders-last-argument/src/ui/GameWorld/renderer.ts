import { MAP_CONFIG } from "@/config/map";
import { TileType, ObjectType } from "@/core/types";
import type { GameMap, Pawn } from "@/core/types";
import type { Camera } from "@/engine/camera";

const TILE_COLORS: Record<TileType, string> = {
  [TileType.FertileLand]: "#4a7c3f",
  [TileType.Mountain]: "#8b8b83",
};

const OBJECT_ICONS: Record<ObjectType, string> = {
  [ObjectType.Tree]: "\u{1F332}",
  [ObjectType.Stone]: "\u{1FAA8}",
};

function renderMap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const { tileSize, width, height } = MAP_CONFIG;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Viewport culling: determine visible tile range
  const startCol = Math.max(0, Math.floor(-camera.x / camera.zoom / tileSize));
  const startRow = Math.max(0, Math.floor(-camera.y / camera.zoom / tileSize));
  const endCol = Math.min(
    width - 1,
    Math.ceil((-camera.x / camera.zoom + canvasWidth / camera.zoom) / tileSize),
  );
  const endRow = Math.min(
    height - 1,
    Math.ceil((-camera.y / camera.zoom + canvasHeight / camera.zoom) / tileSize),
  );

  // Draw tiles in screen space — integer pixel coords eliminate sub-pixel gaps
  const scaledTile = Math.ceil(tileSize * camera.zoom) + 1;

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const tile = map[row][col];
      const sx = Math.floor(col * tileSize * camera.zoom + camera.x);
      const sy = Math.floor(row * tileSize * camera.zoom + camera.y);

      ctx.fillStyle = TILE_COLORS[tile.type];
      ctx.fillRect(sx, sy, scaledTile, scaledTile);

      if (tile.object) {
        const fontSize = tileSize * camera.zoom * 0.6;
        ctx.font = `${fontSize}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          OBJECT_ICONS[tile.object],
          sx + scaledTile / 2,
          sy + scaledTile / 2,
        );
      }
    }
  }
}

function renderPawns(
  ctx: CanvasRenderingContext2D,
  pawns: Pawn[],
  camera: Camera,
  selectedPawnId: number | null,
): void {
  const { tileSize } = MAP_CONFIG;

  for (const pawn of pawns) {
    const sx = Math.floor(pawn.x * tileSize * camera.zoom + camera.x);
    const sy = Math.floor(pawn.y * tileSize * camera.zoom + camera.y);
    const scaledTile = Math.ceil(tileSize * camera.zoom);

    // Selection highlight
    if (pawn.id === selectedPawnId) {
      const radius = scaledTile * 0.45;
      ctx.beginPath();
      ctx.arc(sx + scaledTile / 2, sy + scaledTile / 2, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Pawn icon
    const fontSize = tileSize * camera.zoom * 0.6;
    ctx.font = `${fontSize}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u{1F9D1}", sx + scaledTile / 2, sy + scaledTile / 2);
  }
}

export { renderMap, renderPawns };
