import { config } from "@hw/ostrov-prototype-v2-config";
import type { BuildingId } from "../buildings/catalog";
import type { RoadLeg } from "../economy/routes";
import { chainSegments, territoryEdges } from "../hex/borders";
import type { Axial } from "../hex/coords";
import { HEX_DIRECTIONS, hexKey } from "../hex/coords";
import type { Point } from "../hex/layout";
import { HEX_SIZE, SQUASH, WALL_DEPTH, WALL_EDGES, hexCorners, hexToWorld } from "../hex/layout";
import type { Tile } from "../map/island";
import { OWNER_ENEMY, OWNER_PLAYER } from "../map/island";
import type { Island, Rect, WorldMap } from "../map/world";
import type { PlacedBuilding } from "../state/buildings";
import type { Camera } from "../state/camera";
import type { FogSnapshot } from "../state/fog";
import type { Delivery, Parcel, Stall } from "../state/parcels";
import type { Unit } from "../state/units";
import {
  buildingHeight,
  drawBuilding,
  drawBuildingHud,
  drawGhost,
  drawGhostTile,
  drawRefusalLabel,
  traceBuildingOccluder,
  traceGhostOccluder,
} from "./buildingArt";
import { drawDelivery, drawParcel, drawRoads, drawStallBadge } from "./parcelArt";
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
import type { FogPaint } from "./fogTint";
import { fogPaint } from "./fogTint";
import { drawIslandShadow } from "./shadows";
import { drawTop, drawWalls, tracePath } from "./tiles";
import { drawRally, drawUnit } from "./unitArt";

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
  /** Fog levels of this frame, indexed by `Tile.index` and by island id. */
  fog: FogSnapshot;
  /** Bumped whenever ground changes hands; the territory outline caches on it. */
  territoryVersion: number;
  /** Crates on the road right now. Live data owned by `state/parcels.ts`. */
  parcels: readonly Parcel[];
  /** Every leg of every live road, each one exactly once. */
  roads: readonly RoadLeg[];
  /** Landings still playing their beat. */
  deliveries: readonly Delivery[];
  /** Producers with something to say, keyed by their hex. */
  stalls: ReadonlyMap<string, Stall>;
  /** Soldiers on the map right now. Live data owned by `state/units.ts`. */
  units: readonly Unit[];
  /** The selected barracks and where it sends its soldiers, or null. */
  rally: RallyLine | null;
  /** A refused rally point, still saying why. */
  notice: RallyMark | null;
};

/** The flag of the selected barracks, and the line running to it. */
type RallyLine = {
  from: Axial;
  to: Axial;
};

/** A hex the map is captioning, with the caption. */
type RallyMark = {
  hex: Axial;
  text: string;
};

/** Far enough outside any island to stand in for "the whole world" in a clip path. */
const WORLD_BOUND = 1e6;

/**
 * Camera scale below which tiles are painted flat.
 *
 * The world holds around eighty islands, and zoomed out far enough to see them
 * all every tile is a few pixels across — where a tree is one pixel, a stratum
 * in a cliff face is none, and both cost the same as they do close up. Under
 * this scale a tile becomes a flat top face over a flat skirt: two fills, no
 * gradients, no decoration, no clipping. The number is where a hex has shrunk to
 * roughly forty pixels, which is about where the decoration stops being legible.
 */
const COARSE_SCALE = 0.3;

/**
 * A tile as it reads from far away: the top face in its terrain colour, and one
 * flat skirt under whichever of its three lower edges is exposed.
 *
 * Drawn in the same back-to-front order as the detailed tile, so an island still
 * covers the one behind it exactly as it does close up. The fog reaches it
 * through `paint`, exactly as it reaches the detailed tile.
 */
function drawCoarseTile(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  corners: readonly Point[],
  hasNeighbour: (q: number, r: number) => boolean,
  paint: FogPaint,
): void {
  let skirt = false;
  ctx.beginPath();
  for (const edge of WALL_EDGES) {
    const offset = HEX_DIRECTIONS[edge]!;
    if (hasNeighbour(tile.q + offset.q, tile.r + offset.r)) {
      continue;
    }
    const from = corners[edge]!;
    const to = corners[(edge + 1) % 6]!;
    skirt = true;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(to.x, to.y + WALL_DEPTH);
    ctx.lineTo(from.x, from.y + WALL_DEPTH);
    ctx.closePath();
  }
  if (skirt) {
    ctx.fillStyle = paint.rockBottom;
    ctx.fill();
  }
  tracePath(ctx, corners);
  ctx.fillStyle = paint.style.top;
  ctx.fill();
}

/** One territory outline, already stitched into polylines. */
type Territory = {
  chains: Point[][];
  outer: string;
  inner: string;
  /** Island the outline belongs to, or null when it spans the player's holdings. */
  island: Island | null;
};

function rectsOverlap(left: Rect, right: Rect): boolean {
  return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
}

class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Crates of this frame, grouped by the hex they are over. Reused, never rebuilt. */
  private readonly byHexParcels = new Map<string, Parcel[]>();
  /** Soldiers of this frame, grouped the same way and for the same reason. */
  private readonly byHexUnits = new Map<string, Unit[]>();
  private borderSource: WorldMap | null = null;
  private borderVersion = -1;
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

    this.groupParcels(frame);
    this.groupUnits(frame);

    const ghostKey = frame.ghost ? hexKey(frame.ghost.hex.q, frame.ghost.hex.r) : null;
    const hasTile = (q: number, r: number): boolean => frame.world.byKey.has(hexKey(q, r));
    // One back-to-front pass over every tile of the world, with each tile's
    // building drawn right after its top face. A building therefore covers the
    // tiles behind it and is covered by everything in front of it, decoration
    // included. The pass walks the whole world in one order — islands are not
    // batched — so an island that happens to sit half a row behind another still
    // lands behind it. Off-screen islands are skipped by the flag, which is one
    // array read per tile, and below `COARSE_SCALE` the tiles that survive the
    // cull are painted flat instead of in full.
    const coarse = frame.camera.scale < COARSE_SCALE;
    this.drawShadows(frame);
    const levels = frame.fog.tile;
    let painted = 0;
    for (const tile of frame.world.tiles) {
      if (!this.visible[tile.islandId]) {
        continue;
      }
      // Never seen: not drawn at all, so the cloud layer behind is what the
      // player sees. This is also the cheapest fog state there is.
      const level = levels[tile.index]!;
      if (level <= 0) {
        continue;
      }
      painted += 1;
      const centre = hexToWorld(tile);
      const corners = hexCorners(centre);
      const key = hexKey(tile.q, tile.r);
      const paint = fogPaint(tile.terrain, level);
      if (coarse) {
        drawCoarseTile(ctx, tile, corners, hasTile, paint);
      } else {
        drawWalls(ctx, tile, corners, hasTile, paint);
        drawTop(ctx, tile, centre, corners, paint);
      }
      const building = byHex.get(key);
      if (building) {
        drawBuilding(ctx, building, centre, frame.now);
      }
      // Crates go down with the tile they are over, so a building in front of
      // one covers it exactly as it covers the ground.
      const carried = this.byHexParcels.get(key);
      if (carried) {
        for (const parcel of carried) {
          drawParcel(ctx, parcel, frame.now / 1000, level);
        }
      }
      // Soldiers go down with their tile too, and after the crates: both are on
      // the ground, and a unit walking past a crate should pass in front of it.
      // A unit over ground the player has never seen is not reached at all —
      // this whole branch is inside the `level <= 0` skip — so it walks on
      // invisibly and reappears with the ground it steps back onto.
      const standing = this.byHexUnits.get(key);
      if (standing) {
        for (const unit of standing) {
          drawUnit(ctx, unit, frame.now, level);
        }
      }
      if (frame.ghost && key === ghostKey) {
        drawGhost(ctx, frame.ghost.id, centre, frame.ghost.valid, frame.now / 1000);
      }
    }
    this.painted = painted;

    // The territory line and the cursor lie on the ground, so both are kept out
    // of the ground the buildings stand on.
    this.withoutBuildings(frame, () => {
      this.paintRoads(frame);
      this.drawTerritories(frame);
      if (frame.rally) {
        drawRally(
          ctx,
          hexToWorld(frame.rally.from),
          hexToWorld(frame.rally.to),
          frame.now / 1000,
          config.army.playerColor,
        );
      }
      if (frame.ghost) {
        drawGhostTile(ctx, hexToWorld(frame.ghost.hex), frame.ghost.valid, frame.now / 1000);
      }
      this.drawCursor(frame);
    });

    const bossLevel = frame.fog.island[frame.world.bossIsland.id] ?? 1;
    if (this.visible[frame.world.bossIsland.id] && bossLevel > 0) {
      drawBossMarker(ctx, hexToWorld(frame.world.bossIsland.origin), bossLevel);
    }

    for (const delivery of frame.deliveries) {
      drawDelivery(ctx, delivery, frame.now);
    }

    // Labels last: a progress bar, a stall pill and a refusal pill read as
    // captions on the scene, so nothing from the scene may run across them.
    for (const building of frame.buildings) {
      const centre = hexToWorld(building);
      drawBuildingHud(ctx, building, centre, frame.now);
      const stall = frame.stalls.get(hexKey(building.q, building.r));
      if (stall && building.state === "built") {
        drawStallBadge(ctx, centre, stall, buildingHeight(building.id) + HEX_SIZE * 0.42);
      }
    }
    if (frame.ghost && !frame.ghost.valid) {
      drawRefusalLabel(ctx, hexToWorld(frame.ghost.hex), frame.ghost.reason);
    }
    if (frame.notice) {
      drawRefusalLabel(ctx, hexToWorld(frame.notice.hex), frame.notice.text);
    }

    ctx.restore();
  }

  /**
   * Buckets the crates by the hex each is over. One pass, into a map that is
   * kept between frames and cleared rather than rebuilt, so a hundred crates in
   * flight allocate nothing.
   */
  private groupParcels(frame: Frame): void {
    for (const bucket of this.byHexParcels.values()) {
      bucket.length = 0;
    }
    for (const parcel of frame.parcels) {
      const bucket = this.byHexParcels.get(parcel.hex);
      if (bucket) {
        bucket.push(parcel);
        continue;
      }
      this.byHexParcels.set(parcel.hex, [parcel]);
    }
  }

  /**
   * The same bucketing for the soldiers. Within one hex they are drawn in id
   * order, so a formation never flickers back to front between frames.
   */
  private groupUnits(frame: Frame): void {
    for (const bucket of this.byHexUnits.values()) {
      bucket.length = 0;
    }
    for (const unit of frame.units) {
      const bucket = this.byHexUnits.get(unit.hex);
      if (bucket) {
        bucket.push(unit);
        continue;
      }
      this.byHexUnits.set(unit.hex, [unit]);
    }
  }

  /**
   * The cart tracks, laid with the territory line on ground the buildings do not
   * hide. A leg fades with the hex it runs across, so a road on remembered
   * ground is as dim as the ground under it and one on unseen ground is not
   * drawn at all.
   */
  private paintRoads(frame: Frame): void {
    drawRoads(this.ctx, frame.roads, (leg) => {
      const tile = frame.world.byKey.get(leg.hex);
      if (!tile || !this.visible[tile.islandId]) {
        return 0;
      }
      return frame.fog.tile[tile.index] ?? 1;
    });
  }

  /**
   * Flags the islands the viewport touches.
   *
   * The world is far larger than one screen, so most frames have most of it off
   * to the side. The test is one rectangle overlap per island, and the pad
   * covers the idle float, the cliff walls and the trees that reach past a tile.
   *
   * An island nobody has ever seen fails the same flag, so the fog costs the
   * tile loop nothing and saves it everything an unknown island would have cost.
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
    const known = frame.fog.islandExplored;
    for (const island of frame.world.islands) {
      this.visible[island.id] = known[island.id] === 1 && rectsOverlap(view, island.bounds);
    }
  }

  /**
   * The shade under every island on screen, laid down before a single tile.
   *
   * One pass for the whole world rather than one shadow per island interleaved
   * with its tiles: a shadow belongs under everything, and painting them all
   * first is what lets an island in front cover the shadow of an island behind.
   * An island the player has never seen is not in `visible` at all, so it casts
   * nothing — a lone blot of shade on empty cloud would say where it is.
   */
  private drawShadows(frame: Frame): void {
    if (!config.render.islandShadowEnabled) {
      return;
    }
    for (const island of frame.world.islands) {
      if (!this.visible[island.id]) {
        continue;
      }
      drawIslandShadow(this.ctx, island, frame.fog.island[island.id] ?? 1);
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
   * The owned outlines: the player's holdings in blue, the enemy's island in
   * red. Wild land carries no line at all, which is what makes the two starts
   * stand out from a periphery of a dozen other islands.
   *
   * The player's line is stitched from every tile they own anywhere, not from
   * the start island alone, so ground claimed on a second island gets an outline
   * of its own. That is a walk over the whole world, which is why it is cached
   * and rebuilt only when ground has actually changed hands.
   *
   * The enemy line is fog-gated: an island the player has never seen carries no
   * red outline, or the outline would announce where the enemy lives.
   */
  private drawTerritories(frame: Frame): void {
    if (!config.render.territoryBorderEnabled) {
      return;
    }
    if (this.borderSource !== frame.world || this.borderVersion !== frame.territoryVersion) {
      this.borderSource = frame.world;
      this.borderVersion = frame.territoryVersion;
      this.territories = [
        {
          chains: chainSegments(territoryEdges(frame.world.tiles, frame.world.ownerAt, OWNER_PLAYER)),
          outer: BORDER_DARK,
          inner: BORDER_BRIGHT,
          island: null,
        },
        {
          chains: chainSegments(territoryEdges(frame.world.enemyIsland.tiles, frame.world.ownerAt, OWNER_ENEMY)),
          outer: ENEMY_BORDER_DARK,
          inner: ENEMY_BORDER_BRIGHT,
          island: frame.world.enemyIsland,
        },
      ];
    }
    for (const territory of this.territories) {
      const level = territory.island ? (frame.fog.island[territory.island.id] ?? 1) : 1;
      if (level <= 0) {
        continue;
      }
      this.strokeChains(territory, level);
    }
  }

  private strokeChains(territory: Territory, level: number): void {
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
      ctx.globalAlpha = pass.alpha * level;
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
function drawBossMarker(ctx: CanvasRenderingContext2D, centre: Point, level: number): void {
  const radius = HEX_SIZE * 0.28;
  ctx.save();
  // The marker fades with the island it stands on, so a remembered boss island
  // keeps its bead without it burning through the fog.
  ctx.globalAlpha = level;
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

export type { Frame, GhostPreview, RallyLine, RallyMark };
export { Renderer };
