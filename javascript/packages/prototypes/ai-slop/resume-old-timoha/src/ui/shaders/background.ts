import { createShaderCanvas, prefersReducedMotion } from "./gl";

// Night City in STONKS mode, built on a generated photo of a cyberpunk skyline.
// The shader brings the photo to life: a slow camera drift with pointer parallax,
// neon bloom, twinkling windows, pulsing billboards, drifting haze and ripples on the river.
// On top of the city a holographic stock chart with candles trends upward across the sky,
// green digital rain and arrows rise. The scroll position shifts the hologram tint a little.
const FRAGMENT = `
uniform sampler2D uImage;
uniform vec2 uImageSize;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform float uScroll;
uniform float uRain;
uniform float uLoaded;
// Texture y (0 at the top) where the river starts in the photo.
uniform float uWater;
// 1 on desktop, 0 in lite mode: lite mode takes fewer bloom samples.
uniform float uQuality;
out vec4 outColor;

const vec3 STONKS = vec3(0.2, 1.0, 0.55);
const vec3 HAZE = vec3(0.16, 0.12, 0.32);

// Chart price at screen x. The trend rises across the screen, the noise scrolls with time,
// so the chart looks like a live ticker that never stops going up.
float chartWiggle(float s) {
  return (fbm(vec2(s * 1.3, 4.0)) - 0.5) * 0.1 + (noise(vec2(s * 7.0, 9.0)) - 0.5) * 0.02;
}

float chartPrice(float x, float s, float base) {
  return base + x * 0.12 + chartWiggle(s) * 0.8;
}

// One upward arrow in a rising column of cells.
float arrow(vec2 uv, float t) {
  vec2 grid = vec2(18.0, 6.0);
  float column = floor(uv.x * grid.x);
  float speed = 0.06 + hash(vec2(column, 3.0)) * 0.08;
  vec2 cell = vec2(uv.x * grid.x, uv.y * grid.y - t * speed * grid.y - hash(vec2(column, 5.0)) * 9.0);
  vec2 id = floor(cell);
  vec2 p = fract(cell) - 0.5;
  float show = step(0.85, hash(id + 0.5));
  float head = step(-0.05, p.y) * step(abs(p.x), (0.25 - p.y) * 0.9) * step(p.y, 0.25);
  float stem = step(abs(p.x), 0.06) * step(-0.3, p.y) * step(p.y, 0.0);
  return max(head, stem) * show;
}

float rain(vec2 uv, float t) {
  float column = floor(uv.x * 80.0);
  float speed = 0.25 + hash(vec2(column, 1.0)) * 0.6;
  float offset = hash(vec2(column, 7.0)) * 10.0;
  float y = fract(uv.y * 0.6 - t * speed + offset);
  float drop = smoothstep(0.0, 0.25, y) * smoothstep(1.0, 0.98, y);
  float glyph = step(0.55, hash(vec2(column, floor(uv.y * 60.0 - t * speed * 36.0))));
  float lane = smoothstep(0.5, 0.15, abs(fract(uv.x * 80.0) - 0.5));
  return pow(y, 6.0) * glyph * lane * drop;
}

vec3 bright(vec2 uv) {
  vec3 c = texture(uImage, uv).rgb;
  return max(c - 0.5, 0.0) * 2.0;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uResolution;
  float aspect = uResolution.x / uResolution.y;
  float t = uTime;
  vec2 pointer = uPointer - 0.5;

  // object-fit: cover, zoomed in a little to leave room for the drift and the parallax.
  float imageAspect = uImageSize.x / uImageSize.y;
  vec2 cover = aspect > imageAspect ? vec2(1.0, imageAspect / aspect) : vec2(aspect / imageAspect, 1.0);
  float zoom = 1.08 + 0.015 * sin(t * 0.05);
  vec2 drift = vec2(sin(t * 0.031) * 0.012, cos(t * 0.023) * 0.006) + pointer * vec2(-0.025, 0.015);
  vec2 imageUv = (vec2(uv.x, 1.0 - uv.y) - 0.5) * cover / zoom + 0.5 + drift;

  // Ripples on the river: the reflections wobble and stretch.
  // They stay weak, because the balcony railing in the foreground overlaps the river.
  float water = smoothstep(uWater - 0.01, uWater + 0.04, imageUv.y);
  float wave = noise(vec2(imageUv.x * 18.0, imageUv.y * 220.0 - t * 1.6)) - 0.5;
  imageUv.x += wave * 0.0025 * water;
  imageUv.y += sin(imageUv.y * 400.0 + t * 2.0) * 0.0005 * water;

  vec3 color = texture(uImage, imageUv).rgb;

  // Twinkling windows: bright pixels breathe in small cells.
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  float twinkle = noise(imageUv * vec2(260.0, 160.0) + vec2(0.0, t * 1.5));
  color *= 1.0 + (twinkle - 0.5) * 0.5 * smoothstep(0.35, 0.8, luminance);

  // Billboards and neon pulse slowly in large patches.
  float pulse = noise(imageUv * 4.0 + vec2(t * 0.15, 0.0));
  color *= 1.0 + 0.18 * (pulse - 0.5) * smoothstep(0.3, 0.7, luminance);

  // Neon bloom: a ring of samples of the bright parts.
  vec3 glow = vec3(0.0);
  float samples = mix(6.0, 12.0, uQuality);
  for (int i = 0; i < 12; i++) {
    if (float(i) >= samples) {
      break;
    }
    float angle = float(i) * 2.39996;
    float radius = 0.004 + 0.022 * sqrt((float(i) + 0.5) / samples);
    glow += bright(imageUv + vec2(cos(angle), sin(angle)) * radius * vec2(1.0, imageAspect));
  }
  color += glow / samples * 0.55;

  // Haze drifting between the towers.
  float fog = fbm(vec2(imageUv.x * 3.0 + t * 0.02, imageUv.y * 6.0 - t * 0.01));
  color += HAZE * fog * 0.18 * smoothstep(0.15, 0.55, imageUv.y) * (1.0 - water * 0.6);

  // Fade in once the photo has loaded.
  color = mix(vec3(0.02, 0.015, 0.05), color, uLoaded);

  // STONKS hologram in the sky: candles, a glowing price line and a fill under it.
  float skyMask = smoothstep(0.7, 0.8, uv.y);
  float chartScale = 2.2;
  float scrollS = t * 0.35;
  float s = uv.x * aspect * chartScale + scrollS;
  float chartBase = 0.8;
  float price = chartPrice(uv.x, s, chartBase);

  float candleWidth = 1.0 / 9.0;
  float candle = floor(s / candleWidth);
  float s0 = candle * candleWidth;
  float s1 = s0 + candleWidth;
  float x0 = (s0 - scrollS) / (aspect * chartScale);
  float x1 = (s1 - scrollS) / (aspect * chartScale);
  float open = chartPrice(x0, s0, chartBase);
  float close = chartPrice(x1, s1, chartBase);
  float rising = step(open, close);
  vec3 candleColor = mix(vec3(1.0, 0.2, 0.35), STONKS, rising);
  float local = fract(s / candleWidth);
  float body = step(abs(local - 0.5), 0.3) * step(min(open, close), uv.y) * step(uv.y, max(open, close) + 0.002);
  float wickTop = max(open, close) + 0.006 + hash(vec2(candle, 2.0)) * 0.012;
  float wickBottom = min(open, close) - 0.006 - hash(vec2(candle, 4.0)) * 0.012;
  float wick = step(abs(local - 0.5), 0.06) * step(wickBottom, uv.y) * step(uv.y, wickTop);
  vec3 tint = mix(STONKS, vec3(0.2, 0.95, 1.0), uScroll * 0.4);
  color += candleColor * max(body * 0.3, wick * 0.22) * skyMask;

  float lineDistance = abs(uv.y - price);
  color += tint * (smoothstep(0.004, 0.0, lineDistance) * 0.7 + exp(-lineDistance * 55.0) * 0.2) * skyMask;
  color += tint * 0.04 * step(uv.y, price) * smoothstep(0.7, price, uv.y) * skyMask;

  // The live price dot pulses at the right edge of the screen.
  vec2 dotPos = vec2(0.93, chartPrice(0.93, 0.93 * aspect * chartScale + scrollS, chartBase));
  float dotDistance = length((uv - dotPos) * vec2(aspect, 1.0));
  color += tint * (smoothstep(0.012, 0.006, dotDistance) + exp(-dotDistance * 30.0) * (0.4 + 0.3 * sin(t * 6.0))) * skyMask;

  // Green digital rain and arrows rise over everything.
  color += STONKS * rain(vec2(uv.x * aspect / 1.6, uv.y), t) * 0.12 * uRain;
  color += STONKS * arrow(vec2(uv.x * aspect / 1.6, uv.y), t) * 0.1 * smoothstep(0.5, 0.75, uv.y) * uRain;

  // Vignette and a little grain.
  color *= smoothstep(1.35, 0.45, length((uv - 0.5) * vec2(aspect * 0.7, 1.0)));
  color += (hash(frag + fract(t) * 91.0) - 0.5) * 0.025;

  outColor = vec4(color, 1.0);
}
`;

type TBackgroundOptions = {
  src: string;
  // Texture y (0 at the top) where the river starts in the photo.
  water: number;
  // Mobile renders at half resolution, 30 fps, fewer bloom samples and less rain.
  lite: boolean;
};

const mountBackground = (canvas: HTMLCanvasElement, { src, water, lite }: TBackgroundOptions) => {
  const shader = createShaderCanvas(canvas, FRAGMENT, { scale: lite ? 0.5 : 0.75 });
  if (!shader) {
    return () => {};
  }
  const { gl, location } = shader;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([7, 6, 13, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const imageSize = { width: 1, height: 1 };
  let loaded = false;
  let fade = 0;

  const pointer = { x: 0.5, y: 0.5 };
  const target = { x: 0.5, y: 0.5 };
  let scroll = 0;
  let frame = 0;
  let last = 0;
  const start = performance.now();
  const still = prefersReducedMotion();
  const frameGap = lite ? 1000 / 30 : 0;

  const onPointer = (event: PointerEvent) => {
    target.x = event.clientX / window.innerWidth;
    target.y = 1 - event.clientY / window.innerHeight;
  };
  const onScroll = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    scroll = window.scrollY / max;
  };

  const render = (now: number) => {
    frame = requestAnimationFrame(render);
    if (now - last < frameGap) {
      return;
    }
    last = now;
    pointer.x += (target.x - pointer.x) * 0.05;
    pointer.y += (target.y - pointer.y) * 0.05;
    if (loaded) {
      fade = still ? 1 : Math.min(1, fade + 0.03);
    }
    gl.uniform1i(location("uImage"), 0);
    gl.uniform2f(location("uImageSize"), imageSize.width, imageSize.height);
    gl.uniform2f(location("uResolution"), shader.width(), shader.height());
    gl.uniform1f(location("uTime"), still ? 12 : (now - start) / 1000);
    gl.uniform2f(location("uPointer"), pointer.x, pointer.y);
    gl.uniform1f(location("uScroll"), scroll);
    gl.uniform1f(location("uRain"), lite ? 0.6 : 1);
    gl.uniform1f(location("uLoaded"), fade);
    gl.uniform1f(location("uWater"), water);
    gl.uniform1f(location("uQuality"), lite ? 0 : 1);
    shader.draw();
    if (still) {
      cancelAnimationFrame(frame);
    }
  };

  const image = new Image();
  image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    imageSize.width = image.naturalWidth;
    imageSize.height = image.naturalHeight;
    loaded = true;
    // Reduced motion draws one frame only, so it must draw again with the photo.
    if (still) {
      frame = requestAnimationFrame(render);
    }
  };
  image.src = src;

  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onPointer);
    window.removeEventListener("scroll", onScroll);
    shader.dispose();
  };
};

export { mountBackground };
