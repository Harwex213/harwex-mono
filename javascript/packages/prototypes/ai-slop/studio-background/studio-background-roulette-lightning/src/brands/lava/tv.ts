// The lava hall's TV. It renders the smoke, the board and the bolts into a mip-mapped target,
// and reports the light it throws: hot orange from the bolts, near white from the lucky ones.

import cloudsUrl from "../../core/clouds.png";
import { GLYPH_COLS, GLYPH_ROWS, SCREEN_ASPECT, drawGlyphAtlas } from "../../core/board";
import { FULLSCREEN_VERT } from "../../core/glsl";
import { createProgram, createRenderTarget, createTexture, loadImage, uniform } from "../../core/gl";
import type { Program, RenderTarget } from "../../core/gl";
import { ATLAS_COLS, ATLAS_ROWS, LightningDirector, drawAtlas } from "../../core/lightning";
import { BoltBatch, TileBatch, boltLight, tvTargetSize } from "../../core/tv-kit";
import type { TvLight } from "../../core/tv-kit";
import { CONTENT_FRAG, SPRITE_FRAG, SPRITE_VERT, TILE_FRAG, TILE_VERT } from "./tv-shaders";

class LavaTv {
  private readonly gl: WebGL2RenderingContext;
  private content!: Program;
  private sprite!: Program;
  private tile!: Program;
  private clouds!: WebGLTexture;
  private glyphs!: WebGLTexture;
  private atlas!: WebGLTexture;
  private tiles!: TileBatch;
  private bolts!: BoltBatch;
  private director!: LightningDirector;
  private target: RenderTarget | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  async init(now: () => number): Promise<void> {
    const gl = this.gl;
    await Promise.all([document.fonts.load("700 80px \"Josefin Sans\""), document.fonts.ready]);
    const cloudsImage = await loadImage(cloudsUrl);
    this.content = createProgram(gl, FULLSCREEN_VERT, CONTENT_FRAG);
    this.sprite = createProgram(gl, SPRITE_VERT, SPRITE_FRAG);
    this.tile = createProgram(gl, TILE_VERT, TILE_FRAG);
    // The cloud texture does not tile cleanly; mirroring hides the seam.
    this.clouds = createTexture(gl, cloudsImage, { wrap: gl.MIRRORED_REPEAT });
    this.glyphs = createTexture(gl, drawGlyphAtlas());
    this.atlas = createTexture(gl, drawAtlas());
    this.tiles = new TileBatch(gl);
    this.bolts = new BoltBatch(gl);
    this.director = new LightningDirector(now(), this.tiles.tiles);
  }

  get output(): RenderTarget | null {
    return this.target;
  }

  strike(now: number): void {
    this.director.trigger(now);
  }

  resize(onScreenWidth: number): void {
    const [width, height] = tvTargetSize(onScreenWidth);
    if (!this.target || Math.abs(this.target.width - width) > 48) {
      this.target = createRenderTarget(this.gl, width, height);
    }
  }

  light(now: number): TvLight {
    const bolts = boltLight(this.director.bolts(now));
    const sheet = this.director.sheetFlash(now);
    const strength = Math.min(0.75, bolts.total * 0.17) + sheet[2] * 0.04;
    const warm = bolts.lucky;
    return {
      flash: [strength, (0.48 + 0.3 * warm) * strength, (0.2 + 0.25 * warm) * strength],
      flashX: bolts.x,
      surge: this.director.surge(now),
      // Each bolt draws the mains down a little; the lamps sag while the flash lights the room.
      power: 1 - Math.min(0.3, bolts.total * 0.11),
    };
  }

  render(now: number): void {
    const gl = this.gl;
    const target = this.target;
    if (!target) {
      return;
    }
    this.director.update(now);
    const bolts = this.director.bolts(now);

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.BLEND);

    const p = this.content;
    gl.useProgram(p.program);
    gl.uniform2f(uniform(p, "uRes"), target.width, target.height);
    gl.uniform1f(uniform(p, "uTime"), now);
    gl.uniform1f(uniform(p, "uAspect"), SCREEN_ASPECT);
    this.bolts.setUniforms(p, bolts);
    gl.uniform3fv(uniform(p, "uSheet"), this.director.sheetFlash(now));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.clouds);
    gl.uniform1i(uniform(p, "uClouds"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Tiles are premultiplied: coverage in alpha, glows added on top.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const t = this.tile;
    gl.useProgram(t.program);
    gl.uniform1f(uniform(t, "uAspect"), SCREEN_ASPECT);
    gl.uniform1f(uniform(t, "uTime"), now);
    gl.uniform2f(uniform(t, "uGlyphGrid"), GLYPH_COLS, GLYPH_ROWS);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphs);
    gl.uniform1i(uniform(t, "uGlyphs"), 0);
    this.tiles.draw(this.director, now);

    gl.blendFunc(gl.ONE, gl.ONE);
    const s = this.sprite;
    gl.useProgram(s.program);
    gl.uniform2f(uniform(s, "uAtlasGrid"), ATLAS_COLS, ATLAS_ROWS);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(uniform(s, "uAtlas"), 0);
    this.bolts.draw(bolts);
    gl.disable(gl.BLEND);

    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
}

export { LavaTv };
