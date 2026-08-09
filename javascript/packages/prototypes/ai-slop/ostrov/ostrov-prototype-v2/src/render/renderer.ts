import { config } from "@hw/ostrov-prototype-v2-config";
import type { BuildingId } from "../buildings/catalog";
import { chainSegments, territoryEdges } from "../hex/borders";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import type { Point } from "../hex/layout";
import { HEX_SIZE, SQUASH, WALL_DEPTH, hexCorners, hexToWorld } from "../hex/layout";
import { OWNER_ENEMY, OWNER_PLAYER } from "../map/island";
import type { Rect, WorldMap } from "../map/world";
import type { PlacedBuilding } from "../state/buildings";
import type { Camera } from "../state/camera";
import {
  drawBuilding,
  drawBuildingHud,
  drawGhost,
  drawGhostTile,
  drawRefusalLabel,
  traceBuildingOccluder,
  traceGhostOccluder,
} from "./buildingArt";
import {
  BORDER_BRIGHT,
  BORDER_DARK,
  BORDER_SHEEN,
  BOSS_MARKER,
  ENEMY_BORDER_BRIGHT,
  ENEMY_BORDER_DARK,
  HOVER_FILL,
  HOVER_LINE,
  SELECT_LINE,
  withAlpha,
} from "./palette";
import { drawTop, drawWalls, tracePath } from "./tiles";

/** The preview the map draws under the cursor while a building is being placed. */
type GhostPreview = {
  id: BuildingId;
  hex: Axial;
  valid: boolean;
  /** Why the hex refuses the building. Empty while it accepts it. */
  reason: string;
};

type Frame = {
  world: WorldMap;
  camera: Camera;
  hovered: Axial | null;
  selected: Axial | null;
  /**
   * Idle drift of the island, in screen pixels, applied on top of the camera.
   * Anything turning a screen point back into a world point has to subtract it.
   */
  float: Point;
  /** `performance.now()` of this frame. Every animation is a function of it. */
  now: number;
  buildings: readonly PlacedBuilding[];
  ghost: GhostPreview | null;
};

/** Far enough outside any island to stand in for "the whole world" in a clip path. */
const WORLD_BOUND = 1e6;

/** One territory outline, already stitched into polylines. */
type Territory = {
  chains: Point[][];
  outer: string;
  inner: string;
};

function rectsOverlap(left: Rect, right: Rect): boolean {
  return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
}

class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private borderSource: WorldMap | null = null;
  private territories: Territory[] = [];
  /** Indexed by island id; rebuilt once per frame from the island bounds. */
  private visible: boolean[] = [];
  private width = 0;
  private height = 0;
  private ratio = 1;
  /** Tiles the last frame actually painted, for the performance readout. */
  private painted = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context is not available");
    }
    this.ctx = ctx;
  }

  /** Resizes the backing store so the picture stays crisp on retina screens. */
  resize(cssWidth: number, cssHeight: number, ratio: number): boolean {
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    if (width === this.width && height === this.height && ratio === this.ratio) {
      return false;
    }
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    return true;
  }

  get viewportWidth(): number {
    return this.width;
  }

  get viewportHeight(): number {
    return this.height;
  }

  /** How many tiles the last frame drew. Read by the culling measurement. */
  get paintedTiles(): number {
    return this.painted;
  }

  draw(frame: Frame): void {
    const { ctx } = this;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    // Cleared, not filled: the sky belongs to the WebGL layer under this canvas.
    ctx.clearRect(0, 0, this.width, this.height);

    this.markVisible(frame);

    ctx.save();
    ctx.translate(this.width / 2 + frame.float.x, this.height / 2 + frame.float.y);
    ctx.scale(frame.camera.scale, frame.camera.scale);
    ctx.translate(-frame.camera.x, -frame.camera.y);

    const byHex = new Map<string, PlacedBuilding>();
    for (const building of frame.buildings) {
      byHex.set(hexKey(building.q, building.r), building);
    }

    const ghostKey = frame.ghost ? hexKey(frame.ghost.hex.q, frame.ghost.hex.r) : null;
    const hasTile = (q: number, r: number): boolean => frame.world.byKey.has(hexKey(q, r));
    // One back-to-front pass over every tile of the world, with each tile's
    // building drawn right after its top face. A building therefore covers the
    // tiles behind it and is covered by everything in front of it, decoration
    // included. The pass walks the whole world in one order — islands are not
    // batched — so an island that happens to sit half a row behind another still
    // lands behind it. Off-screen islands are skipped by the flag, which is one
    // array read per tile.
    let painted = 0;
    for (const tile of frame.world.tiles) {
      if (!this.visible[tile.islandId]) {
        continue;
      }
      painted += 1;
      const centre = hexToWorld(tile);
      const corners = hexCorners(centre);
      const key = hexKey(tile.q, tile.r);
      drawWalls(ctx, tile, corners, hasTile);
      drawTop(ctx, tile, centre, corners);
      const building = byHex.get(key);
      if (building) {
        drawBuilding(ctx, building, centre, frame.now);
      }
      if (frame.ghost && key === ghostKey) {
        drawGhost(ctx, frame.ghost.id, centre, frame.ghost.valid, frame.now / 1000);
      }
    }
    this.painted = painted;

    // The territory line and the cursor lie on the ground, so both are kept out
    // of the ground the buildings stand on.
    this.withoutBuildings(frame, () => {
      this.drawTerritories(frame);
      if (frame.ghost) {
        drawGhostTile(ctx, hexToWorld(frame.ghost.hex), frame.ghost.valid, frame.now / 1000);
      }
      this.drawCursor(frame);
    });

    if (this.visible[frame.world.bossIsland.id]) {
      drawBossMarker(ctx, hexToWorld(frame.world.bossIsland.origin));
    }

    // Labels last: a progress bar and a refusal pill read as captions on the
    // scene, so nothing from the scene may run across them.
    for (const building of frame.buildings) {
      drawBuildingHud(ctx, building, hexToWorld(building), frame.now);
    }
    if (frame.ghost && !frame.ghost.valid) {
      drawRefusalLabel(ctx, hexToWorld(frame.ghost.hex), frame.ghost.reason);
    }

    ctx.restore();
  }

  /**
   * Flags the islands the viewport touches.
   *
   * The world is far larger than one screen, so most frames have most of it off
   * to the side. The test is one rectangle overlap per island, and the pad
   * covers the idle float, the cliff walls and the trees that reach past a tile.
   */
  private markVisible(frame: Frame): void {
    const halfWidth = this.width / (2 * frame.camera.scale);
    const halfHeight = this.height / (2 * frame.camera.scale);
    const pad = HEX_SIZE + WALL_DEPTH + Math.max(Math.abs(frame.float.x), Math.abs(frame.float.y));
    const view: Rect = {
      minX: frame.camera.x - halfWidth - pad,
      maxX: frame.camera.x + halfWidth + pad,
      minY: frame.camera.y - halfHeight - pad,
      maxY: frame.camera.y + halfHeight + pad,
    };
    this.visible.length = frame.world.islands.length;
    for (const island of frame.world.islands) {
      this.visible[island.id] = rectsOverlap(view, island.bounds);
    }
  }

  /**
   * Runs `paint` with everything the buildings hide clipped away. The clip is the
   * whole world with one hole punched per building, resolved by the even-odd
   * rule, which is why every outline has to be a single closed loop.
   */
  private withoutBuildings(frame: Frame, paint: () => void): void {
    const { ctx } = this;
    if (frame.buildings.length === 0 && !frame.ghost) {
      paint();
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(-WORLD_BOUND, -WORLD_BOUND, WORLD_BOUND * 2, WORLD_BOUND * 2);
    for (const building of frame.buildings) {
      traceBuildingOccluder(ctx, building, hexToWorld(building), frame.now);
    }
    if (frame.ghost) {
      traceGhostOccluder(ctx, frame.ghost.id, hexToWorld(frame.ghost.hex));
    }
    ctx.clip("evenodd");
    paint();
    ctx.restore();
  }

  /**
   * The owned outlines: the player's island in blue, the enemy's in red. Wild
   * land carries no line at all, which is what makes the two starts stand out
   * from a periphery of a dozen other islands.
   */
  private drawTerritories(frame: Frame): void {
    if (!config.render.territoryBorderEnabled) {
      return;
    }
    if (this.borderSource !== frame.world) {
      this.borderSource = frame.world;
      this.territories = [
        {
          chains: chainSegments(territoryEdges(frame.world.playerIsland.tiles, frame.world.ownerAt, OWNER_PLAYER)),
          outer: BORDER_DARK,
          inner: BORDER_BRIGHT,
        },
        {
          chains: chainSegments(territoryEdges(frame.world.enemyIsland.tiles, frame.world.ownerAt, OWNER_ENEMY)),
          outer: ENEMY_BORDER_DARK,
          inner: ENEMY_BORDER_BRIGHT,
        },
      ];
    }
    for (const territory of this.territories) {
      this.strokeChains(territory);
    }
  }

  private strokeChains(territory: Territory): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const passes: readonly { width: number; colour: string; alpha: number }[] = [
      { width: config.render.borderOuterWidth, colour: territory.outer, alpha: 1 },
      { width: config.render.borderInnerWidth, colour: territory.inner, alpha: 1 },
      { width: config.render.borderSheenWidth, colour: BORDER_SHEEN, alpha: config.render.borderSheenAlpha },
    ];
    for (const pass of passes) {
      ctx.globalAlpha = pass.alpha;
      ctx.strokeStyle = pass.colour;
      ctx.lineWidth = pass.width;
      for (const chain of territory.chains) {
        ctx.beginPath();
        ctx.moveTo(chain[0]!.x, chain[0]!.y);
        for (let index = 1; index < chain.length; index += 1) {
          ctx.lineTo(chain[index]!.x, chain[index]!.y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawCursor(frame: Frame): void {
    const { ctx } = this;
    const { hovered, selected } = frame;
    // In placement mode the preview is the hover response, so the plain white
    // hover ring stays out of its way.
    if (!frame.ghost && hovered && frame.world.byKey.has(hexKey(hovered.q, hovered.r))) {
      const corners = hexCorners(hexToWorld(hovered));
      tracePath(ctx, corners);
      ctx.fillStyle = HOVER_FILL;
      ctx.fill();
      ctx.strokeStyle = HOVER_LINE;
      ctx.lineWidth = config.render.hoverLineWidth;
      ctx.stroke();
    }
    if (selected && frame.world.byKey.has(hexKey(selected.q, selected.r))) {
      const corners = hexCorners(hexToWorld(selected));
      tracePath(ctx, corners);
      ctx.strokeStyle = SELECT_LINE;
      ctx.lineWidth = config.render.selectLineWidth;
      ctx.shadowColor = withAlpha(config.render.selectColor, 0.8);
      ctx.shadowBlur = config.render.selectGlowBlur;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

/**
 * The boss: a red bead on a dark plinth on the middle hex of the centre island.
 *
 * It is deliberately still. A pulse would keep asking the loop for frames for as
 * long as the island is on screen, and this is a map marker, not a creature.
 */
function drawBossMarker(ctx: CanvasRenderingContext2D, centre: Point): void {
  const radius = HEX_SIZE * 0.28;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y + radius * 0.55, radius * 1.15, radius * 1.15 * SQUASH, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 8, 12, 0.45)";
  ctx.fill();

  const glow = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius * 3);
  glow.addColorStop(0, withAlpha(BOSS_MARKER, 0.5));
  glow.addColorStop(1, withAlpha(BOSS_MARKER, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = BOSS_MARKER;
  ctx.fill();
  ctx.strokeStyle = "rgba(48, 6, 6, 0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centre.x - radius * 0.3, centre.y - radius * 0.34, radius * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 206, 200, 0.8)";
  ctx.fill();
  ctx.restore();
}

export type { Frame, GhostPreview };
export { Renderer };
