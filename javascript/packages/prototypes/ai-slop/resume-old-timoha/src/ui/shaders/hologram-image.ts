import { createShaderCanvas, prefersReducedMotion } from "./gl";

// A photo shown as a hologram. A scan line sweeps it into view the first time it scrolls in.
// Every few seconds a glitch burst tears it into shifted slices with an RGB split.
// The pointer (or a tap) makes the burst happen under the finger and adds a ripple.
const FRAGMENT = `
uniform sampler2D uImage;
uniform vec2 uResolution;
uniform vec2 uImageSize;
uniform float uTime;
uniform vec2 uPointer;
uniform float uHover;
uniform float uReveal;
uniform vec3 uTint;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv.y = 1.0 - uv.y;
  float t = uTime;

  // object-fit: cover.
  float canvasAspect = uResolution.x / uResolution.y;
  float imageAspect = uImageSize.x / uImageSize.y;
  vec2 scale = canvasAspect > imageAspect
    ? vec2(1.0, imageAspect / canvasAspect)
    : vec2(canvasAspect / imageAspect, 1.0);
  vec2 sampleUv = (uv - 0.5) * scale + 0.5;

  // Glitch bursts: a short window every ~3.5 s, stronger near the pointer.
  float burst = step(0.86, fract(t * 0.28 + hash(vec2(floor(t * 0.28), 2.0)) * 0.3));
  float pointerBand = exp(-abs(uv.y - uPointer.y) * 12.0) * uHover;
  float slice = floor(uv.y * 34.0 + floor(t * 14.0) * 3.0);
  float tear = (hash(vec2(slice, floor(t * 14.0))) - 0.5) * step(0.7, hash(vec2(slice, 9.0)));
  float glitch = burst * 0.6 + pointerBand;
  sampleUv.x += tear * 0.06 * glitch;

  // Ripple from the pointer.
  vec2 toPointer = uv - uPointer;
  float distance = length(toPointer * vec2(canvasAspect, 1.0));
  float ripple = sin(distance * 40.0 - t * 6.0) * exp(-distance * 6.0) * uHover;
  sampleUv += normalize(toPointer + 0.0001) * ripple * 0.006;

  float split = 0.002 + glitch * 0.012 + abs(ripple) * 0.01;
  float red = texture(uImage, sampleUv + vec2(split, 0.0)).r;
  float green = texture(uImage, sampleUv).g;
  float blue = texture(uImage, sampleUv - vec2(split, 0.0)).b;
  vec3 color = vec3(red, green, blue);

  // Scanlines and a soft tinted bloom.
  color *= 0.86 + 0.14 * sin(gl_FragCoord.y * 2.2 + t * 8.0);
  color += uTint * 0.07 * (1.0 + glitch);
  color += uTint * pointerBand * 0.12;

  // The reveal sweeps from top to bottom with a bright scan line at its front.
  float front = uReveal * 1.2 - uv.y;
  float reveal = smoothstep(0.0, 0.03, front);
  float scanLine = exp(-abs(front) * 60.0) * step(uReveal, 0.999);
  color += uTint * scanLine * 1.6;

  // Edges fade into the dark page.
  vec2 border = smoothstep(vec2(0.0), vec2(0.06), uv) * smoothstep(vec2(0.0), vec2(0.06), 1.0 - uv);
  float alpha = border.x * border.y * max(reveal, scanLine);
  outColor = vec4(color * alpha, alpha);
}
`;

const TINTS = {
  cyan: [0.0, 0.9, 1.0],
  magenta: [1.0, 0.15, 0.8],
  violet: [0.55, 0.3, 1.0],
} as const;

type TTint = keyof typeof TINTS;

type THologramOptions = {
  tint: TTint;
  // Mobile renders at 30 fps and lower resolution.
  lite: boolean;
};

const mountHologramImage = (canvas: HTMLCanvasElement, src: string, { tint, lite }: THologramOptions) => {
  const shader = createShaderCanvas(canvas, FRAGMENT, { scale: lite ? 0.75 : 1 });
  if (!shader) {
    return () => {};
  }
  const { gl, location } = shader;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([7, 6, 13, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const imageSize = { width: 1, height: 1 };
  let loaded = false;
  const image = new Image();
  image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    imageSize.width = image.naturalWidth;
    imageSize.height = image.naturalHeight;
    loaded = true;
  };
  image.src = src;

  const still = prefersReducedMotion();
  const pointer = { x: 0.5, y: 0.5 };
  let hoverTarget = 0;
  let hover = 0;
  let reveal = still ? 1 : 0;
  let visible = false;
  let frame = 0;
  let last = 0;
  const frameGap = lite ? 1000 / 30 : 0;
  const start = performance.now();

  const toLocal = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width;
    pointer.y = (event.clientY - rect.top) / rect.height;
  };
  const onMove = (event: PointerEvent) => {
    toLocal(event);
    hoverTarget = 1;
  };
  const onLeave = () => {
    hoverTarget = 0;
  };
  // A tap gives one glitch pulse that fades by itself.
  const onDown = (event: PointerEvent) => {
    toLocal(event);
    hover = 1.4;
    if (event.pointerType !== "mouse") {
      hoverTarget = 0;
    }
  };

  const render = (now: number) => {
    frame = 0;
    if (!visible) {
      return;
    }
    frame = requestAnimationFrame(render);
    if (!loaded || now - last < frameGap) {
      return;
    }
    last = now;
    hover += (hoverTarget - hover) * 0.08;
    reveal = Math.min(1, reveal + 0.012);
    gl.uniform2f(location("uResolution"), shader.width(), shader.height());
    gl.uniform2f(location("uImageSize"), imageSize.width, imageSize.height);
    gl.uniform1f(location("uTime"), still ? 0 : (now - start) / 1000);
    gl.uniform2f(location("uPointer"), pointer.x, pointer.y);
    gl.uniform1f(location("uHover"), hover);
    gl.uniform1f(location("uReveal"), reveal);
    const [red, green, blue] = TINTS[tint];
    gl.uniform3f(location("uTint"), red, green, blue);
    gl.uniform1i(location("uImage"), 0);
    shader.draw();
  };

  const observer = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible && !frame) {
      frame = requestAnimationFrame(render);
    }
  });
  observer.observe(canvas);

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("pointerdown", onDown);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("pointerdown", onDown);
    shader.dispose();
  };
};

export type { TTint };
export { mountHologramImage };
