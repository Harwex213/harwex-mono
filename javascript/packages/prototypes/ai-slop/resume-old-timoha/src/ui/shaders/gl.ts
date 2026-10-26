// A minimal WebGL2 runner for one fullscreen fragment shader on one canvas.

const VERTEX_SOURCE = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// Shared helpers prepended to every fragment shader.
const NOISE_SOURCE = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = rotate * p;
    amplitude *= 0.5;
  }
  return value;
}
`;

type TShaderCanvasOptions = {
  // Multiplies the device pixel ratio. Below 1 renders fewer pixels and lets CSS upscale them.
  scale?: number;
  // A resize clears the canvas, so an on-demand renderer must draw again.
  onResize?: () => void;
};

type TShaderCanvas = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  location: (name: string) => WebGLUniformLocation | null;
  width: () => number;
  height: () => number;
  draw: () => void;
  dispose: () => void;
};

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Cannot create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile error");
  }
  return shader;
};

const createShaderCanvas = (
  canvas: HTMLCanvasElement,
  fragmentBody: string,
  options: TShaderCanvasOptions = {},
): TShaderCanvas | null => {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) {
    return null;
  }

  const fragmentSource = `#version 300 es
precision highp float;
${NOISE_SOURCE}
${fragmentBody}`;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program link error");
  }
  gl.useProgram(program);

  // One triangle that covers the whole viewport.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resize = () => {
    const ratio = devicePixelRatio() * (options.scale ?? 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      options.onResize?.();
    }
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const locations = new Map<string, WebGLUniformLocation | null>();

  return {
    gl,
    program,
    location: (name) => {
      if (!locations.has(name)) {
        locations.set(name, gl.getUniformLocation(program, name));
      }
      return locations.get(name) ?? null;
    },
    width: () => canvas.width,
    height: () => canvas.height,
    draw: () => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose: () => {
      observer.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
};

const devicePixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type { TShaderCanvas };
export { createShaderCanvas, devicePixelRatio, prefersReducedMotion };
