import { CLEARED_HOLD, RETREAT_BAND, SINK_SECONDS, TICK_SECONDS } from "../../../core/cleanup-sim";
import { HEX_SIZE, hexToPixel } from "../../../core/hex";
import { getBuilding } from "../../../core/buildings";
import { ICONS } from "../../../core/icons";
import { STRONGHOLD_HEX_ART } from "../../../core/stronghold";
import type { TCleanupSim, TSimEvent, TSimIsland, TSimProjectile, TSimUnit } from "../../../core/cleanup-sim";
import type { TBuildingId } from "../../../core/types";
import type { TIslandSprite } from "./island-sprites";

/**
 * Draws one frame of the cleanup scene with Canvas 2D, in the ink-on-parchment
 * style of the globe. This canvas is transparent: the WebGL sky shows below
 * it and the WebGL veil lies above it (`sky-gl.ts`).
 *
 * Every moving thing is drawn between its previous and its current tick, by
 * `alpha`, so the scene moves smoothly while the sim ticks at 30 Hz. The
 * islands hang in the sky: each one bobs a little and casts its shadow on the
 * cloud layer far below, which moves with a smaller parallax.
 */

const UNIT_SPAN = 40;
const FLYER_SPAN = 42;
const FLYER_LIFT = 26;
const BAR_WIDTH = 30;
const BAR_HEIGHT = 4;
const LUNGE_SECONDS = 0.18;
const LUNGE_DISTANCE = 8;
const FLASH_SECONDS = 0.16;
const NUMBER_SECONDS = 0.9;
const DEATH_SECONDS = 3.2;
const RING_SECONDS = 0.7;
const BANNER_SECONDS = 2.6;
const RAZED_SECONDS = 1.6;
/** Must match ART_SPAN and ART_LIFT of `island-canvas.tsx`: buildings look as in the build phase. */
const ART_SPAN = HEX_SIZE * 1.36;
const ART_LIFT = HEX_SIZE * 0.08;
const STRUCTURE_BAR_WIDTH = 46;
const EDGE_INSET = 34;
const MAX_EFFECTS = 260;
/** The cloud layer the island shadows fall on. Must sit between the sky's far and near layers. */
const SHADOW_PARALLAX = 0.56;
/** The sun stands high and a little to the upper left. */
const SHADOW_OFFSET_X = 180;
const SHADOW_OFFSET_Y = 620;
const SHADOW_ALPHA = 0.45;
const BOB_AMPLITUDE = 4;
const BOB_SPEED = 0.9;
/** A cleared island falls this far while it fades into the haze. */
const FALL_DISTANCE = 160;
const LABEL_SPACING = 900;

/* The palette of the antique map. */
const INK = "#2a1f14";
const SEPIA = "#c9b48a";
const CREAM = "#f1e4c4";
const RUST = "#a8432c";
const PLAYER_COLOR = "#93c25c";
const ENEMY_COLOR = "#b8432e";
const GOLD = "#d8b45c";
const SERIF = "Georgia, \"Times New Roman\", serif";

type TCamera = {
  x: number;
  y: number;
  zoom: number;
};

type TEffect =
  | { readonly kind: "number"; readonly x: number; readonly y: number; readonly born: number; readonly text: string; readonly color: string }
  | { readonly kind: "death"; readonly x: number; readonly y: number; readonly born: number; readonly icon: string; readonly side: string }
  | { readonly kind: "ring"; readonly x: number; readonly y: number; readonly born: number; readonly color: string }
  | { readonly kind: "banner"; readonly island: number; readonly born: number; readonly text: string }
  | { readonly kind: "razed"; readonly x: number; readonly y: number; readonly born: number };

type TScene = {
  /** One sprite per sim island, `null` while it bakes. */
  readonly sprites: (TIslandSprite | null)[];
  effects: TEffect[];
  /** Diagonal ink hatching for the retreat band, made on first use. */
  hatch: CanvasPattern | null;
};

type TFrame = {
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
  readonly alpha: number;
  readonly camera: TCamera;
  /** Wall clock in seconds, for the idle bob. */
  readonly clock: number;
  /** False under prefers-reduced-motion: no bob. */
  readonly motion: boolean;
};

const icons = new Map<string, HTMLImageElement>();

const iconImage = (src: string) => {
  let image = icons.get(src);
  if (!image) {
    image = new Image();
    image.src = src;
    icons.set(src, image);
  }

  return image;
};

const ready = (image: HTMLImageElement) => image.complete && image.naturalWidth > 0;

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** Turns the sim's events into effects. `time` is the sim clock in seconds. */
const absorbEvents = (scene: TScene, sim: TCleanupSim, events: readonly TSimEvent[], time: number) => {
  for (const event of events) {
    if (event.type === "hit") {
      scene.effects.push({
        kind: "number",
        x: event.x + (Math.random() - 0.5) * 14,
        y: event.y - 30,
        born: time,
        text: `${event.amount}`,
        color: event.side === "player" ? "#e0644a" : CREAM,
      });
    } else if (event.type === "death") {
      scene.effects.push({ kind: "death", x: event.x, y: event.y, born: time, icon: event.icon, side: event.side });
    } else if (event.type === "ferry") {
      scene.effects.push({ kind: "ring", x: event.x, y: event.y, born: time, color: CREAM });
    } else if (event.type === "razed") {
      scene.effects.push({ kind: "razed", x: event.x, y: event.y, born: time });
    } else if (event.type === "cleared") {
      const island = sim.islands[event.island];
      const reward = island ? island.rewardHexes.length : 0;
      scene.effects.push({ kind: "banner", island: event.island, born: time, text: `Зачищено  +${reward} гекс.` });
    } else if (event.type === "sunk") {
      const island = sim.islands[event.island];
      if (island) {
        scene.effects.push({
          kind: "ring",
          x: island.body.x + island.body.centerX,
          y: island.body.y + island.body.centerY,
          born: time,
          color: SEPIA,
        });
      }
    }
  }

  if (scene.effects.length > MAX_EFFECTS) {
    scene.effects.splice(0, scene.effects.length - MAX_EFFECTS);
  }
};

const bobOf = (island: number, frame: TFrame) => {
  return frame.motion ? Math.sin(frame.clock * BOB_SPEED + island * 1.9) * BOB_AMPLITUDE : 0;
};

const islandPosition = (island: TSimIsland, frame: TFrame) => ({
  x: lerp(island.px, island.body.x, frame.alpha),
  y: lerp(island.py, island.body.y, frame.alpha) + bobOf(island.index, frame),
});

const hexPath = (context: CanvasRenderingContext2D, x: number, y: number, size: number) => {
  context.beginPath();
  for (let corner = 0; corner < 6; corner += 1) {
    const angle = ((60 * corner - 30) * Math.PI) / 180;
    const cx = x + size * Math.cos(angle);
    const cy = y + size * Math.sin(angle);
    if (corner === 0) {
      context.moveTo(cx, cy);
    } else {
      context.lineTo(cx, cy);
    }
  }

  context.closePath();
};

/** 0 for a standing island, rising to 1 as a cleared one falls away. */
const fallOf = (island: TSimIsland, time: number) => {
  if (island.state !== "sinking") {
    return 0;
  }

  return Math.min(1, (time - island.stateTick * TICK_SECONDS) / SINK_SECONDS);
};

/**
 * The island shadows on the cloud layer below. That layer has its own
 * parallax, so the shadow slides against its island as the camera moves:
 * that slide is what tells the eye how high the islands hang.
 */
const drawShadows = (context: CanvasRenderingContext2D, sim: TCleanupSim, scene: TScene, frame: TFrame, time: number) => {
  const { width, height, ratio, camera } = frame;
  const scale = camera.zoom * SHADOW_PARALLAX;
  context.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * (width / 2 - camera.x * scale), ratio * (height / 2 - camera.y * scale));

  for (const island of sim.islands) {
    const sprite = scene.sprites[island.index];
    if (!sprite || island.state === "sunk") {
      continue;
    }

    const at = islandPosition(island, frame);
    const fall = fallOf(island, time);
    context.globalAlpha = SHADOW_ALPHA * (1 - fall);
    context.drawImage(sprite.shadow, at.x + sprite.x + SHADOW_OFFSET_X, at.y + sprite.y + SHADOW_OFFSET_Y, sprite.width, sprite.height);
  }

  context.globalAlpha = 1;
};

const ensureHatch = (context: CanvasRenderingContext2D, scene: TScene) => {
  if (scene.hatch) {
    return scene.hatch;
  }

  const tile = document.createElement("canvas");
  tile.width = 18;
  tile.height = 18;
  const tileContext = tile.getContext("2d");
  if (tileContext) {
    tileContext.strokeStyle = "rgba(201, 180, 138, 0.32)";
    tileContext.lineWidth = 1.4;
    tileContext.beginPath();
    for (const offset of [-18, 0, 18]) {
      tileContext.moveTo(offset, 18);
      tileContext.lineTo(offset + 18, 0);
    }

    tileContext.stroke();
  }

  scene.hatch = context.createPattern(tile, "repeat");

  return scene.hatch;
};

/** The map border: open sky beyond it, a hatched retreat band and a dashed ink line. */
const drawBorder = (context: CanvasRenderingContext2D, sim: TCleanupSim, scene: TScene, frame: TFrame) => {
  const { halfWidth, halfHeight } = sim.bounds;
  const inner = RETREAT_BAND;
  const far = 20000;

  // Beyond the border the map is not drawn: a dark wash.
  context.beginPath();
  context.rect(-far, -far, far * 2, far * 2);
  context.rect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
  context.fillStyle = "rgba(6, 7, 8, 0.5)";
  context.fill("evenodd");

  // The retreat band, hatched like the unexplored mist of the globe.
  const pulse = sim.inRetreatBand ? 0.5 + 0.5 * Math.sin(frame.clock * 4) : 0;
  context.beginPath();
  context.rect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
  context.rect(-halfWidth + inner, -halfHeight + inner, (halfWidth - inner) * 2, (halfHeight - inner) * 2);
  context.fillStyle = `rgba(201, 180, 138, ${0.05 + pulse * 0.06})`;
  context.fill("evenodd");
  const hatch = ensureHatch(context, scene);
  if (hatch) {
    context.fillStyle = hatch;
    context.fill("evenodd");
  }

  context.strokeStyle = SEPIA;
  context.lineWidth = 4;
  context.setLineDash([26, 14]);
  context.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
  context.lineWidth = 1.5;
  context.setLineDash([8, 10]);
  context.globalAlpha = 0.6;
  context.strokeRect(-halfWidth + inner, -halfHeight + inner, (halfWidth - inner) * 2, (halfHeight - inner) * 2);
  context.globalAlpha = 1;
  context.setLineDash([]);

  // "Отступление" written along the band, as a map labels its margins.
  context.font = `italic 600 30px ${SERIF}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(232, 220, 192, 0.55)";
  const mid = inner / 2;

  for (let x = -halfWidth + LABEL_SPACING / 2; x < halfWidth; x += LABEL_SPACING) {
    context.fillText("Отступление", x, -halfHeight + mid);
    context.fillText("Отступление", x, halfHeight - mid);
  }

  for (let y = -halfHeight + LABEL_SPACING / 2; y < halfHeight; y += LABEL_SPACING) {
    for (const side of [-1, 1]) {
      context.save();
      context.translate(side * (halfWidth - mid), y);
      context.rotate((side * Math.PI) / 2);
      context.fillText("Отступление", 0, 0);
      context.restore();
    }
  }
};

const drawIslands = (context: CanvasRenderingContext2D, sim: TCleanupSim, scene: TScene, frame: TFrame, time: number) => {
  for (const island of sim.islands) {
    const sprite = scene.sprites[island.index];
    if (!sprite || island.state === "sunk") {
      continue;
    }

    const at = islandPosition(island, frame);
    const fall = fallOf(island, time);
    const drop = fall * fall * FALL_DISTANCE;
    const shrink = 1 - fall * 0.18;
    const cx = at.x + island.body.centerX;
    const cy = at.y + island.body.centerY;

    context.save();
    context.translate(cx, cy + drop);
    context.scale(shrink, shrink);
    context.translate(-cx, -cy);
    context.globalAlpha = 1 - fall * fall;
    context.drawImage(sprite.body, at.x + sprite.x, at.y + sprite.y, sprite.width, sprite.height);

    if (fall > 0) {
      // The falling island goes grey into the haze below.
      context.globalAlpha = Math.min(1, fall * 1.3) * (1 - fall * fall);
      context.drawImage(sprite.silhouette, at.x + sprite.x, at.y + sprite.y, sprite.width, sprite.height);
    }

    context.restore();

    if (island.state === "cleared") {
      const age = time - island.stateTick * TICK_SECONDS;
      const pulse = 0.55 + Math.sin(time * 5) * 0.3;
      const fade = Math.min(1, age / 0.4) * Math.max(0.2, 1 - Math.max(0, age - CLEARED_HOLD));
      context.lineWidth = 4;
      context.strokeStyle = GOLD;
      context.globalAlpha = pulse * fade;
      for (const index of island.rewardHexes) {
        const hex = island.hexes[index];
        if (!hex) {
          continue;
        }

        const center = hexToPixel(hex.q, hex.r, HEX_SIZE);
        hexPath(context, at.x + center.x, at.y + center.y, HEX_SIZE - 3);
        context.stroke();
        context.lineWidth = 1.2;
        context.strokeStyle = INK;
        hexPath(context, at.x + center.x, at.y + center.y, HEX_SIZE - 7);
        context.stroke();
        context.lineWidth = 4;
        context.strokeStyle = GOLD;
      }

      context.globalAlpha = 1;
    }
  }
};

const dimmedArt = new Map<string, HTMLCanvasElement>();

/** A building drawn grey and dark: a dead hex, or ruins after a battle. */
const dimmedImage = (image: HTMLImageElement) => {
  const cached = dimmedArt.get(image.src);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (context) {
    context.filter = "grayscale(1) sepia(0.35) brightness(0.42)";
    context.drawImage(image, 0, 0);
  }

  dimmedArt.set(image.src, canvas);

  return canvas;
};

/**
 * The buildings and the stronghold of the player's island, drawn live: they
 * flash when hit, show an hp bar once damaged and turn to ruins when razed.
 */
const drawStructures = (context: CanvasRenderingContext2D, sim: TCleanupSim, frame: TFrame, time: number) => {
  const island = sim.islands[0];
  if (!island) {
    return;
  }

  const at = islandPosition(island, frame);
  const hurtTick = new Map<number, number>();
  for (const unit of sim.units) {
    if (unit.structureHex >= 0) {
      hurtTick.set(unit.structureHex, unit.lastHurtTick);
    }
  }

  island.hexes.forEach((hex, index) => {
    if (hex.maxHp <= 0) {
      return;
    }

    const image = iconImage(hex.stronghold ? STRONGHOLD_HEX_ART : getBuilding(hex.building as TBuildingId).hexArt);
    if (!ready(image)) {
      return;
    }

    const center = hexToPixel(hex.q, hex.r, HEX_SIZE);
    const x = at.x + center.x;
    const y = at.y + center.y;
    const hp = Math.max(0, sim.structureHp[index] as number);
    const ruined = hp <= 0;
    const art = ruined || hex.dead ? dimmedImage(image) : image;

    const sinceHurt = time - (hurtTick.get(index) ?? -1000) * TICK_SECONDS;
    const shake = !ruined && sinceHurt >= 0 && sinceHurt < FLASH_SECONDS ? Math.sin(sinceHurt * 90) * 2 : 0;
    context.drawImage(art, x - ART_SPAN / 2 + shake, y - ART_SPAN / 2 - ART_LIFT, ART_SPAN, ART_SPAN);

    if (!ruined && sinceHurt >= 0 && sinceHurt < FLASH_SECONDS) {
      const flash = 1 - sinceHurt / FLASH_SECONDS;
      const glow = context.createRadialGradient(x, y - ART_LIFT, 4, x, y - ART_LIFT, ART_SPAN * 0.5);
      glow.addColorStop(0, `rgba(190, 70, 40, ${0.55 * flash})`);
      glow.addColorStop(1, "rgba(190, 70, 40, 0)");
      context.fillStyle = glow;
      context.fillRect(x - ART_SPAN / 2, y - ART_SPAN / 2 - ART_LIFT, ART_SPAN, ART_SPAN);
    }

    if (ruined || hp >= hex.maxHp) {
      return;
    }

    const share = hp / hex.maxHp;
    const barX = x - STRUCTURE_BAR_WIDTH / 2;
    const barY = y - ART_SPAN / 2 - ART_LIFT - 2;
    context.fillStyle = INK;
    context.fillRect(barX - 1.5, barY - 1.5, STRUCTURE_BAR_WIDTH + 3, BAR_HEIGHT + 4);
    context.fillStyle = "#d9c9a0";
    context.fillRect(barX, barY, STRUCTURE_BAR_WIDTH, BAR_HEIGHT + 1);
    context.fillStyle = share > 0.35 ? "#b08a3a" : RUST;
    context.fillRect(barX, barY, STRUCTURE_BAR_WIDTH * share, BAR_HEIGHT + 1);
  });
};

/** A rope bridge in ink where two islands touch, with a flicker of crossed blades in the middle. */
const drawBridges = (context: CanvasRenderingContext2D, sim: TCleanupSim, frame: TFrame) => {
  context.lineCap = "round";

  for (let node = 0; node < sim.bridgeLinks.length; node += 1) {
    const links = sim.bridgeLinks[node] as number[];
    if (links.length === 0) {
      continue;
    }

    const island = sim.islands[sim.nodeIsland[node] as number] as TSimIsland;
    const at = islandPosition(island, frame);
    const ax = at.x + (island.body.localX[sim.nodeHex[node] as number] as number);
    const ay = at.y + (island.body.localY[sim.nodeHex[node] as number] as number);

    for (const other of links) {
      if (other < node) {
        continue;
      }

      const otherIsland = sim.islands[sim.nodeIsland[other] as number] as TSimIsland;
      const bt = islandPosition(otherIsland, frame);
      const bx = bt.x + (otherIsland.body.localX[sim.nodeHex[other] as number] as number);
      const by = bt.y + (otherIsland.body.localY[sim.nodeHex[other] as number] as number);
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const ux = (bx - ax) / length;
      const uy = (by - ay) / length;
      const nx = -uy;
      const ny = ux;
      // The span runs from edge to edge, over the gap between the two hexes.
      const sx = ax + ux * 30;
      const sy = ay + uy * 30;
      const ex = bx - ux * 30;
      const ey = by - uy * 30;
      const span = Math.hypot(ex - sx, ey - sy);

      context.strokeStyle = "rgba(122, 92, 58, 0.95)";
      context.lineWidth = 4;
      context.beginPath();
      for (let t = 0; t <= span; t += 6) {
        const px = sx + ux * t;
        const py = sy + uy * t;
        context.moveTo(px - nx * 9, py - ny * 9);
        context.lineTo(px + nx * 9, py + ny * 9);
      }

      context.stroke();
      context.strokeStyle = INK;
      context.lineWidth = 1.6;
      context.beginPath();
      for (const side of [-1, 1]) {
        context.moveTo(sx + nx * 10 * side, sy + ny * 10 * side);
        context.lineTo(ex + nx * 10 * side, ey + ny * 10 * side);
      }

      context.stroke();

      const flicker = 0.5 + Math.sin(frame.clock * 9 + node) * 0.35;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2 - 22;
      context.globalAlpha = flicker;
      context.strokeStyle = CREAM;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(mx - 7, my - 7);
      context.lineTo(mx + 7, my + 7);
      context.moveTo(mx + 7, my - 7);
      context.lineTo(mx - 7, my + 7);
      context.stroke();
      context.globalAlpha = 1;
    }
  }
};

const drawDeaths = (context: CanvasRenderingContext2D, scene: TScene, time: number) => {
  const skull = iconImage(ICONS.dead);

  for (const effect of scene.effects) {
    if (effect.kind !== "death") {
      continue;
    }

    const age = time - effect.born;
    if (age > DEATH_SECONDS || age < 0) {
      continue;
    }

    const fade = 1 - age / DEATH_SECONDS;
    const unit = iconImage(effect.icon);
    context.globalAlpha = fade * 0.3;
    if (ready(unit)) {
      context.drawImage(unit, effect.x - UNIT_SPAN / 2, effect.y - UNIT_SPAN * 0.7, UNIT_SPAN, UNIT_SPAN);
    }

    context.globalAlpha = fade * 0.9;
    if (ready(skull)) {
      const span = 20;
      context.drawImage(skull, effect.x - span / 2, effect.y - span * 0.9, span, span);
    }
  }

  context.globalAlpha = 1;
};

const drawUnit = (context: CanvasRenderingContext2D, sim: TCleanupSim, unit: TSimUnit, frame: TFrame, time: number) => {
  const flying = unit.node < 0;
  let x = lerp(unit.px, unit.x, frame.alpha);
  let y = lerp(unit.py, unit.y, frame.alpha);
  if (!flying) {
    y += bobOf(sim.nodeIsland[unit.node] as number, frame);
  }

  const moving = Math.hypot(unit.x - unit.px, unit.y - unit.py) > 0.25;
  const color = unit.side === "player" ? PLAYER_COLOR : ENEMY_COLOR;
  const span = flying ? FLYER_SPAN : UNIT_SPAN;

  const sinceAttack = time - unit.lastAttackTick * TICK_SECONDS;
  if (sinceAttack >= 0 && sinceAttack < LUNGE_SECONDS) {
    const push = Math.sin((sinceAttack / LUNGE_SECONDS) * Math.PI) * LUNGE_DISTANCE;
    const sign = unit.stats.projectile ? -0.4 : 1;
    x += unit.aimX * push * sign;
    y += unit.aimY * push * sign;
  }

  context.fillStyle = flying ? "rgba(20, 14, 8, 0.25)" : "rgba(20, 14, 8, 0.42)";
  context.beginPath();
  context.ellipse(x, y + (flying ? 6 : 2), span * (flying ? 0.3 : 0.38), span * (flying ? 0.12 : 0.15), 0, 0, Math.PI * 2);
  context.fill();

  const bounce = frame.motion && moving ? Math.abs(Math.sin(time * 11 + unit.id)) * 2.5 : 0;
  const hover = frame.motion ? Math.sin(time * 4 + unit.id) * 3 : 0;
  const lift = flying ? FLYER_LIFT + hover : bounce;
  const top = y - span * 0.82 - lift;

  // The team ring at the feet: ink outside, the side's colour inside.
  context.lineWidth = 3.4;
  context.strokeStyle = INK;
  context.globalAlpha = flying ? 0.45 : 0.85;
  context.beginPath();
  context.ellipse(x, y + (flying ? 6 : 2), span * 0.36, span * 0.14, 0, 0, Math.PI * 2);
  context.stroke();
  context.lineWidth = 1.8;
  context.strokeStyle = color;
  context.stroke();
  context.globalAlpha = 1;

  const sinceHurt = time - unit.lastHurtTick * TICK_SECONDS;
  if (sinceHurt >= 0 && sinceHurt < FLASH_SECONDS) {
    const flash = 1 - sinceHurt / FLASH_SECONDS;
    const glow = context.createRadialGradient(x, top + span / 2, 2, x, top + span / 2, span * 0.7);
    glow.addColorStop(0, `rgba(190, 70, 40, ${0.7 * flash})`);
    glow.addColorStop(1, "rgba(190, 70, 40, 0)");
    context.fillStyle = glow;
    context.fillRect(x - span, top - span * 0.2, span * 2, span * 1.4);
  }

  const image = iconImage(unit.stats.icon);
  if (ready(image)) {
    context.drawImage(image, x - span / 2, top, span, span);
  } else {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, top + span / 2, span * 0.3, 0, Math.PI * 2);
    context.fill();
  }

  // The hp bar: an ink frame on a parchment track.
  const share = Math.max(0, unit.hp / unit.maxHp);
  const barX = x - BAR_WIDTH / 2;
  const barY = top - 6;
  context.fillStyle = INK;
  context.fillRect(barX - 1.5, barY - 1.5, BAR_WIDTH + 3, BAR_HEIGHT + 3);
  context.fillStyle = "#d9c9a0";
  context.fillRect(barX, barY, BAR_WIDTH, BAR_HEIGHT);
  context.fillStyle = share > 0.35 ? (unit.side === "player" ? "#6f9a44" : RUST) : "#c9973a";
  context.fillRect(barX, barY, BAR_WIDTH * share, BAR_HEIGHT);
};

const drawProjectile = (context: CanvasRenderingContext2D, shot: TSimProjectile, frame: TFrame) => {
  const x = lerp(shot.px, shot.x, frame.alpha);
  const y = lerp(shot.py, shot.y, frame.alpha);
  const t = Math.min(1, shot.age / shot.duration);
  const reach = Math.hypot(shot.targetX - shot.fromX, shot.targetY - shot.fromY);
  const height = shot.kind === "bullet" ? 0 : Math.min(46, reach * 0.18);
  // The shot flies from the shooter's hands to the target's chest, on an arc.
  const lift = (at: number) => 18 + Math.sin(at * Math.PI) * height;
  const px = x;
  const py = y - lift(t);
  const back = Math.max(0, t - 0.05);
  const dx = (shot.targetX - shot.fromX) * (t - back);
  const dy = (shot.targetY - shot.fromY) * (t - back) - (lift(t) - lift(back));
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;

  if (shot.kind === "arrow") {
    context.strokeStyle = INK;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(px - ux * 15, py - uy * 15);
    context.lineTo(px, py);
    context.stroke();
    context.strokeStyle = CREAM;
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(px - ux * 15, py - uy * 15);
    context.lineTo(px - ux * 11 - uy * 3, py - uy * 11 + ux * 3);
    context.moveTo(px - ux * 15, py - uy * 15);
    context.lineTo(px - ux * 11 + uy * 3, py - uy * 11 - ux * 3);
    context.stroke();
    context.fillStyle = INK;
    context.beginPath();
    context.moveTo(px + ux * 4, py + uy * 4);
    context.lineTo(px - ux * 2 - uy * 3, py - uy * 2 + ux * 3);
    context.lineTo(px - ux * 2 + uy * 3, py - uy * 2 - ux * 3);
    context.fill();

    return;
  }

  if (shot.kind === "stone") {
    context.fillStyle = "#8a7a62";
    context.strokeStyle = INK;
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(px, py, 3.4, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    return;
  }

  if (shot.kind === "bolt") {
    // The stronghold's ballista bolt: a heavy ink shaft with a cream head.
    context.strokeStyle = INK;
    context.lineWidth = 3.4;
    context.beginPath();
    context.moveTo(px - ux * 22, py - uy * 22);
    context.lineTo(px, py);
    context.stroke();
    context.fillStyle = CREAM;
    context.strokeStyle = INK;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(px + ux * 7, py + uy * 7);
    context.lineTo(px - uy * 4, py + ux * 4);
    context.lineTo(px + uy * 4, py - ux * 4);
    context.closePath();
    context.fill();
    context.stroke();

    return;
  }

  if (shot.kind === "bullet") {
    context.strokeStyle = INK;
    context.lineWidth = 3.2;
    context.beginPath();
    context.moveTo(px - ux * 18, py - uy * 18);
    context.lineTo(px, py);
    context.stroke();
    context.strokeStyle = CREAM;
    context.lineWidth = 1.2;
    context.stroke();

    return;
  }

  context.fillStyle = "rgba(122, 150, 70, 0.9)";
  context.strokeStyle = INK;
  context.lineWidth = 1.4;
  context.beginPath();
  context.arc(px, py, 6, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.strokeStyle = "rgba(122, 150, 70, 0.5)";
  context.beginPath();
  context.moveTo(px - ux * 8, py - uy * 8);
  context.lineTo(px - ux * 18, py - uy * 18);
  context.stroke();
};

const inkText = (context: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, outline: number) => {
  context.lineWidth = outline;
  context.lineJoin = "round";
  context.strokeStyle = INK;
  context.strokeText(text, x, y);
  context.fillStyle = fill;
  context.fillText(text, x, y);
};

const drawEffects = (context: CanvasRenderingContext2D, sim: TCleanupSim, scene: TScene, frame: TFrame, time: number) => {
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (const effect of scene.effects) {
    const age = time - effect.born;
    if (age < 0) {
      continue;
    }

    if (effect.kind === "number" && age < NUMBER_SECONDS) {
      const t = age / NUMBER_SECONDS;
      context.globalAlpha = 1 - t * t;
      context.font = `700 17px ${SERIF}`;
      inkText(context, effect.text, effect.x, effect.y - t * 26, effect.color, 3.5);
    } else if (effect.kind === "ring" && age < RING_SECONDS) {
      const t = age / RING_SECONDS;
      context.globalAlpha = 1 - t;
      context.strokeStyle = effect.color;
      context.lineWidth = 2.5;
      context.setLineDash([6, 5]);
      context.beginPath();
      context.ellipse(effect.x, effect.y, 10 + t * 50, (10 + t * 50) * 0.55, 0, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    } else if (effect.kind === "razed" && age < RAZED_SECONDS) {
      // Ink smoke puffs rising from the fallen building.
      const t = age / RAZED_SECONDS;
      context.globalAlpha = (1 - t) * 0.75;
      context.fillStyle = "rgba(60, 48, 36, 0.9)";
      context.strokeStyle = INK;
      context.lineWidth = 1.5;
      for (let puff = 0; puff < 5; puff += 1) {
        const angle = puff * 1.26;
        const radius = 10 + t * 18 + puff * 2;
        const px = effect.x + Math.cos(angle) * t * 34;
        const py = effect.y - 20 - t * 50 + Math.sin(angle) * t * 14;
        context.beginPath();
        context.arc(px, py, radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }

      context.font = `italic 700 18px ${SERIF}`;
      inkText(context, "Разрушено", effect.x, effect.y - 70 - t * 20, "#e0644a", 4);
    } else if (effect.kind === "banner" && age < BANNER_SECONDS) {
      const island = sim.islands[effect.island];
      if (!island) {
        continue;
      }

      const at = islandPosition(island, frame);
      const t = age / BANNER_SECONDS;
      context.globalAlpha = Math.min(1, age * 4) * (1 - Math.max(0, t - 0.7) / 0.3);
      context.font = `italic 700 30px ${SERIF}`;
      inkText(context, effect.text, at.x + island.body.centerX, at.y + island.body.centerY - 40 - t * 30, GOLD, 6);
    }
  }

  context.globalAlpha = 1;
};

/** The retreat ring around the player's island while it sits in the band. */
const drawRetreat = (context: CanvasRenderingContext2D, sim: TCleanupSim, frame: TFrame) => {
  const player = sim.islands[0];
  if (!player || sim.retreatProgress <= 0) {
    return;
  }

  const at = islandPosition(player, frame);
  const cx = at.x + player.body.centerX;
  const cy = at.y + player.body.centerY;
  const radius = player.body.radius + 30;

  context.lineCap = "round";
  context.strokeStyle = "rgba(42, 31, 20, 0.7)";
  context.lineWidth = 12;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = SEPIA;
  context.lineWidth = 6;
  context.beginPath();
  context.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sim.retreatProgress);
  context.stroke();

  context.font = `italic 700 26px ${SERIF}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  inkText(context, sim.inRetreatBand ? "Отступление…" : "Отступление прервано", cx, cy - radius - 24, CREAM, 5);
};

/** An ink arrow on the screen edge with an icon beside it. */
const drawEdgeArrow = (
  context: CanvasRenderingContext2D,
  angle: number,
  width: number,
  height: number,
  fill: string,
  icon: HTMLImageElement | null,
  label: string | null,
) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const scale = Math.min((width / 2 - EDGE_INSET) / Math.abs(cos || 1e-6), (height / 2 - EDGE_INSET) / Math.abs(sin || 1e-6));
  const px = width / 2 + cos * scale;
  const py = height / 2 + sin * scale;

  context.save();
  context.translate(px, py);
  context.rotate(angle);
  context.fillStyle = fill;
  context.strokeStyle = INK;
  context.lineWidth = 2.2;
  context.beginPath();
  context.moveTo(15, 0);
  context.lineTo(-9, -11);
  context.lineTo(-4, 0);
  context.lineTo(-9, 11);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();

  if (icon && ready(icon)) {
    context.drawImage(icon, px - cos * 32 - 11, py - sin * 32 - 11, 22, 22);
  }

  if (label) {
    context.font = `italic 700 13px ${SERIF}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    inkText(context, label, px - cos * 58, py - sin * 30, CREAM, 3);
  }
};

/** Arrows toward enemy islands out of sight, and toward the nearest map border. */
const drawPointers = (context: CanvasRenderingContext2D, sim: TCleanupSim, frame: TFrame) => {
  const { width, height, camera } = frame;
  const marker = iconImage(ICONS.army);
  const toScreen = (x: number, y: number) => ({
    x: (x - camera.x) * camera.zoom + width / 2,
    y: (y - camera.y) * camera.zoom + height / 2,
  });

  for (const island of sim.islands) {
    if (island.side !== "enemy" || island.state !== "active") {
      continue;
    }

    const at = toScreen(island.body.x + island.body.centerX, island.body.y + island.body.centerY);
    const margin = island.body.radius * camera.zoom * 0.5;
    if (at.x > -margin && at.x < width + margin && at.y > -margin && at.y < height + margin) {
      continue;
    }

    drawEdgeArrow(context, Math.atan2(at.y - height / 2, at.x - width / 2), width, height, RUST, marker, null);
  }

  // The nearest border, while it is out of sight.
  const { halfWidth, halfHeight } = sim.bounds;
  const sides = [
    { gap: camera.x + halfWidth, x: -halfWidth, y: camera.y },
    { gap: halfWidth - camera.x, x: halfWidth, y: camera.y },
    { gap: camera.y + halfHeight, x: camera.x, y: -halfHeight },
    { gap: halfHeight - camera.y, x: camera.x, y: halfHeight },
  ].sort((a, b) => a.gap - b.gap);
  const nearest = sides[0];
  if (!nearest) {
    return;
  }

  const edge = toScreen(nearest.x, nearest.y);
  if (edge.x >= 0 && edge.x <= width && edge.y >= 0 && edge.y <= height) {
    return;
  }

  drawEdgeArrow(context, Math.atan2(edge.y - height / 2, edge.x - width / 2), width, height, SEPIA, null, "Отступление");
};

const drawScene = (context: CanvasRenderingContext2D, sim: TCleanupSim, scene: TScene, frame: TFrame) => {
  const { width, height, ratio, alpha, camera } = frame;
  const time = (sim.tick - 1 + alpha) * TICK_SECONDS;
  const zoom = camera.zoom;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  drawShadows(context, sim, scene, frame, time);

  context.setTransform(ratio * zoom, 0, 0, ratio * zoom, ratio * (width / 2 - camera.x * zoom), ratio * (height / 2 - camera.y * zoom));
  drawBorder(context, sim, scene, frame);
  drawIslands(context, sim, scene, frame, time);
  drawBridges(context, sim, frame);
  drawDeaths(context, scene, time);
  drawStructures(context, sim, frame, time);

  const ground = sim.units.filter((unit) => unit.node >= 0 && unit.structureHex < 0).sort((a, b) => a.y - b.y);
  for (const unit of ground) {
    drawUnit(context, sim, unit, frame, time);
  }

  for (const shot of sim.projectiles) {
    drawProjectile(context, shot, frame);
  }

  const flyers = sim.units.filter((unit) => unit.node < 0).sort((a, b) => a.y - b.y);
  for (const unit of flyers) {
    drawUnit(context, sim, unit, frame, time);
  }

  drawEffects(context, sim, scene, frame, time);
  drawRetreat(context, sim, frame);

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawPointers(context, sim, frame);
};

/** Effects older than their longest life are dropped. */
const pruneEffects = (scene: TScene, time: number) => {
  scene.effects = scene.effects.filter((effect) => time - effect.born < DEATH_SECONDS && time - effect.born > -1);
};

export type { TCamera, TEffect, TFrame, TScene };
export { absorbEvents, drawScene, iconImage, pruneEffects };
