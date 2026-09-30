import cloudsUrl from "../assets/clouds.png";
import studioUrl from "../assets/studio.png";
import { GLYPH_COLS, GLYPH_ROWS, SCREEN_ASPECT, buildTiles, drawGlyphAtlas } from "./board";
import type { Tile } from "./board";
import {
  FLOOR_VANISH,
  FLOOR_Y,
  HALO_RECT,
  HORIZON_Y,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  DOWNLIGHTS,
  MIRROR_Y,
  PILLARS,
  SCREEN_CORNERS,
  SCREEN_PIXEL_WIDTH,
} from "./calibration";
import { createDataTexture, createProgram, createRenderTarget, createTexture, loadImage, uniform } from "./gl";
import type { Program, RenderTarget } from "./gl";
import { invert, squareToQuad, toColumnMajor } from "./homography";
import { ATLAS_COLS, ATLAS_ROWS, LightningDirector, drawAtlas } from "./lightning";
import { buildPlateMasks } from "./plate-masks";
import {
  BRIGHT_FRAG,
  COMPOSITE_FRAG,
  FINAL_FRAG,
  CONTENT_FRAG,
  FULLSCREEN_VERT,
  SPRITE_FRAG,
  SPRITE_VERT,
  TILE_FRAG,
  TILE_VERT,
} from "./shaders";

const MAX_BOLTS = 16;
const IMAGE_ASPECT = IMAGE_WIDTH / IMAGE_HEIGHT;
// Per tile instance: rect (4), info (4), state (4), discharge (1).
const TILE_FLOATS = 13;
const COLOR_INDEX = { cream: 0, red: 1, green: 2 } as const;

type Options = {
  isDebug: () => boolean;
};

function toCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2d context unavailable");
  }
  ctx.drawImage(image, 0, 0);
  return canvas;
}

class StudioRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly options: Options;
  private content!: Program;
  private sprite!: Program;
  private tile!: Program;
  private composite!: Program;
  private bright!: Program;
  private final!: Program;
  // The composited frame in linear HDR, and its bright part at half size for the bloom.
  private scene: RenderTarget | null = null;
  private glow: RenderTarget | null = null;
  private studio!: WebGLTexture;
  private clouds!: WebGLTexture;
  private glyphs!: WebGLTexture;
  private masks!: WebGLTexture;
  private atlas!: WebGLTexture;
  private target: RenderTarget | null = null;
  private spriteVao!: WebGLVertexArrayObject;
  private spriteBuffer!: WebGLBuffer;
  private tileVao!: WebGLVertexArrayObject;
  private tileBuffer!: WebGLBuffer;
  private readonly tiles: Tile[] = buildTiles();
  private readonly tileData = new Float32Array(this.tiles.length * TILE_FLOATS);
  private readonly spriteData = new Float32Array(MAX_BOLTS * 7);
  private readonly boltUniform = new Float32Array(MAX_BOLTS * 4);
  private director: LightningDirector;
  // Smoothed dip of the house lights, follows the lightning with a short lag.
  private sag = 0;
  private readonly downlights = new Float32Array(DOWNLIGHTS.flat());
  private readonly pillars = new Float32Array(PILLARS.flatMap((pillar) => pillar.shaft));
  private readonly pillarFloors = new Float32Array(PILLARS.map((pillar) => pillar.floorY));
  private lastTick = 0;
  private frame = 0;
  private readonly start = performance.now();
  private readonly toScreen = toColumnMajor(invert(squareToQuad(...SCREEN_CORNERS)));
  private disposed = false;
  // Dev hook: when set, the clock is frozen at this time in seconds.
  private frozenAt: number | null = null;

  constructor(canvas: HTMLCanvasElement, options: Options) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) {
      throw new Error("WebGL2 is not available");
    }
    this.gl = gl;
    this.canvas = canvas;
    this.options = options;
    this.director = new LightningDirector(0);
  }

  async init(): Promise<void> {
    const gl = this.gl;
    await Promise.all([document.fonts.load("600 80px Inter"), document.fonts.ready]);
    const [studioImage, cloudsImage] = await Promise.all([loadImage(studioUrl), loadImage(cloudsUrl)]);
    if (this.disposed) {
      return;
    }
    this.content = createProgram(gl, FULLSCREEN_VERT, CONTENT_FRAG);
    this.sprite = createProgram(gl, SPRITE_VERT, SPRITE_FRAG);
    this.tile = createProgram(gl, TILE_VERT, TILE_FRAG);
    this.composite = createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
    this.bright = createProgram(gl, FULLSCREEN_VERT, BRIGHT_FRAG);
    this.final = createProgram(gl, FULLSCREEN_VERT, FINAL_FRAG);
    const plate = toCanvas(studioImage);
    this.studio = createTexture(gl, plate);
    const masks = buildPlateMasks(plate);
    this.masks = createDataTexture(gl, masks.data, masks.width, masks.height);
    this.clouds = createTexture(gl, cloudsImage, { wrap: gl.MIRRORED_REPEAT });
    this.glyphs = createTexture(gl, drawGlyphAtlas());
    this.atlas = createTexture(gl, drawAtlas());

    this.spriteVao = gl.createVertexArray();
    this.spriteBuffer = gl.createBuffer();
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.spriteData.byteLength, gl.DYNAMIC_DRAW);
    this.instanceAttribute(0, 4, 28, 0);
    this.instanceAttribute(1, 3, 28, 16);

    this.tileVao = gl.createVertexArray();
    this.tileBuffer = gl.createBuffer();
    gl.bindVertexArray(this.tileVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.tileData.byteLength, gl.DYNAMIC_DRAW);
    const stride = TILE_FLOATS * 4;
    this.instanceAttribute(0, 4, stride, 0);
    this.instanceAttribute(1, 4, stride, 16);
    this.instanceAttribute(2, 4, stride, 32);
    this.instanceAttribute(3, 1, stride, 48);
    gl.bindVertexArray(null);

    this.director = new LightningDirector(this.now());
    this.frame = requestAnimationFrame(this.tick);
  }

  strike(): void {
    this.director.trigger(this.now());
  }

  // Freezes the clock at t seconds; null resumes real time.
  seek(t: number | null): void {
    this.frozenAt = t;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
  }

  private instanceAttribute(location: number, size: number, stride: number, offset: number): void {
    const gl = this.gl;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(location, 1);
  }

  private now(): number {
    if (this.frozenAt !== null) {
      return this.frozenAt;
    }
    return (performance.now() - this.start) / 1000;
  }

  // Cover-fit the plate into the canvas: offset and scale from canvas UV to image UV.
  private cover(): [number, number, number, number] {
    const canvasAspect = this.canvas.width / this.canvas.height;
    if (canvasAspect > IMAGE_ASPECT) {
      const sy = IMAGE_ASPECT / canvasAspect;
      return [0, (1 - sy) / 2, 1, sy];
    }
    const sx = canvasAspect / IMAGE_ASPECT;
    return [(1 - sx) / 2, 0, sx, 1];
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(this.canvas.clientWidth * dpr);
    const height = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    // The wall renders at the size it covers on screen, so it is as sharp as the plate around it.
    const [, , sx] = this.cover();
    const onScreen = (SCREEN_PIXEL_WIDTH / IMAGE_WIDTH / sx) * width;
    const targetW = Math.round(Math.min(2048, Math.max(640, onScreen * 1.15)));
    const targetH = Math.round(targetW / SCREEN_ASPECT);
    if (!this.target || Math.abs(this.target.width - targetW) > 48) {
      this.target = createRenderTarget(this.gl, targetW, targetH);
    }
    if (!this.scene || this.scene.width !== width || this.scene.height !== height) {
      this.scene = createRenderTarget(this.gl, width, height);
      this.glow = createRenderTarget(this.gl, Math.max(1, width >> 1), Math.max(1, height >> 1));
    }
  }

  private tick = (): void => {
    if (this.disposed) {
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
    this.resize();
    const now = this.now();
    this.director.update(now);
    this.renderContent(now);
    this.renderComposite(now);
    this.renderBloom(now);
  };

  private renderBloom(now: number): void {
    const gl = this.gl;
    const scene = this.scene;
    const glow = this.glow;
    if (!scene || !glow) {
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, glow.framebuffer);
    gl.viewport(0, 0, glow.width, glow.height);
    gl.useProgram(this.bright.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.texture);
    gl.uniform1i(uniform(this.bright, "uScene"), 0);
    gl.uniform2f(uniform(this.bright, "uRes"), glow.width, glow.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, glow.texture);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const p = this.final;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.texture);
    gl.uniform1i(uniform(p, "uScene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, glow.texture);
    gl.uniform1i(uniform(p, "uBright"), 1);
    gl.uniform2f(uniform(p, "uRes"), this.canvas.width, this.canvas.height);
    gl.uniform1f(uniform(p, "uTime"), now);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private renderContent(now: number): void {
    const gl = this.gl;
    const target = this.target;
    if (!target) {
      return;
    }
    const bolts = this.director.bolts(now).slice(0, MAX_BOLTS);

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.BLEND);

    const p = this.content;
    gl.useProgram(p.program);
    gl.uniform2f(uniform(p, "uRes"), target.width, target.height);
    gl.uniform1f(uniform(p, "uTime"), now);
    gl.uniform1f(uniform(p, "uAspect"), SCREEN_ASPECT);
    this.boltUniform.fill(0);
    bolts.forEach((bolt, i) => {
      this.boltUniform[i * 4] = bolt.rect[0] + bolt.rect[2] / 2;
      this.boltUniform[i * 4 + 1] = bolt.intensity;
      this.boltUniform[i * 4 + 2] = bolt.rect[1] + bolt.rect[3];
    });
    gl.uniform4fv(uniform(p, "uBolts"), this.boltUniform);
    gl.uniform1i(uniform(p, "uBoltCount"), bolts.length);
    gl.uniform3fv(uniform(p, "uSheet"), this.director.sheetFlash(now));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.clouds);
    gl.uniform1i(uniform(p, "uClouds"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.renderTiles(now);

    if (bolts.length > 0) {
      bolts.forEach((bolt, i) => {
        this.spriteData.set([...bolt.rect, bolt.sprite, bolt.flip ? 1 : 0, bolt.intensity], i * 7);
      });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.sprite.program);
      gl.uniform2f(uniform(this.sprite, "uAtlasGrid"), ATLAS_COLS, ATLAS_ROWS);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.uniform1i(uniform(this.sprite, "uAtlas"), 0);
      gl.bindVertexArray(this.spriteVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.spriteData, 0, bolts.length * 7);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, bolts.length);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  private renderTiles(now: number): void {
    const gl = this.gl;
    this.tiles.forEach((tile, i) => {
      const state = this.director.tileState(tile, now);
      this.tileData.set(
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
        ],
        i * TILE_FLOATS,
      );
    });
    // Tiles are premultiplied: coverage in alpha, glows added on top.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const p = this.tile;
    gl.useProgram(p.program);
    gl.uniform1f(uniform(p, "uAspect"), SCREEN_ASPECT);
    gl.uniform1f(uniform(p, "uTime"), now);
    gl.uniform2f(uniform(p, "uGlyphGrid"), GLYPH_COLS, GLYPH_ROWS);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphs);
    gl.uniform1i(uniform(p, "uGlyphs"), 0);
    gl.bindVertexArray(this.tileVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.tileData);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.tiles.length);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  private renderComposite(now: number): void {
    const gl = this.gl;
    const target = this.target;
    const scene = this.scene;
    if (!target || !scene) {
      return;
    }
    const bolts = this.director.bolts(now);
    let flash = 0;
    let weighted = 0;
    for (const bolt of bolts) {
      flash += bolt.intensity;
      weighted += bolt.intensity * (bolt.rect[0] + bolt.rect[2] / 2);
    }
    const flashX = flash > 0 ? weighted / flash : 0.5;
    const sheet = this.director.sheetFlash(now);
    const strength = Math.min(1.2, flash * 0.28) + sheet[2] * 0.05;
    // The lamps drop fast on a hit and come back slower, like a sagging supply.
    const dt = Math.min(0.1, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const sagGoal = Math.min(1, flash * 0.9);
    const rate = sagGoal > this.sag ? 30 : 3.5;
    this.sag += (sagGoal - this.sag) * (1 - Math.exp(-rate * dt));
    const [x0, y0] = SCREEN_CORNERS[0];
    const [x1, y1] = SCREEN_CORNERS[2];

    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.framebuffer);
    gl.viewport(0, 0, scene.width, scene.height);
    const p = this.composite;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.studio);
    gl.uniform1i(uniform(p, "uImage"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(uniform(p, "uContent"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.masks);
    gl.uniform1i(uniform(p, "uMasks"), 2);
    gl.uniform1f(uniform(p, "uHorizon"), HORIZON_Y);
    gl.uniform2fv(uniform(p, "uVanish"), FLOOR_VANISH);
    gl.uniform1f(uniform(p, "uSag"), this.sag);
    gl.uniform2fv(uniform(p, "uDownlights"), this.downlights);
    gl.uniform4fv(uniform(p, "uHalo"), HALO_RECT);
    // The sweep runs over the board inside the TV; on the ceiling it spans the whole hall.
    const [progress, sweepStrength] = this.director.sweep(now);
    gl.uniform2f(uniform(p, "uSweep"), -0.05 + progress * 1.1, sweepStrength);
    gl.uniform4fv(uniform(p, "uPillars"), this.pillars);
    gl.uniform1fv(uniform(p, "uPillarFloor"), this.pillarFloors);
    gl.uniform4fv(uniform(p, "uPillarArcs"), this.director.pillarArcs(now));
    gl.uniform1f(uniform(p, "uLevels"), target.levels - 1);
    gl.uniformMatrix3fv(uniform(p, "uToScreen"), false, this.toScreen);
    gl.uniform4fv(uniform(p, "uCover"), this.cover());
    gl.uniform2f(uniform(p, "uRes"), this.canvas.width, this.canvas.height);
    gl.uniform1f(uniform(p, "uTime"), now);
    gl.uniform4f(uniform(p, "uRect"), x0, y0, x1, y1);
    gl.uniform1f(uniform(p, "uMirrorY"), MIRROR_Y);
    gl.uniform1f(uniform(p, "uFloorY"), FLOOR_Y);
    gl.uniform4f(
      uniform(p, "uFlash"),
      0.95 * strength,
      0.8 * strength,
      0.55 * strength,
      x0 + flashX * (x1 - x0),
    );
    gl.uniform1f(uniform(p, "uImageAspect"), IMAGE_ASPECT);
    gl.uniform1f(uniform(p, "uScreenAspect"), SCREEN_ASPECT);
    gl.uniform1f(uniform(p, "uDebug"), this.options.isDebug() ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export { StudioRenderer };
