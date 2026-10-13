import { createShaderCanvas, prefersReducedMotion } from "./gl";

// The mobile backdrop: a lava lamp of six metaballs. It costs a handful of divisions per pixel,
// renders at half resolution and 30 fps. Scrolling stretches the blobs, a touch pulls them closer.
const FRAGMENT = `
uniform vec2 uResolution;
uniform float uTime;
uniform float uScroll;
uniform float uVelocity;
uniform vec2 uTouch;
uniform float uTouchStrength;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime;

  // Scroll speed squashes the field vertically, so the blobs stretch like wax in a moving lamp.
  float stretch = 1.0 + clamp(abs(uVelocity), 0.0, 1.5) * 0.6;

  float field = 0.0;
  float warmth = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float speed = 0.035 + fi * 0.008;
    vec2 center = vec2(
      (0.5 + 0.38 * sin(t * (0.21 + fi * 0.05) + fi * 2.1)) * aspect,
      fract(fi * 0.23 - t * speed - uScroll * 0.08) * 1.5 - 0.25
    );
    center = mix(center, vec2(uTouch.x * aspect, uTouch.y), uTouchStrength * 0.18);
    vec2 d = p - center;
    d.y /= stretch;
    float radius = 0.13 + 0.05 * sin(fi * 1.7 + t * 0.4);
    float contribution = radius * radius / max(dot(d, d), 0.0001);
    field += contribution;
    warmth += contribution * fract(fi * 0.37);
  }
  warmth /= max(field, 0.0001);

  vec3 base = vec3(0.050, 0.032, 0.027);
  vec3 amber = vec3(1.0, 0.50, 0.18);
  vec3 plum = vec3(0.52, 0.07, 0.26);
  vec3 wax = mix(plum, amber, smoothstep(0.1, 0.7, warmth + uv.y * 0.3));

  float body = smoothstep(0.9, 1.4, field);
  float rim = smoothstep(0.55, 0.95, field) - body;

  vec3 color = base;
  color += wax * 0.07 * smoothstep(0.15, 0.9, field);
  color = mix(color, wax * 0.42, body);
  color += wax * rim * 0.25;
  color *= 1.0 - 0.5 * pow(abs(uv.x - 0.5) * 1.6, 2.0);
  color += (hash(gl_FragCoord.xy + fract(t) * 37.0) - 0.5) * 0.03;

  outColor = vec4(color, 1.0);
}
`;

const FRAME_INTERVAL = 1000 / 30;

const mountLavaLamp = (canvas: HTMLCanvasElement) => {
  const shader = createShaderCanvas(canvas, FRAGMENT, { scale: 0.5 });
  if (!shader) {
    return () => {};
  }
  const { gl, location } = shader;

  const touch = { x: 0.5, y: 0.5 };
  let touchStrength = 0;
  let touchTarget = 0;
  const onTouch = (event: PointerEvent) => {
    touch.x = event.clientX / window.innerWidth;
    touch.y = 1 - event.clientY / window.innerHeight;
    touchTarget = 1;
  };
  const onRelease = () => {
    touchTarget = 0;
  };
  window.addEventListener("pointerdown", onTouch, { passive: true });
  window.addEventListener("pointermove", onTouch, { passive: true });
  window.addEventListener("pointerup", onRelease, { passive: true });
  window.addEventListener("pointercancel", onRelease, { passive: true });

  const still = prefersReducedMotion();
  const start = performance.now();
  let lastFrame = 0;
  let lastScroll = window.scrollY;
  let velocity = 0;
  let frame = 0;

  const render = (now: number) => {
    frame = requestAnimationFrame(render);
    if (now - lastFrame < FRAME_INTERVAL) {
      return;
    }
    lastFrame = now;

    const scroll = window.scrollY;
    velocity += ((scroll - lastScroll) / window.innerHeight * 10 - velocity) * 0.15;
    lastScroll = scroll;
    touchStrength += (touchTarget - touchStrength) * 0.08;

    gl.uniform2f(location("uResolution"), shader.width(), shader.height());
    gl.uniform1f(location("uTime"), still ? 20 : (now - start) / 1000);
    gl.uniform1f(location("uScroll"), scroll / window.innerHeight);
    gl.uniform1f(location("uVelocity"), still ? 0 : velocity);
    gl.uniform2f(location("uTouch"), touch.x, touch.y);
    gl.uniform1f(location("uTouchStrength"), still ? 0 : touchStrength);
    shader.draw();
  };
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointerdown", onTouch);
    window.removeEventListener("pointermove", onTouch);
    window.removeEventListener("pointerup", onRelease);
    window.removeEventListener("pointercancel", onRelease);
    shader.dispose();
  };
};

export { mountLavaLamp };
