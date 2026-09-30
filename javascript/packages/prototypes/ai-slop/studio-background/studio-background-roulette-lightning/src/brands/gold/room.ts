// The gold studio's room: the plate around the TV, lit by the TV's light.

import { SCREEN_ASPECT } from "../../core/board";
import { FULLSCREEN_VERT } from "../../core/glsl";
import { createProgram, uniform } from "../../core/gl";
import type { Program, RenderTarget } from "../../core/gl";
import { cover, loadPlate } from "../../core/plate";
import type { Plate } from "../../core/plate";
import type { Frame } from "../../core/studio";
import type { TvLight } from "../../core/tv-kit";
import { buildMasks, calibration, plateUrl } from "./plate";
import { COMPOSITE_FRAG } from "./room-shader";

class GoldRoom {
  private readonly gl: WebGL2RenderingContext;
  private composite!: Program;
  private plate!: Plate;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  async init(): Promise<void> {
    this.composite = createProgram(this.gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
    this.plate = await loadPlate(this.gl, plateUrl, calibration, buildMasks);
  }

  render(frame: Frame, tv: RenderTarget, light: TvLight): void {
    const gl = this.gl;
    const plate = this.plate;
    const [x0, y0] = calibration.screenCorners[0];
    const [x1, y1] = calibration.screenCorners[2];

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, frame.width, frame.height);
    const p = this.composite;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plate.image);
    gl.uniform1i(uniform(p, "uImage"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tv.texture);
    gl.uniform1i(uniform(p, "uContent"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, plate.masks);
    gl.uniform1i(uniform(p, "uMasks"), 2);
    gl.uniform1f(uniform(p, "uLevels"), tv.levels - 1);
    gl.uniformMatrix3fv(uniform(p, "uToScreen"), false, plate.toScreen);
    gl.uniform4fv(uniform(p, "uCover"), cover(calibration, frame.width, frame.height));
    gl.uniform2f(uniform(p, "uRes"), frame.width, frame.height);
    gl.uniform1f(uniform(p, "uTime"), frame.now);
    gl.uniform4f(uniform(p, "uRect"), x0, y0, x1, y1);
    gl.uniform2fv(uniform(p, "uNotch"), calibration.notch);
    gl.uniform1f(uniform(p, "uMirrorY"), calibration.mirrorY);
    gl.uniform1f(uniform(p, "uFloorY"), calibration.floorY);
    gl.uniform1f(uniform(p, "uHorizon"), calibration.horizonY);
    gl.uniform2fv(uniform(p, "uVanish"), calibration.vanish);
    gl.uniform4fv(uniform(p, "uLamps"), plate.lamps);
    gl.uniform1fv(uniform(p, "uLampBases"), plate.lampBases);
    gl.uniform1f(uniform(p, "uSurge"), light.surge);
    gl.uniform1f(uniform(p, "uPower"), light.power);
    gl.uniform4f(uniform(p, "uFlash"), light.flash[0], light.flash[1], light.flash[2], x0 + light.flashX * (x1 - x0));
    gl.uniform1f(uniform(p, "uImageAspect"), calibration.imageAspect);
    gl.uniform1f(uniform(p, "uScreenAspect"), SCREEN_ASPECT);
    gl.uniform1f(uniform(p, "uDebug"), frame.isDebug ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export { GoldRoom };
