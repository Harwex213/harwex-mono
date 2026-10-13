import { createShaderCanvas, prefersReducedMotion } from "./gl";

// A photo that breathes like heat haze. Under the cursor it ripples and splits into RGB.
// The edges fade out, so the dark studio backdrop of the photo melts into the page.
const FRAGMENT = `
uniform sampler2D uImage;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uHover;
uniform float uReveal;
uniform float uZoom;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv.y = 1.0 - uv.y;
  float t = uTime;

  vec2 haze = vec2(
    noise(uv * 5.0 + vec2(0.0, t * 0.6)) - 0.5,
    noise(uv * 5.0 + vec2(4.0, t * 0.5)) - 0.5
  ) * 0.0035;

  vec2 toMouse = uv - uMouse;
  float distance = length(toMouse);
  float ripple = sin(distance * 46.0 - t * 5.0) * exp(-distance * 7.0) * uHover;
  vec2 direction = toMouse / max(distance, 0.0001);
  vec2 offset = haze + direction * ripple * 0.012;

  float split = 0.0012 + abs(ripple) * 0.012;
  vec2 sampleUv = (uv - 0.5) / uZoom + 0.5 + offset;
  float red = texture(uImage, sampleUv + direction * split).r;
  float green = texture(uImage, sampleUv).g;
  float blue = texture(uImage, sampleUv - direction * split).b;
  vec3 color = vec3(red, green, blue);

  color *= 1.0 + 0.18 * uHover * exp(-distance * 4.0);

  vec2 centered = uv - vec2(0.5, 0.52);
  float edge = 1.0 - smoothstep(0.30, 0.5, length(centered * vec2(1.0, 0.92)));

  // The reveal grows from the bottom with a noisy molten front.
  float front = uReveal * 1.25 - (1.0 - uv.y) + (noise(uv * 9.0 + t * 0.3) - 0.5) * 0.18;
  float reveal = smoothstep(0.0, 0.12, front);

  float alpha = edge * reveal;
  outColor = vec4(color * alpha, alpha);
}
`;

const mountLiquidImage = (canvas: HTMLCanvasElement, src: string, zoom: number) => {
  const shader = createShaderCanvas(canvas, FRAGMENT);
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
  };
  image.src = src;

  const mouse = { x: 0.5, y: 0.5 };
  let hoverTarget = 0;
  let hover = 0;
  let reveal = 0;
  let visible = false;

  const onMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) / rect.width;
    mouse.y = (event.clientY - rect.top) / rect.height;
  };
  const onEnter = () => {
    hoverTarget = 1;
  };
  const onLeave = () => {
    hoverTarget = 0;
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerenter", onEnter);
  canvas.addEventListener("pointerleave", onLeave);

  const still = prefersReducedMotion();
  const start = performance.now();
  let frame = 0;

  const render = () => {
    frame = requestAnimationFrame(render);
    if (!visible) {
      return;
    }
    hover += (hoverTarget - hover) * 0.06;
    if (loaded) {
      reveal = still ? 1 : Math.min(1, reveal + 0.012);
    }
    const time = still ? 0 : (performance.now() - start) / 1000;
    gl.uniform2f(location("uResolution"), shader.width(), shader.height());
    gl.uniform1f(location("uTime"), time);
    gl.uniform2f(location("uMouse"), mouse.x, mouse.y);
    gl.uniform1f(location("uHover"), still ? 0 : hover);
    gl.uniform1f(location("uReveal"), reveal);
    gl.uniform1i(location("uImage"), 0);
    gl.uniform1f(location("uZoom"), zoom);
    shader.draw();
  };
  frame = requestAnimationFrame(render);

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
  });
  intersection.observe(canvas);

  return () => {
    cancelAnimationFrame(frame);
    intersection.disconnect();
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerenter", onEnter);
    canvas.removeEventListener("pointerleave", onLeave);
    shader.dispose();
  };
};

export { mountLiquidImage };
