import { createShaderCanvas, prefersReducedMotion } from "./gl";

// Slow molten caramel with gold contour lines. The cursor warms the field around it.
const FRAGMENT = `
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uScroll;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float t = uTime * 0.045;

  p.y -= uScroll * 0.35;
  vec2 mouse = (uMouse - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  mouse.y -= uScroll * 0.35;
  float mouseDistance = length(p - mouse);
  float warmth = exp(-mouseDistance * 3.2);

  vec2 q = vec2(fbm(p * 1.3 + t), fbm(p * 1.3 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(
    fbm(p * 1.3 + 3.0 * q + vec2(1.7, 9.2) + t * 1.4 + warmth * 0.6),
    fbm(p * 1.3 + 3.0 * q + vec2(8.3, 2.8) - t)
  );
  float f = fbm(p * 1.3 + 3.0 * r);

  vec3 base = vec3(0.050, 0.032, 0.027);
  vec3 amber = vec3(1.0, 0.50, 0.18);
  vec3 plum = vec3(0.52, 0.07, 0.26);

  vec3 color = base;
  color = mix(color, plum * 0.55, smoothstep(0.45, 1.1, length(q)) * 0.55);
  color = mix(color, amber * 0.55, smoothstep(0.58, 1.0, f) * 0.75);

  float band = f * 11.0;
  float line = 1.0 - smoothstep(0.0, fwidth(band) * 1.3, abs(fract(band) - 0.5) - 0.44);
  color += amber * line * (0.035 + 0.12 * warmth);

  color += amber * 0.10 * warmth;
  color *= 1.0 - 0.65 * pow(length(uv - 0.5) * 1.25, 2.0);
  color += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.035;

  outColor = vec4(color, 1.0);
}
`;

const mountBackground = (canvas: HTMLCanvasElement) => {
  const shader = createShaderCanvas(canvas, FRAGMENT);
  if (!shader) {
    return () => {};
  }
  const { gl, location } = shader;

  const target = { x: 0.7, y: 0.6 };
  const mouse = { x: 0.7, y: 0.6 };
  const onMove = (event: PointerEvent) => {
    target.x = event.clientX / window.innerWidth;
    target.y = 1 - event.clientY / window.innerHeight;
  };
  window.addEventListener("pointermove", onMove);

  const still = prefersReducedMotion();
  const start = performance.now();
  let frame = 0;

  const render = () => {
    mouse.x += (target.x - mouse.x) * 0.04;
    mouse.y += (target.y - mouse.y) * 0.04;
    const time = still ? 12 : (performance.now() - start) / 1000;
    gl.uniform2f(location("uResolution"), shader.width(), shader.height());
    gl.uniform1f(location("uTime"), time);
    gl.uniform2f(location("uMouse"), mouse.x, mouse.y);
    gl.uniform1f(location("uScroll"), window.scrollY / window.innerHeight);
    shader.draw();
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove);
    shader.dispose();
  };
};

export { mountBackground };
