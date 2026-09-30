// Lightning: a sprite atlas of pre-drawn bolts plus a director that runs the show on a timer.
//   1. A sweep: a bolt strikes every board column, left to right. Every struck tile flips
//      and holds a charge.
//   2. Lucky numbers: a few tiles take a second, golden bolt and show a multiplier.
//   3. The board discharges column by column; the lucky tiles hold their charge longer.
//
// Sprite channels are layers, not colours: R is the white-hot core, G the tight glow,
// B the wide halo. The shader tints each layer.

import { COLUMNS, MULTIPLIERS, MULTIPLIER_GLYPH, columnBottomY, columnCenterX } from "./board";
import type { Tile } from "./board";

const SPRITE_W = 256;
const SPRITE_H = 1024;
const ATLAS_COLS = 8;
const ATLAS_ROWS = 2;
const SPRITE_COUNT = ATLAS_COLS * ATLAS_ROWS;

type Point = [number, number];

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Midpoint displacement between two points, returns the polyline.
function displace(a: Point, b: Point, roughness: number, depth: number): Point[] {
  if (depth === 0) {
    return [a, b];
  }
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const offset = (Math.random() - 0.5) * length * roughness;
  const m: Point = [mx + (-dy / length) * offset, my + (dx / length) * offset];
  const left = displace(a, m, roughness, depth - 1);
  const right = displace(m, b, roughness, depth - 1);
  return left.concat(right.slice(1));
}

type Stroke = {
  points: Point[];
  weight: number;
};

function buildBolt(): Stroke[] {
  const start: Point = [SPRITE_W / 2 + random(-30, 30), 0];
  const end: Point = [SPRITE_W / 2 + random(-26, 26), SPRITE_H];
  const main = displace(start, end, 0.34, 8);
  const strokes: Stroke[] = [{ points: main, weight: 1 }];
  const branches = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < branches; i++) {
    const index = Math.floor(random(0.08, 0.78) * main.length);
    const origin = main[index];
    if (!origin) {
      continue;
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    const angle = random(0.25, 0.75) * side;
    const length = random(90, 300);
    const tip: Point = [
      Math.max(8, Math.min(SPRITE_W - 8, origin[0] + Math.sin(angle) * length)),
      origin[1] + Math.cos(angle) * length,
    ];
    const branch = displace(origin, tip, 0.45, 5);
    strokes.push({ points: branch, weight: random(0.3, 0.6) });
    if (Math.random() < 0.5) {
      const sub = branch[Math.floor(branch.length * 0.5)];
      if (sub) {
        const subTip: Point = [sub[0] - side * random(20, 60), sub[1] + random(40, 110)];
        strokes.push({ points: displace(sub, subTip, 0.5, 4), weight: 0.22 });
      }
    }
  }
  return strokes;
}

function tracePath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
}

function drawAtlas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_W * ATLAS_COLS;
  canvas.height = SPRITE_H * ATLAS_ROWS;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d context unavailable");
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < SPRITE_COUNT; i++) {
    const ox = (i % ATLAS_COLS) * SPRITE_W;
    const oy = Math.floor(i / ATLAS_COLS) * SPRITE_H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, SPRITE_W, SPRITE_H);
    ctx.clip();
    ctx.translate(ox, oy);
    for (const stroke of buildBolt()) {
      tracePath(ctx, stroke.points);
      const w = stroke.weight;
      // Wide halo.
      ctx.shadowColor = `rgba(0, 0, 255, ${0.9 * w})`;
      ctx.shadowBlur = 38;
      ctx.strokeStyle = `rgba(0, 0, 255, ${0.22 * w})`;
      ctx.lineWidth = 26 * w + 6;
      ctx.stroke();
      // Tight glow.
      ctx.shadowColor = `rgba(0, 255, 0, ${w})`;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = `rgba(0, 255, 0, ${0.55 * w})`;
      ctx.lineWidth = 7 * w + 2;
      ctx.stroke();
      // Core.
      ctx.shadowBlur = 2;
      ctx.shadowColor = "rgba(255, 0, 0, 1)";
      ctx.strokeStyle = `rgba(255, 0, 0, ${Math.min(1, 0.4 + w)})`;
      ctx.lineWidth = 2.6 * w + 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }
  return canvas;
}


type ActiveBolt = {
  // Screen UV rect: x, y, width, height.
  rect: [number, number, number, number];
  sprite: number;
  flip: boolean;
  intensity: number;
  // 1 for the golden bolt that marks a lucky number.
  gold: number;
};

type TileState = {
  flip: number;
  charge: number;
  flash: number;
  // Seconds since the bolt hit the tile, -1 before the hit.
  age: number;
  // Seconds since the tile started to discharge, -1 before that.
  discharge: number;
  // 0..1: how far the multiplier badge has come in; 0 on an ordinary tile.
  lucky: number;
  // Glyph slot of the multiplier label, -1 on an ordinary tile.
  badge: number;
};

type Strike = {
  start: number;
  sprite: number;
  flip: boolean;
  pulses: number[];
  // Screen UV: bolt centre x and the y where it ends.
  x: number;
  bottom: number;
  width: number;
  gold: number;
};

type Lucky = {
  tile: Tile;
  hit: number;
  badge: number;
};

const COLUMN_STAGGER = 0.1;
const STRIKE_LENGTH = 0.36;
// The bolt runs down the column, so lower rows are hit a little later.
const ROW_DELAY = 0.045;
const FLIP_TIME = 0.7;
const CHARGE_RISE = 0.35;
// How long the board stays charged after the sweep has passed its last column.
const CHARGE_HOLD = 2.6;
const DISCHARGE_STAGGER = 0.07;
const DISCHARGE_TIME = 0.9;
// Lucky strikes start after the sweep and follow each other at this pace.
const LUCKY_DELAY = 0.9;
const LUCKY_STAGGER = 0.42;
const LUCKY_HOLD = 5.2;
const BADGE_TIME = 0.55;

// Return strokes: several bright pulses that decay fast, like a real flash.
function envelope(t: number, pulses: number[]): number {
  if (t < -0.04 || t > STRIKE_LENGTH) {
    return 0;
  }
  let value = t < 0 ? (t + 0.04) * 4 : 0;
  pulses.forEach((p, i) => {
    if (t >= p) {
      value += Math.exp(-(t - p) * (i === 0 ? 22 : 30)) * (i === 0 ? 1 : 0.75);
    }
  });
  return Math.min(1.4, value);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function easeOutBack(t: number): number {
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function pulses(): number[] {
  return [0, random(0.045, 0.075), random(0.11, 0.15)].slice(0, 2 + Math.floor(Math.random() * 2));
}

// Picks count distinct tiles at random.
function pickTiles(tiles: Tile[], count: number): Tile[] {
  const pool = [...tiles];
  const out: Tile[] = [];
  while (out.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    const [tile] = pool.splice(index, 1);
    if (tile) {
      out.push(tile);
    }
  }
  return out;
}

// Rarer multipliers are bigger.
function pickMultiplier(): number {
  const roll = Math.random();
  const index = roll < 0.45 ? 0 : roll < 0.72 ? 1 : roll < 0.88 ? 2 : roll < 0.96 ? 3 : 4;
  return MULTIPLIER_GLYPH + Math.min(index, MULTIPLIERS.length - 1);
}

class LightningDirector {
  private strikes: Strike[] = [];
  private lucky: Lucky[] = [];
  private sequenceStart = -100;
  private nextSequence: number;
  private sheet = { x: 0.5, y: 0.1, start: -10, strength: 0 };
  private nextSheet: number;
  private readonly tiles: Tile[];

  constructor(now: number, tiles: Tile[]) {
    this.tiles = tiles;
    this.nextSequence = now + 1.6;
    this.nextSheet = now + 0.8;
  }

  trigger(now: number): void {
    this.sequenceStart = now;
    this.strikes = [];
    const bottom = columnBottomY() + 0.015;
    for (let column = 0; column < COLUMNS; column++) {
      this.strikes.push({
        start: now + column * COLUMN_STAGGER,
        sprite: Math.floor(Math.random() * SPRITE_COUNT),
        flip: Math.random() < 0.5,
        pulses: pulses(),
        x: columnCenterX(column),
        bottom,
        width: 0.19,
        gold: 0,
      });
    }
    const luckyStart = now + (COLUMNS - 1) * COLUMN_STAGGER + LUCKY_DELAY;
    const count = 1 + Math.floor(Math.random() * 4);
    this.lucky = pickTiles(this.tiles, count).map((tile, i) => {
      const hit = luckyStart + i * LUCKY_STAGGER;
      const [x, y, w, h] = tile.rect;
      this.strikes.push({
        start: hit - 0.05,
        sprite: Math.floor(Math.random() * SPRITE_COUNT),
        flip: Math.random() < 0.5,
        pulses: [0, random(0.05, 0.07), random(0.12, 0.16)],
        x: x + w / 2,
        bottom: y + h * 0.55,
        width: 0.22,
        gold: 1,
      });
      return { tile, hit, badge: pickMultiplier() };
    });
    const lastLucky = luckyStart + (count - 1) * LUCKY_STAGGER;
    this.nextSequence = lastLucky + LUCKY_HOLD + DISCHARGE_TIME + random(2.5, 4);
  }

  update(now: number): void {
    if (now >= this.nextSequence) {
      this.trigger(now);
    }
    if (now >= this.nextSheet) {
      this.sheet = { x: random(0.08, 0.92), y: random(0.02, 0.3), start: now, strength: random(0.25, 0.6) };
      this.nextSheet = now + random(1.4, 4);
    }
  }

  tileState(tile: Tile, now: number): TileState {
    const hit = this.sequenceStart + tile.column * COLUMN_STAGGER + (tile.isZero ? ROW_DELAY : tile.row * ROW_DELAY);
    const lucky = this.lucky.find((entry) => entry.tile === tile);
    let dischargeAt =
      this.sequenceStart + (COLUMNS - 1) * COLUMN_STAGGER + CHARGE_HOLD + tile.column * DISCHARGE_STAGGER + tile.row * 0.03;
    if (lucky) {
      dischargeAt = lucky.hit + LUCKY_HOLD;
    }
    // The lucky strike is a second impact: flip and flash again from it.
    const lastHit = lucky && now >= lucky.hit ? lucky.hit : hit;
    const age = now - lastHit;
    if (now < hit) {
      return { flip: 0, charge: 0, flash: 0, age: -1, discharge: -1, lucky: 0, badge: -1 };
    }
    const flip = age < FLIP_TIME ? Math.PI * 2 * easeOutBack(age / FLIP_TIME) : 0;
    let charge = smoothstep(0, CHARGE_RISE, now - hit);
    const d = now - dischargeAt;
    let fade = 1;
    if (d >= 0) {
      // Discharge sputters: the charge drops out a few times before it fades for good.
      const sputter = d < 0.5 && hash(Math.floor(d * 24) + tile.seed * 97) > 0.55 ? 0.3 : 1;
      fade = 1 - smoothstep(0, DISCHARGE_TIME, d);
      charge *= fade * sputter;
    }
    const badgeIn = lucky ? smoothstep(0, BADGE_TIME, now - lucky.hit - 0.08) : 0;
    return {
      flip,
      charge,
      flash: Math.exp(-age * 7) * (lucky && now >= lucky.hit ? 1.4 : 1),
      age: Math.min(age, 60),
      discharge: d >= 0 ? Math.min(d, 60) : -1,
      lucky: badgeIn * fade,
      badge: lucky ? lucky.badge : -1,
    };
  }

  bolts(now: number): ActiveBolt[] {
    const out: ActiveBolt[] = [];
    for (const strike of this.strikes) {
      const intensity = envelope(now - strike.start, strike.pulses);
      if (intensity <= 0.001) {
        continue;
      }
      out.push({
        rect: [strike.x - strike.width / 2, -0.04, strike.width, strike.bottom + 0.04],
        sprite: strike.sprite,
        flip: strike.flip,
        intensity: intensity * (strike.gold > 0 ? 1.25 : 1),
        gold: strike.gold,
      });
    }
    return out;
  }

  // Seconds since the current sequence started, while its opening power surge runs; -1 otherwise.
  surge(now: number): number {
    const t = now - this.sequenceStart;
    return t >= 0 && t < 1.2 ? t : -1;
  }

  // Faint distant flicker inside the clouds between strikes: x, y, intensity.
  sheetFlash(now: number): [number, number, number] {
    const t = now - this.sheet.start;
    if (t < 0 || t > 0.6) {
      return [this.sheet.x, this.sheet.y, 0];
    }
    const flicker = Math.exp(-t * 9) + 0.6 * Math.exp(-Math.max(0, t - 0.12) * 14) * (t > 0.12 ? 1 : 0);
    return [this.sheet.x, this.sheet.y, flicker * this.sheet.strength];
  }
}

export { LightningDirector, drawAtlas, ATLAS_COLS, ATLAS_ROWS };
export type { ActiveBolt, TileState };
