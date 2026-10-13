import { createShaderCanvas, devicePixelRatio, prefersReducedMotion } from "./gl";

// The mobile photo: it develops from an ordered-dither duotone into the full photo as it
// scrolls into view. A tap sends one ripple ring across it. The shader draws only when the
// scroll position changes or a ripple is running, so a still screen costs no GPU time.
const FRAGMENT = `
uniform sampler2D uImage;
uniform vec2 uResolution;
uniform float uProgress;
uniform float uZoom;
uniform float uCell;
uniform vec2 uTap;
uniform float uTapAge;
out vec4 outColor;

float bayer4(vec2 cell) {
  ivec2 i = ivec2(mod(cell, 4.0));
  const float matrix[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  return (matrix[i.x + i.y * 4] + 0.5) / 16.0;
}

vec2 imageUv(vec2 uv) {
  return (uv - 0.5) / uZoom + 0.5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv.y = 1.0 - uv.y;

  vec2 toTap = uv - uTap;
  float distance = length(toTap);
  float ring = uTapAge * 0.9;
  float wave = exp(-pow((distance - ring) * 14.0, 2.0)) * (1.0 - smoothstep(0.4, 1.2, uTapAge));
  vec2 offset = toTap / max(distance, 0.0001) * wave * 0.02;

  vec3 photo = texture(uImage, imageUv(uv + offset)).rgb;

  // The dithered layer samples one texel per cell, so it reads as big print dots.
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  vec2 cellUv = (cell + 0.5) * uCell / uResolution;
  cellUv.y = 1.0 - cellUv.y;
  float luminance = dot(texture(uImage, imageUv(cellUv)).rgb, vec3(0.299, 0.587, 0.114));
  float threshold = bayer4(cell);
  vec3 ink = vec3(0.10, 0.05, 0.05);
  vec3 paper = vec3(1.0, 0.62, 0.32);
  vec3 dither = luminance * 1.35 > threshold ? paper : ink;

  // Cells switch on from the bottom up, in Bayer order, then the real photo fades over them.
  float front = clamp(uProgress * 1.7 - (1.0 - uv.y) * 0.7, 0.0, 1.0);
  float shown = step(threshold, front);
  float develop = smoothstep(0.55, 0.95, uProgress);
  vec3 color = mix(dither, photo, develop);
  color += vec3(1.0, 0.6, 0.3) * wave * 0.35;

  vec2 centered = uv - vec2(0.5, 0.52);
  float edge = 1.0 - smoothstep(0.32, 0.5, length(centered * vec2(1.0, 0.92)));

  float alpha = edge * shown;
  outColor = vec4(color * alpha, alpha);
}
`;

const RIPPLE_SECONDS = 1.3;

const mountDitherImage = (canvas: HTMLCanvasElement, src: string, zoom: number) => {
  let dirty = true;
  const shader = createShaderCanvas(canvas, FRAGMENT, {
    onResize: () => {
      dirty = true;
    },
  });
  if (!shader) {
    return () => {};
  }
  const { gl, location } = shader;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 13, 10, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let loaded = false;
  const image = new Image();
  image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    loaded = true;
    dirty = true;
  };
  image.src = src;

  const still = prefersReducedMotion();
  const tap = { x: 0.5, y: 0.5 };
  let tapStart = -Infinity;
  let lastProgress = -1;
  let visible = false;

  const onTap = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    tap.x = (event.clientX - rect.left) / rect.width;
    tap.y = (event.clientY - rect.top) / rect.height;
    tapStart = performance.now();
  };
  canvas.addEventListener("pointerdown", onTap, { passive: true });

  // 0 when the canvas top reaches the bottom of the screen, 1 when its centre reaches 60% of the screen.
  const scrollProgress = () => {
    if (still) {
      return 1;
    }
    const rect = canvas.getBoundingClientRect();
    const start = window.innerHeight;
    const end = window.innerHeight * 0.6 - rect.height / 2;
    return Math.min(1, Math.max(0, (start - rect.top) / (start - end)));
  };

  let frame = 0;
  const render = (now: number) => {
    frame = requestAnimationFrame(render);
    if (!visible || !loaded) {
      return;
    }
    const progress = scrollProgress();
    const tapAge = (now - tapStart) / 1000;
    const rippling = !still && tapAge < RIPPLE_SECONDS;
    if (!dirty && !rippling && Math.abs(progress - lastProgress) < 0.002) {
      return;
    }
    dirty = false;
    lastProgress = progress;

    gl.uniform2f(location("uResolution"), shader.width(), shader.height());
    gl.uniform1f(location("uProgress"), progress);
    gl.uniform1f(location("uZoom"), zoom);
    gl.uniform1f(location("uCell"), 3 * devicePixelRatio());
    gl.uniform2f(location("uTap"), tap.x, tap.y);
    gl.uniform1f(location("uTapAge"), rippling ? tapAge : 10);
    gl.uniform1i(location("uImage"), 0);
    shader.draw();
  };
  frame = requestAnimationFrame(render);

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    dirty = true;
  });
  intersection.observe(canvas);

  return () => {
    cancelAnimationFrame(frame);
    intersection.disconnect();
    canvas.removeEventListener("pointerdown", onTap);
    shader.dispose();
  };
};

export { mountDitherImage };
