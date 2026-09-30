// Lightning: a sprite atlas of pre-drawn bolts plus a director that fires
// a strike down every board column, left to right, on a timer.
// Every struck tile flips, holds a charge for a while, then discharges back to rest.
//
// Sprite channels are layers, not colours: R is the white-hot core, G the tight glow,
// B the wide halo. The shader tints each layer.

import { COLUMNS, columnBottomY, columnCenterX } from "./board";
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
};

type TileState = {
  flip: number;
  charge: number;
  flash: number;
  // Seconds since the bolt hit the tile, -1 before the hit.
  age: number;
  // Seconds since the tile started to discharge, -1 before that.
  discharge: number;
};

type Strike = {
  column: number;
  start: number;
  sprite: number;
  flip: boolean;
  pulses: number[];
};

const COLUMN_STAGGER = 0.1;
const STRIKE_LENGTH = 0.36;
// The bolt runs down the column, so lower rows are hit a little later.
const ROW_DELAY = 0.045;
const FLIP_TIME = 0.7;
const CHARGE_RISE = 0.35;
// How long the whole board stays charged after the last column is hit.
const CHARGE_HOLD = 5;
const DISCHARGE_STAGGER = 0.07;
const DISCHARGE_TIME = 0.9;
// Columns catch the arcs as the strike sweeps past them: the left pair as it starts,
// the right pair as it reaches the last board column.
const PILLAR_DELAYS = [0.0, 0.08, (COLUMNS - 1) * COLUMN_STAGGER - 0.04, (COLUMNS - 1) * COLUMN_STAGGER + 0.06];
const PILLAR_BURST = 0.95;

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

class LightningDirector {
  private strikes: Strike[] = [];
  private sequenceStart = -100;
  private nextSequence: number;
  private sheet = { x: 0.5, y: 0.1, start: -10, strength: 0 };
  private nextSheet: number;
  private readonly pillarOut = new Float32Array(PILLAR_DELAYS.length);

  constructor(now: number) {
    this.nextSequence = now + 2.2;
    this.nextSheet = now + 1;
  }

  trigger(now: number): void {
    this.sequenceStart = now;
    this.strikes = [];
    for (let column = 0; column < COLUMNS; column++) {
      this.strikes.push({
        column,
        start: now + column * COLUMN_STAGGER,
        sprite: Math.floor(Math.random() * SPRITE_COUNT),
        flip: Math.random() < 0.5,
        pulses: [0, random(0.045, 0.075), random(0.11, 0.15)].slice(0, 2 + Math.floor(Math.random() * 2)),
      });
    }
    const dischargeEnd = (COLUMNS - 1) * (COLUMN_STAGGER + DISCHARGE_STAGGER) + CHARGE_HOLD + DISCHARGE_TIME;
    this.nextSequence = now + dischargeEnd + random(2.5, 4.5);
  }

  update(now: number): void {
    if (now >= this.nextSequence) {
      this.trigger(now);
    }
    if (now >= this.nextSheet) {
      this.sheet = { x: random(0.1, 0.9), y: random(0.02, 0.25), start: now, strength: random(0.25, 0.6) };
      this.nextSheet = now + random(1.6, 4.5);
    }
  }

  tileState(tile: Tile, now: number): TileState {
    const hit = this.sequenceStart + tile.column * COLUMN_STAGGER + (tile.isZero ? ROW_DELAY : tile.row * ROW_DELAY);
    const dischargeAt = this.sequenceStart + (COLUMNS - 1) * COLUMN_STAGGER + CHARGE_HOLD + tile.column * DISCHARGE_STAGGER + tile.row * 0.03;
    const age = now - hit;
    if (age < 0) {
      return { flip: 0, charge: 0, flash: 0, age: -1, discharge: -1 };
    }
    const flip = age < FLIP_TIME ? Math.PI * 2 * easeOutBack(age / FLIP_TIME) : 0;
    let charge = smoothstep(0, CHARGE_RISE, age);
    const d = now - dischargeAt;
    if (d >= 0) {
      // Discharge sputters: the charge drops out a few times before it fades for good.
      const sputter = d < 0.5 && hash(Math.floor(d * 24) + tile.seed * 97) > 0.55 ? 0.3 : 1;
      charge *= (1 - smoothstep(0, DISCHARGE_TIME, d)) * sputter;
    }
    return {
      flip,
      charge,
      flash: Math.exp(-age * 7),
      age: Math.min(age, 60),
      discharge: d >= 0 ? Math.min(d, 60) : -1,
    };
  }

  bolts(now: number): ActiveBolt[] {
    const out: ActiveBolt[] = [];
    for (const strike of this.strikes) {
      const intensity = envelope(now - strike.start, strike.pulses);
      if (intensity <= 0.001) {
        continue;
      }
      const cx = columnCenterX(strike.column);
      const bottom = columnBottomY() + 0.015;
      const width = 0.19;
      out.push({
        rect: [cx - width / 2, -0.04, width, bottom + 0.04],
        sprite: strike.sprite,
        flip: strike.flip,
        intensity,
      });
    }
    return out;
  }

  // Per column of the room: arc intensity. A burst crackles over the column as the sweep passes it;
  // while the board holds its charge, short arcs keep jumping now and then.
  pillars(now: number): Float32Array {
    const hold = (COLUMNS - 1) * COLUMN_STAGGER + CHARGE_HOLD;
    PILLAR_DELAYS.forEach((delay, i) => {
      const t = now - this.sequenceStart - delay;
      let value = 0;
      if (t >= 0 && t < PILLAR_BURST) {
        const crackle = 0.55 + 0.45 * hash(Math.floor(t * 40) + i * 17.3);
        value = envelope(t, [0, 0.09, 0.22]) * 0.8 + 0.5 * Math.exp(-t * 3) * crackle;
        value *= 1 - smoothstep(PILLAR_BURST - 0.25, PILLAR_BURST, t);
      } else if (t >= PILLAR_BURST && t < hold - delay) {
        const tick = Math.floor(now * 14);
        value = hash(tick + i * 31.7) > 0.94 ? 0.4 * (0.5 + 0.5 * hash(tick * 1.7 + i)) : 0;
      }
      this.pillarOut[i] = value;
    });
    return this.pillarOut;
  }

  // How charged the air is: rises with the sweep, holds while the board is charged, bleeds off
  // with the discharge.
  energy(now: number): number {
    const t = now - this.sequenceStart;
    const dischargeAt = (COLUMNS - 1) * COLUMN_STAGGER + CHARGE_HOLD;
    const end = dischargeAt + (COLUMNS - 1) * DISCHARGE_STAGGER + DISCHARGE_TIME;
    if (t < 0 || t > end) {
      return 0;
    }
    return smoothstep(0, 0.8, t) * (1 - smoothstep(dischargeAt, end, t));
  }

  // Seconds since the current strike sequence started.
  sinceStrike(now: number): number {
    return Math.min(now - this.sequenceStart, 1000);
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
