// Building blocks for a brand's TV: the roulette tiles and the bolt sprites as GPU instances,
// and a summary of the bolts' light. A brand brings its own shaders and its own look.

import { SCREEN_ASPECT, buildTiles } from "./board";
import type { Tile } from "./board";
import { uniform } from "./gl";
import type { Program } from "./gl";
import type { ActiveBolt, LightningDirector } from "./lightning";

const MAX_BOLTS = 24;
// Per tile instance: rect (4), info (4), state (4), extra (4).
const TILE_FLOATS = 16;
// Per bolt instance: rect (4), sprite, flip, intensity, gold.
const SPRITE_FLOATS = 8;
const COLOR_INDEX = { black: 0, red: 1, green: 2 } as const;

function instanceAttribute(gl: WebGL2RenderingContext, location: number, size: number, stride: number, offset: number): void {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
  gl.vertexAttribDivisor(location, 1);
}

// Every roulette tile as one instance of a quad. The tile shader reads the attributes at
// locations 0..3: rect, info (glyph, colour, zero, seed), state (flip, charge, flash, age),
// extra (discharge, row, lucky, badge).
class TileBatch {
  readonly tiles: Tile[] = buildTiles();
  private readonly gl: WebGL2RenderingContext;
  private readonly data = new Float32Array(this.tiles.length * TILE_FLOATS);
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = TILE_FLOATS * 4;
    for (let i = 0; i < 4; i++) {
      instanceAttribute(gl, i, 4, stride, i * 16);
    }
    gl.bindVertexArray(null);
  }

  // Draws with the program already bound and its uniforms set.
  draw(director: LightningDirector, now: number): void {
    const gl = this.gl;
    this.tiles.forEach((tile, i) => {
      const state = director.tileState(tile, now);
      this.data.set(
        [
          ...tile.rect,
          tile.glyph,
          COLOR_INDEX[tile.color],
          tile.isZero ? 1 : 0,
          tile.seed,
          state.flip,
          state.charge,
          state.flash,
          state.age,
          state.discharge,
          tile.row,
          state.lucky,
          state.badge,
        ],
        i * TILE_FLOATS,
      );
    });
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.tiles.length);
    gl.bindVertexArray(null);
  }
}

// Every live bolt as one sprite instance. The sprite shader reads rect at location 0 and
// (sprite, flip, intensity, gold) at location 1.
class BoltBatch {
  private readonly gl: WebGL2RenderingContext;
  private readonly data = new Float32Array(MAX_BOLTS * SPRITE_FLOATS);
  private readonly packed = new Float32Array(MAX_BOLTS * 4);
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = SPRITE_FLOATS * 4;
    instanceAttribute(gl, 0, 4, stride, 0);
    instanceAttribute(gl, 1, 4, stride, 16);
    gl.bindVertexArray(null);
  }

  // Bolts for the sky shader: uBolts[i] = (centre x, intensity, bottom y, gold), plus uBoltCount.
  setUniforms(p: Program, bolts: ActiveBolt[]): void {
    const gl = this.gl;
    const count = Math.min(bolts.length, MAX_BOLTS);
    this.packed.fill(0);
    for (let i = 0; i < count; i++) {
      const bolt = bolts[i];
      if (!bolt) {
        continue;
      }
      this.packed.set([bolt.rect[0] + bolt.rect[2] / 2, bolt.intensity, bolt.rect[1] + bolt.rect[3], bolt.gold], i * 4);
    }
    gl.uniform4fv(uniform(p, "uBolts"), this.packed);
    gl.uniform1i(uniform(p, "uBoltCount"), count);
  }

  // Draws with the program already bound, its uniforms and blending set.
  draw(bolts: ActiveBolt[]): void {
    const gl = this.gl;
    const count = Math.min(bolts.length, MAX_BOLTS);
    if (count === 0) {
      return;
    }
    for (let i = 0; i < count; i++) {
      const bolt = bolts[i];
      if (!bolt) {
        continue;
      }
      this.data.set([...bolt.rect, bolt.sprite, bolt.flip ? 1 : 0, bolt.intensity, bolt.gold], i * SPRITE_FLOATS);
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, count * SPRITE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }
}

// How much the bolts light the room right now, before a brand gives the light its colour.
type BoltLight = {
  // Sum of the bolts' intensities.
  total: number;
  // Where across the screen the light is centred, in screen UV.
  x: number;
  // Share of the light that comes from lucky (gold) bolts, 0..1.
  lucky: number;
};

function boltLight(bolts: ActiveBolt[]): BoltLight {
  let total = 0;
  let weighted = 0;
  let lucky = 0;
  for (const bolt of bolts) {
    total += bolt.intensity;
    weighted += bolt.intensity * (bolt.rect[0] + bolt.rect[2] / 2);
    lucky += bolt.intensity * bolt.gold;
  }
  return {
    total,
    x: total > 0 ? weighted / total : 0.5,
    lucky: total > 0 ? lucky / total : 0,
  };
}

// The light a TV throws into the room at one moment.
type TvLight = {
  // Flash colour, already scaled by its strength.
  flash: [number, number, number];
  // Where across the screen the flash is centred, in screen UV.
  flashX: number;
  // Seconds since the lightning sequence started, -1 outside the power surge that opens it.
  surge: number;
  // Mains power: 1 at rest, lower while the bolts draw it down.
  power: number;
};

// Size of a TV picture that covers onScreenWidth canvas pixels, so it is as sharp as the plate around it.
function tvTargetSize(onScreenWidth: number): [number, number] {
  const width = Math.round(Math.min(2560, Math.max(720, onScreenWidth * 1.15)));
  return [width, Math.round(width / SCREEN_ASPECT)];
}

export type { BoltLight, TvLight };

export { BoltBatch, MAX_BOLTS, TileBatch, boltLight, tvTargetSize };
