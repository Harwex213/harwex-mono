// The lava hall's room: the plate around the TV, lit by the TV's light, with its own lights alive.
// First the room's light goes into a mip-mapped target in plate space; the final frame takes the
// glow of the lamps, the LED lines and the lava from its mips.

import { SCREEN_ASPECT } from "../../core/board";
import { FULLSCREEN_VERT } from "../../core/glsl";
import { createDataTexture, createProgram, createRenderTarget, loadImage, uniform } from "../../core/gl";
import type { Program, RenderTarget } from "../../core/gl";
import { cover, createPlate } from "../../core/plate";
import type { Plate } from "../../core/plate";
import type { Frame } from "../../core/studio";
import type { TvLight } from "../../core/tv-kit";
import { CEILING_Y, buildPlate, calibration, plateUrl } from "./plate";
import { COMPOSITE_FRAG, EMISSION_FRAG } from "./room-shader";

// The glow only needs a blurred copy of the lights: half the plate resolution is plenty.
const EMISSION_SCALE = 0.5;

class LavaRoom {
  private readonly gl: WebGL2RenderingContext;
  private composite!: Program;
  private emission!: Program;
  private plate!: Plate;
  private lines!: WebGLTexture;
  private glow!: RenderTarget;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  async init(): Promise<void> {
    const gl = this.gl;
    this.composite = createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
    this.emission = createProgram(gl, FULLSCREEN_VERT, EMISSION_FRAG);
    const image = await loadImage(plateUrl);
    const { masks, lines } = buildPlate(image, calibration);
    this.plate = createPlate(gl, image, calibration, masks);
    this.lines = createDataTexture(gl, lines.data, lines.width, lines.height, { nearest: true });
    this.glow = createRenderTarget(
      gl,
      Math.round(image.naturalWidth * EMISSION_SCALE),
      Math.round(image.naturalHeight * EMISSION_SCALE),
    );
  }

  render(frame: Frame, tv: RenderTarget, light: TvLight): void {
    const gl = this.gl;
    const glow = this.glow;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glow.framebuffer);
    gl.viewport(0, 0, glow.width, glow.height);
    gl.useProgram(this.emission.program);
    this.bindShared(this.emission, frame, light);
    gl.uniform2f(uniform(this.emission, "uRes"), glow.width, glow.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, glow.texture);
    gl.generateMipmap(gl.TEXTURE_2D);

    const [x0, y0] = calibration.screenCorners[0];
    const [x1, y1] = calibration.screenCorners[2];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, frame.width, frame.height);
    const p = this.composite;
    gl.useProgram(p.program);
    this.bindShared(p, frame, light);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, tv.texture);
    gl.uniform1i(uniform(p, "uContent"), 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, glow.texture);
    gl.uniform1i(uniform(p, "uEmission"), 4);
    gl.uniform1f(uniform(p, "uLevels"), tv.levels - 1);
    gl.uniformMatrix3fv(uniform(p, "uToScreen"), false, this.plate.toScreen);
    gl.uniform4fv(uniform(p, "uCover"), cover(calibration, frame.width, frame.height));
    gl.uniform2f(uniform(p, "uRes"), frame.width, frame.height);
    gl.uniform4f(uniform(p, "uRect"), x0, y0, x1, y1);
    gl.uniform2fv(uniform(p, "uNotch"), calibration.notch);
    gl.uniform1f(uniform(p, "uMirrorY"), calibration.mirrorY);
    gl.uniform1f(uniform(p, "uFloorY"), calibration.floorY);
    gl.uniform1f(uniform(p, "uHorizon"), calibration.horizonY);
    gl.uniform1f(uniform(p, "uScreenAspect"), SCREEN_ASPECT);
    gl.uniform1f(uniform(p, "uDebug"), frame.isDebug ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Uniforms that both passes read to light the plate.
  private bindShared(p: Program, frame: Frame, light: TvLight): void {
    const gl = this.gl;
    const plate = this.plate;
    const [x0] = calibration.screenCorners[0];
    const [x1] = calibration.screenCorners[2];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plate.image);
    gl.uniform1i(uniform(p, "uImage"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, plate.masks);
    gl.uniform1i(uniform(p, "uMasks"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lines);
    gl.uniform1i(uniform(p, "uLines"), 2);
    gl.uniform1f(uniform(p, "uTime"), frame.now);
    gl.uniform2fv(uniform(p, "uVanish"), calibration.vanish);
    gl.uniform1f(uniform(p, "uCeilingY"), CEILING_Y / calibration.imageHeight);
    gl.uniform4fv(uniform(p, "uLamps"), plate.lamps);
    gl.uniform1fv(uniform(p, "uLampBases"), plate.lampBases);
    gl.uniform1f(uniform(p, "uSurge"), light.surge);
    gl.uniform1f(uniform(p, "uPower"), light.power);
    gl.uniform4f(uniform(p, "uFlash"), light.flash[0], light.flash[1], light.flash[2], x0 + light.flashX * (x1 - x0));
    gl.uniform1f(uniform(p, "uImageAspect"), calibration.imageAspect);
  }
}

export { LavaRoom };
