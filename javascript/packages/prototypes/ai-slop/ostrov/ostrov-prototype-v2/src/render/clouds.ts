import { config } from "@hw/ostrov-prototype-v2-config";
import type { Camera } from "../state/camera";
import { FRAGMENT_SOURCE, VERTEX_SOURCE } from "./cloudShader";
import { SKY_BOTTOM, SKY_MID, SKY_TOP, hexToRgb } from "./palette";

/** Names of every uniform the fragment shader declares. */
const UNIFORMS = [
  "u_resolution",
  "u_pixelRatio",
  "u_time",
  "u_camera",
  "u_parallax",
  "u_drift",
  "u_noiseScale",
  "u_octaves",
  "u_coverage",
  "u_softness",
  "u_warp",
  "u_clouds",
  "u_skyTop",
  "u_skyMid",
  "u_skyBottom",
  "u_skyMidStop",
  "u_light",
  "u_warmTone",
  "u_shadow",
] as const;

type UniformName = (typeof UNIFORMS)[number];

type Locations = Partial<Record<UniformName, WebGLUniformLocation | null>>;

/** `#rrggbb` as the 0…1 triple a `vec3` uniform wants. */
function toVec3(colour: string): [number, number, number] {
  const rgb = hexToRgb(colour);
  return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
}

/** The plain CSS gradient shown when WebGL is unavailable. */
function skyGradientCss(): string {
  const stop = Math.round(config.background.skyMidStop * 100);
  return `linear-gradient(to bottom, ${SKY_TOP} 0%, ${SKY_MID} ${stop}%, ${SKY_BOTTOM} 100%)`;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("не удалось создать шейдер");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "без описания";
    gl.deleteShader(shader);
    throw new Error(`шейдер не компилируется: ${log}`);
  }
  return shader;
}

function link(gl: WebGLRenderingContext): WebGLProgram {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  const program = gl.createProgram();
  if (!program) {
    throw new Error("не удалось создать программу");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // The shaders belong to the program now; a delete here only drops our handle.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "без описания";
    gl.deleteProgram(program);
    throw new Error(`программа не линкуется: ${log}`);
  }
  return program;
}

/**
 * Animated cloud sky on its own WebGL canvas, sitting behind the 2D map.
 *
 * It owns an always-on animation frame of its own, independent of the map's
 * dirty-flag loop, because the clouds move with no input at all. The loop stops
 * while the tab is hidden and the clock stops with it, so coming back does not
 * jump the clouds forward by the time spent in another tab.
 */
class CloudLayer {
  private readonly gl: WebGLRenderingContext | null;
  private readonly program: WebGLProgram | null = null;
  private readonly locations: Locations = {};
  private readonly buffer: WebGLBuffer | null = null;
  private width = 0;
  private height = 0;
  private ratio = 0;
  private elapsed = 0;
  private lastStamp = 0;
  private frame = 0;
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly readCamera: () => Camera,
  ) {
    // Always present, so a lost or missing context degrades to the sky gradient
    // instead of a hole in the page.
    canvas.style.background = skyGradientCss();
    this.gl = this.createContext();
    if (!this.gl) {
      return;
    }
    const gl = this.gl;
    try {
      this.program = link(gl);
    } catch (error) {
      console.warn(`Облака отключены: ${String(error)}`);
      this.gl = null;
      return;
    }
    for (const name of UNIFORMS) {
      this.locations[name] = gl.getUniformLocation(this.program, name);
    }
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    // Two triangles covering clip space.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(this.program);
  }

  /** True when the shader is live; false means the CSS gradient is all there is. */
  get enabled(): boolean {
    return this.gl !== null;
  }

  /** Starts the animation loop and returns the teardown for it. */
  start(): () => void {
    const onVisibility = (): void => {
      if (document.hidden) {
        this.stop();
        return;
      }
      this.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) {
      this.resume();
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      this.stop();
      this.dispose();
    };
  }

  private createContext(): WebGLRenderingContext | null {
    const options: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // The map canvas above wants a fresh sky under it every frame anyway.
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    };
    const context =
      this.canvas.getContext("webgl", options) ?? this.canvas.getContext("experimental-webgl", options);
    if (!context) {
      console.warn("Облака отключены: WebGL недоступен, остался градиент неба.");
      return null;
    }
    return context as WebGLRenderingContext;
  }

  private resume(): void {
    if (this.running || !this.gl) {
      return;
    }
    this.running = true;
    this.lastStamp = 0;
    const loop = (stamp: number): void => {
      this.frame = requestAnimationFrame(loop);
      // The first frame after a resume advances the clock by nothing at all.
      const delta = this.lastStamp === 0 ? 0 : (stamp - this.lastStamp) / 1000;
      this.lastStamp = stamp;
      this.elapsed += Math.min(delta, 0.1);
      this.draw();
    };
    this.frame = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private dispose(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    if (this.buffer) {
      gl.deleteBuffer(this.buffer);
    }
    if (this.program) {
      gl.deleteProgram(this.program);
    }
  }

  /** Matches the drawing buffer to the CSS box and the device pixel ratio. */
  private resize(gl: WebGLRenderingContext): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight));
    if (width === this.width && height === this.height && ratio === this.ratio) {
      return;
    }
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(): void {
    const gl = this.gl;
    if (!gl || !this.program) {
      return;
    }
    this.resize(gl);
    const camera = this.readCamera();
    const at = this.locations;
    gl.uniform2f(at.u_resolution ?? null, this.width, this.height);
    gl.uniform1f(at.u_pixelRatio ?? null, this.ratio);
    gl.uniform1f(at.u_time ?? null, this.elapsed);
    gl.uniform3f(at.u_camera ?? null, camera.x, camera.y, camera.scale);
    gl.uniform1f(at.u_parallax ?? null, config.background.parallax);
    gl.uniform1f(at.u_drift ?? null, config.background.cloudDriftSpeed);
    gl.uniform1f(at.u_noiseScale ?? null, config.background.cloudNoiseScale);
    gl.uniform1f(at.u_octaves ?? null, config.background.cloudOctaves);
    gl.uniform1f(at.u_coverage ?? null, config.background.cloudCoverage);
    gl.uniform1f(at.u_softness ?? null, config.background.cloudSoftness);
    gl.uniform1f(at.u_warp ?? null, config.background.cloudWarp);
    gl.uniform1f(at.u_clouds ?? null, config.background.cloudsEnabled ? 1 : 0);
    gl.uniform3fv(at.u_skyTop ?? null, toVec3(SKY_TOP));
    gl.uniform3fv(at.u_skyMid ?? null, toVec3(SKY_MID));
    gl.uniform3fv(at.u_skyBottom ?? null, toVec3(SKY_BOTTOM));
    gl.uniform1f(at.u_skyMidStop ?? null, config.background.skyMidStop);
    gl.uniform3fv(at.u_light ?? null, toVec3(config.background.cloudLightColor));
    gl.uniform3fv(at.u_warmTone ?? null, toVec3(config.background.cloudWarmColor));
    gl.uniform3fv(at.u_shadow ?? null, toVec3(config.background.cloudShadowColor));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export { CloudLayer, skyGradientCss };
