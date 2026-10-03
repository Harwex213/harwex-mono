import cloudArt from "../../../assets/globe/cloud.png";
import paperArt from "../../../assets/globe/paper.jpg";
import { createRng } from "../../../core/rng";

/**
 * The sky of the cleanup scene, drawn in WebGL2 in the style of the globe: an
 * antique fantasy map with a dark slate surround, inked contour lines and
 * hatching, aged paper and hand-drawn clouds.
 *
 * Two canvases use this module. The `under` canvas sits below the Canvas 2D
 * scene: the void, then cloud layers far below the islands. The `over` canvas
 * sits above it: a thin cloud layer drifting in front, a sepia wash, the
 * paper grain and a burnt vignette.
 *
 * Every layer has a parallax factor `p`. A point L of the layer lands on the
 * screen at `centre + (L - camera) * zoom * p`, so a layer with a small `p`
 * is far away: it moves slowly and looks small. Far layers also fog toward
 * the slate, lose colour and blur through a mip bias, like depth of field.
 */

type TSkyMode = "under" | "over";

type TSkyFrame = {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
  readonly cameraX: number;
  readonly cameraY: number;
  readonly zoom: number;
  /** Seconds of drift. Frozen under prefers-reduced-motion. */
  readonly time: number;
  /** The player's island on screen, in CSS pixels: the near clouds clear around it. */
  readonly focusX: number;
  readonly focusY: number;
  readonly focusRadius: number;
};

type TCloudLayer = {
  readonly parallax: number;
  readonly count: number;
  readonly minSize: number;
  readonly maxSize: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly alpha: number;
  readonly fog: number;
  readonly desaturate: number;
  /** Mip bias: a far layer is drawn from a smaller mip, so it looks soft. */
  readonly blur: number;
  readonly clearsFocus: boolean;
};

/** Far to near. The island shadows land on top of these. */
const UNDER_LAYERS: readonly TCloudLayer[] = [
  { parallax: 0.22, count: 46, minSize: 1100, maxSize: 2100, driftX: 9, driftY: 2, alpha: 0.42, fog: 0.72, desaturate: 0.7, blur: 2.6, clearsFocus: false },
  { parallax: 0.36, count: 38, minSize: 900, maxSize: 1600, driftX: 14, driftY: 3, alpha: 0.55, fog: 0.55, desaturate: 0.5, blur: 1.8, clearsFocus: false },
  { parallax: 0.52, count: 30, minSize: 700, maxSize: 1250, driftX: 20, driftY: 4, alpha: 0.68, fog: 0.38, desaturate: 0.3, blur: 1, clearsFocus: false },
];

/** A thin layer in front of the islands. It thins out around the player's island. */
const OVER_LAYERS: readonly TCloudLayer[] = [
  { parallax: 1.55, count: 9, minSize: 600, maxSize: 950, driftX: 34, driftY: 6, alpha: 0.42, fog: 0.08, desaturate: 0.1, blur: 0.6, clearsFocus: true },
];

/** The visible span of a layer at the widest zoom, so the wrapped field never shows its seam. */
const FIELD_SPAN_PX = 4200;
const FOG_COLOR: readonly [number, number, number] = [0.15, 0.17, 0.18];

const QUAD_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave += 1) {
    sum += valueNoise(p) * amplitude;
    p = p * 2.03 + vec2(17.1, 9.3);
    amplitude *= 0.5;
  }
  return sum;
}

/** A thin ink line along the zero of a field, about a pixel wide. */
float inkLine(float field, float width) {
  float fw = fwidth(field);
  return 1.0 - smoothstep(width - fw, width + fw, abs(field));
}
`;

/** The void: slate wash, inked contours of the depths, patchy hatching, paper grain. */
const BACKGROUND_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uRatio;
uniform vec2 uCamera;
uniform float uZoom;
uniform float uTime;
uniform sampler2D uPaper;
out vec4 outColor;
${NOISE}
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y * uRatio - gl_FragCoord.y) / uRatio;
  vec2 center = uResolution * 0.5;
  // The deepest layer of all: it barely moves when the camera does.
  vec2 deep = uCamera * 0.08 + (frag - center) / max(uZoom, 0.4);
  float radius = length((frag - center) / uResolution.y);

  vec3 color = mix(vec3(0.205, 0.228, 0.238), vec3(0.082, 0.092, 0.1), smoothstep(0.05, 0.95, radius));
  float n = fbm(deep * 0.0016 + vec2(uTime * 0.004, 0.0));
  color *= 0.82 + 0.36 * n;

  // Inked contour lines, as the depth lines of an old sea chart.
  float contour = inkLine(fract(n * 9.0) - 0.5, 0.04);
  color = mix(color, vec3(0.62, 0.55, 0.42), contour * 0.09);

  // Diagonal hatching, thicker toward the edge and in the darker patches.
  float hatch = inkLine(fract((frag.x + frag.y) / 7.0) - 0.5, 0.09);
  float hatchMask = smoothstep(0.45, 0.25, n) * 0.5 + smoothstep(0.35, 0.9, radius) * 0.6;
  color = mix(color, vec3(0.04, 0.035, 0.03), hatch * clamp(hatchMask, 0.0, 1.0) * 0.45);

  vec3 paper = texture(uPaper, frag / 640.0).rgb;
  color *= mix(vec3(1.0), paper / max(dot(paper, vec3(0.2126, 0.7152, 0.0722)), 0.05), 0.3);

  outColor = vec4(color, 1.0);
}
`;

const CLOUD_VERTEX = /* glsl */ `#version 300 es
in vec2 aCorner;
in vec4 aCloud;
uniform vec2 uResolution;
uniform vec2 uCamera;
uniform float uZoom;
uniform float uParallax;
uniform float uTile;
uniform vec2 uDrift;
uniform float uTime;
out vec2 vUv;
void main() {
  vec2 position = aCloud.xy + uDrift * uTime;
  vec2 rel = mod(position - uCamera + uTile * 0.5, uTile) - uTile * 0.5;
  float size = aCloud.z;
  vec2 local = aCorner * vec2(size, size * 0.8);
  vec2 screen = (rel + local) * uZoom * uParallax;
  vec2 clip = screen / (uResolution * 0.5);
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float flip = aCloud.w > 0.5 ? -1.0 : 1.0;
  vUv = vec2(aCorner.x * flip, aCorner.y) + 0.5;
}
`;

const CLOUD_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uCloud;
uniform vec2 uResolution;
uniform float uRatio;
uniform float uBias;
uniform vec3 uFog;
uniform float uFogAmount;
uniform float uDesaturate;
uniform float uAlpha;
uniform vec2 uFocus;
uniform float uFocusRadius;
uniform float uClearsFocus;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 cloud = texture(uCloud, vUv, uBias);
  float luma = dot(cloud.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 color = mix(cloud.rgb, vec3(luma), uDesaturate);
  color = mix(color, uFog, uFogAmount);
  float alpha = cloud.a * uAlpha;

  vec2 frag = vec2(gl_FragCoord.x, uResolution.y * uRatio - gl_FragCoord.y) / uRatio;
  float clearing = smoothstep(uFocusRadius * 0.7, uFocusRadius * 1.6, length(frag - uFocus));
  alpha *= mix(1.0, clearing, uClearsFocus);

  outColor = vec4(color * alpha, alpha);
}
`;

/** Over everything: a faint sepia wash, paper grain and a burnt vignette, as ink on old paper. */
const VEIL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uRatio;
uniform sampler2D uPaper;
out vec4 outColor;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y * uRatio - gl_FragCoord.y) / uRatio;
  vec2 centered = (frag - uResolution * 0.5) / uResolution;
  float radius = length(centered * vec2(1.0, 0.85));

  float paper = dot(texture(uPaper, frag / 640.0).rgb, vec3(0.2126, 0.7152, 0.0722));
  float grain = clamp((0.86 - paper) * 1.6, 0.0, 1.0) * 0.22;
  float burn = smoothstep(0.36, 0.78, radius);

  vec3 ink = vec3(0.11, 0.075, 0.04);
  float darkness = clamp(grain + burn * 0.78, 0.0, 0.9);
  // A faint sepia wash first, then the darkening on top of it, as one
  // premultiplied layer: wash over the scene, then ink over both.
  vec3 wash = vec3(0.62, 0.48, 0.28);
  float washAlpha = 0.07;
  vec3 color = wash * washAlpha * (1.0 - darkness) + ink * darkness;
  float alpha = 1.0 - (1.0 - washAlpha) * (1.0 - darkness);

  outColor = vec4(color, alpha);
}
`;

type TProgram = {
  readonly program: WebGLProgram;
  readonly uniforms: Map<string, WebGLUniformLocation | null>;
};

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("No shader");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader did not compile");
  }

  return shader;
};

const createProgram = (gl: WebGL2RenderingContext, vertex: string, fragment: string): TProgram => {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("No program");
  }

  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.bindAttribLocation(program, 0, "aCorner");
  gl.bindAttribLocation(program, 1, "aCloud");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program did not link");
  }

  return { program, uniforms: new Map() };
};

const uniform = (gl: WebGL2RenderingContext, target: TProgram, name: string) => {
  if (!target.uniforms.has(name)) {
    target.uniforms.set(name, gl.getUniformLocation(target.program, name));
  }

  return target.uniforms.get(name) ?? null;
};

const loadTexture = (gl: WebGL2RenderingContext, src: string, onReady: () => void) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  const image = new Image();
  image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    onReady();
  };
  image.src = src;

  return texture;
};

/** Random clouds in one wrapped tile of a layer: x, y, size, mirror flag. */
const cloudInstances = (layer: TCloudLayer, tile: number, seed: number) => {
  const rng = createRng(seed);
  const data = new Float32Array(layer.count * 4);

  for (let index = 0; index < layer.count; index += 1) {
    data[index * 4] = (rng() - 0.5) * tile;
    data[index * 4 + 1] = (rng() - 0.5) * tile;
    data[index * 4 + 2] = layer.minSize + rng() * (layer.maxSize - layer.minSize);
    data[index * 4 + 3] = rng() < 0.5 ? 0 : 1;
  }

  return data;
};

type TSkyRenderer = {
  readonly render: (frame: TSkyFrame) => void;
  readonly dispose: () => void;
};

const createSkyRenderer = (canvas: HTMLCanvasElement, mode: TSkyMode, seed: number): TSkyRenderer | null => {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: mode === "over", antialias: false });
  if (!gl) {
    return null;
  }

  let texturesReady = 0;
  const paper = loadTexture(gl, paperArt, () => {
    texturesReady += 1;
  });
  const cloud = loadTexture(gl, cloudArt, () => {
    texturesReady += 1;
  });

  const background = mode === "under" ? createProgram(gl, QUAD_VERTEX, BACKGROUND_FRAGMENT) : null;
  const veil = mode === "over" ? createProgram(gl, QUAD_VERTEX, VEIL_FRAGMENT) : null;
  const clouds = createProgram(gl, CLOUD_VERTEX, CLOUD_FRAGMENT);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5]), gl.STATIC_DRAW);

  const layers = (mode === "under" ? UNDER_LAYERS : OVER_LAYERS).map((layer, index) => {
    const tile = FIELD_SPAN_PX / (0.4 * layer.parallax);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const instances = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    gl.bufferData(gl.ARRAY_BUFFER, cloudInstances(layer, tile, seed + index * 977), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    return { layer, tile, vao, instances };
  });

  gl.bindVertexArray(null);

  const render = (frame: TSkyFrame) => {
    const pixelWidth = Math.round(frame.width * frame.ratio);
    const pixelHeight = Math.round(frame.height * frame.ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paper);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cloud);

    if (background) {
      gl.useProgram(background.program);
      gl.uniform2f(uniform(gl, background, "uResolution"), frame.width, frame.height);
      gl.uniform1f(uniform(gl, background, "uRatio"), frame.ratio);
      gl.uniform2f(uniform(gl, background, "uCamera"), frame.cameraX, frame.cameraY);
      gl.uniform1f(uniform(gl, background, "uZoom"), frame.zoom);
      gl.uniform1f(uniform(gl, background, "uTime"), frame.time);
      gl.uniform1i(uniform(gl, background, "uPaper"), 0);
      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if (texturesReady >= 2) {
      gl.useProgram(clouds.program);
      gl.uniform2f(uniform(gl, clouds, "uResolution"), frame.width, frame.height);
      gl.uniform1f(uniform(gl, clouds, "uRatio"), frame.ratio);
      gl.uniform2f(uniform(gl, clouds, "uCamera"), frame.cameraX, frame.cameraY);
      gl.uniform1f(uniform(gl, clouds, "uZoom"), frame.zoom);
      gl.uniform1f(uniform(gl, clouds, "uTime"), frame.time);
      gl.uniform1i(uniform(gl, clouds, "uCloud"), 1);
      gl.uniform3f(uniform(gl, clouds, "uFog"), FOG_COLOR[0], FOG_COLOR[1], FOG_COLOR[2]);
      gl.uniform2f(uniform(gl, clouds, "uFocus"), frame.focusX, frame.focusY);
      gl.uniform1f(uniform(gl, clouds, "uFocusRadius"), frame.focusRadius);

      for (const entry of layers) {
        const { layer } = entry;
        gl.uniform1f(uniform(gl, clouds, "uParallax"), layer.parallax);
        gl.uniform1f(uniform(gl, clouds, "uTile"), entry.tile);
        gl.uniform2f(uniform(gl, clouds, "uDrift"), layer.driftX, layer.driftY);
        gl.uniform1f(uniform(gl, clouds, "uBias"), layer.blur);
        gl.uniform1f(uniform(gl, clouds, "uFogAmount"), layer.fog);
        gl.uniform1f(uniform(gl, clouds, "uDesaturate"), layer.desaturate);
        gl.uniform1f(uniform(gl, clouds, "uAlpha"), layer.alpha * (layer.clearsFocus ? Math.min(1, 1.2 - frame.zoom * 0.5) : 1));
        gl.uniform1f(uniform(gl, clouds, "uClearsFocus"), layer.clearsFocus ? 1 : 0);
        gl.bindVertexArray(entry.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, layer.count);
      }
    }

    if (veil) {
      gl.useProgram(veil.program);
      gl.uniform2f(uniform(gl, veil, "uResolution"), frame.width, frame.height);
      gl.uniform1f(uniform(gl, veil, "uRatio"), frame.ratio);
      gl.uniform1i(uniform(gl, veil, "uPaper"), 0);
      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindVertexArray(null);
  };

  const dispose = () => {
    gl.deleteTexture(paper);
    gl.deleteTexture(cloud);
    gl.deleteBuffer(quad);
    gl.deleteBuffer(corners);
    for (const entry of layers) {
      gl.deleteBuffer(entry.instances);
      gl.deleteVertexArray(entry.vao);
    }

    gl.deleteVertexArray(quadVao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };

  return { render, dispose };
};

export type { TSkyFrame, TSkyRenderer };
export { createSkyRenderer };
