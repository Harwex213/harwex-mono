import {
  Application,
  Container,
  Geometry,
  Graphics,
  Mesh,
  RenderTexture,
  Shader,
  Sprite,
  UniformGroup,
} from "pixi.js";
import { group, radio, slider, stats, toggle } from "../lib/controls";
import { LightMap } from "../lib/lightmap";
import { HEIGHT, paintGround, paintOccluders, WIDTH } from "../lib/paint";
import { buildGrid, freeTile, mergeOccluders, type Occluder } from "../lib/scene";
import type { Teardown } from "./types";

// The occluder map is a square snapshot of the light's own bounding box, so its
// resolution is a sampling rate in world pixels, not a scene resolution: at 256 for
// a 420px-wide box a texel is ~1.6px, which is where the technique's inaccuracy
// comes from (compare with the exact polygon of technique 3).
const OCC_RES = 256;

// Steps along one ray through the occluder map. Fewer steps let thin walls leak.
const MARCH_STEPS = 192;

// Angular taps of the PCF loop; the loop is bounded by a constant because GLSL ES
// wants a compile-time bound.
const MAX_TAPS = 9;

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

// Pass 2 — the reduction. One texel per angular slice: march the ray from the light
// outwards through the occluder map and store the first hit as a normalised
// distance. This is the whole "1D shadow map": a 1 x N texture that answers "how far
// can light travel at angle θ".
const FRAGMENT_DISTANCE = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uOcc;
uniform float uSteps;

const float TWO_PI = 6.28318530718;

void main() {
  float theta = vUV.x * TWO_PI;
  vec2 dir = vec2(cos(theta), sin(theta));

  float hit = 1.0;
  int steps = int(uSteps);
  for (int i = 0; i < 512; i++) {
    if (i >= steps) {
      break;
    }
    float t = (float(i) + 0.5) / float(steps);
    // The light sits at the centre of the occluder map and its radius is half the
    // map, so the ray parameter and the stored distance share one unit: 0..1.
    vec2 uv = vec2(0.5) + dir * t * 0.5;
    if (texture(uOcc, uv).a > 0.5) {
      hit = t;
      break;
    }
  }

  finalColor = vec4(hit, hit, hit, 1.0);
}
`;

// Pass 3 — the light. Per fragment: polar coordinates around the light, one lookup
// into the 1D map, compare. Cost is independent of how many occluders exist; the
// PCF taps spread over neighbouring angles, and widening them with distance is what
// makes the penumbra grow away from the caster.
const FRAGMENT_LIGHT = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uDist;
uniform vec3 uColor;
uniform float uSoftness;
uniform float uTaps;
uniform float uBias;
uniform float uIntensity;

const float TWO_PI = 6.28318530718;

void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) {
    discard;
  }

  float u = atan(p.y, p.x) / TWO_PI;
  float taps = max(1.0, uTaps);

  float lit = 0.0;
  for (int i = 0; i < ${MAX_TAPS}; i++) {
    if (float(i) >= taps) {
      break;
    }
    float offset = (float(i) - (taps - 1.0) * 0.5) * uSoftness * (0.35 + r);
    float d = texture(uDist, vec2(fract(u + offset), 0.5)).r;
    lit += step(r, d + uBias);
  }
  lit /= taps;

  // Falloff is deliberately shallow. Squared distance is the physical answer and
  // the wrong one here: the shadowed region starts where the nearest occluder is,
  // which on this map is past the halfway point of the radius — under an inverse
  // square the whole effect would sit in the part of the disc that is already black.
  float falloff = pow(1.0 - r, 1.5) * uIntensity;
  finalColor = vec4(uColor * lit * falloff, 1.0);
}
`;

type State = {
  resolution: number;
  radius: number;
  ambient: number;
  taps: number;
  softness: number;
  intensity: number;
  bias: number;
  extra: boolean;
  orbit: boolean;
  debug: boolean;
};

type Light = {
  x: number;
  y: number;
  // 1 x N distance map, rebuilt when the resolution changes.
  dist: RenderTexture;
  uniforms: UniformGroup;
  // Not the default Mesh<MeshGeometry, TextureShader>: both passes run a hand-written
  // program over a bare quad.
  mesh: Mesh<Geometry, Shader>;
};

function unitQuad(): Geometry {
  return new Geometry({
    attributes: {
      aPosition: [0, 0, 1, 0, 1, 1, 0, 1],
      aUV: [0, 0, 1, 0, 1, 1, 0, 1],
    },
    indexBuffer: [0, 1, 2, 0, 2, 3],
  });
}

// White silhouettes on transparent: the march tests alpha, so what matters is
// coverage, not colour.
function paintSilhouettes(g: Graphics, boxes: Occluder[]): void {
  for (const box of boxes) {
    g.rect(box.x, box.y, box.w, box.h).fill(0xffffff);
  }
}

async function mountShadowMap1D(host: HTMLElement): Promise<Teardown> {
  const state: State = {
    resolution: 256,
    radius: 210,
    ambient: 0.24,
    taps: 5,
    softness: 1.6,
    intensity: 1.7,
    bias: 0.02,
    extra: false,
    orbit: true,
    debug: true,
  };

  const grid = buildGrid();
  const boxes = mergeOccluders(grid);

  const app = new Application();
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    antialias: true,
    background: 0x14161a,
    // Every shader here is GLSL; asking for WebGPU would mean maintaining a second
    // WGSL copy of both passes for nothing.
    preference: "webgl",
  });

  const quad = unitQuad();

  const ground = new Graphics();
  paintGround(ground);
  const walls = new Graphics();
  paintOccluders(walls, boxes);

  // Pass 1 — occluders, redrawn per light into one shared buffer: it is consumed by
  // pass 2 immediately, so a second copy would never be read.
  const occTexture = RenderTexture.create({ width: OCC_RES, height: OCC_RES });
  const occRoot = new Container();
  const occGfx = new Graphics();
  paintSilhouettes(occGfx, boxes);
  occRoot.addChild(occGfx);

  const distUniforms = new UniformGroup({
    uSteps: { value: MARCH_STEPS, type: "f32" },
  });
  const distMesh = new Mesh({
    geometry: quad,
    shader: Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT_DISTANCE },
      resources: {
        uOcc: occTexture.source,
        distUniforms,
      },
    }),
  });

  const lightMap = new LightMap(app.renderer.resolution);

  const spotA = freeTile(grid, 19, 11);
  const spotB = freeTile(grid, 30, 21);
  const seeds = [
    { x: WIDTH / 2, y: HEIGHT / 2 },
    spotA,
    spotB,
  ];

  let lights: Light[] = [];

  function createLight(x: number, y: number): Light {
    const dist = RenderTexture.create({
      width: state.resolution,
      height: 1,
      scaleMode: "linear",
    });
    // Angles wrap, so the map has to wrap too — otherwise the PCF taps clamp at
    // θ = ±π and leave a seam pointing left.
    dist.source.addressMode = "repeat";

    const uniforms = new UniformGroup({
      uColor: { value: new Float32Array([1, 0.9, 0.72]), type: "vec3<f32>" },
      uSoftness: { value: 0, type: "f32" },
      uTaps: { value: state.taps, type: "f32" },
      uBias: { value: state.bias, type: "f32" },
      uIntensity: { value: state.intensity, type: "f32" },
    });

    const mesh = new Mesh({
      geometry: quad,
      shader: Shader.from({
        gl: { vertex: VERTEX, fragment: FRAGMENT_LIGHT },
        resources: {
          uDist: dist.source,
          lightUniforms: uniforms,
        },
      }),
    });
    mesh.blendMode = "add";

    return { x, y, dist, uniforms, mesh };
  }

  const debugLayer = new Container();
  const stripSprite = new Sprite();
  stripSprite.position.set(12, HEIGHT - 30);
  stripSprite.width = 480;
  stripSprite.height = 18;
  const occSprite = new Sprite(occTexture);
  occSprite.position.set(WIDTH - 140, HEIGHT - 152);
  occSprite.width = 128;
  occSprite.height = 128;
  occSprite.alpha = 0.85;
  debugLayer.addChild(occSprite, stripSprite);

  // The distance maps are recreated rather than resized: a RenderTexture's size is
  // baked into the shader resource binding, and swapping the binding is the same
  // amount of work as a new light.
  function buildLights(): void {
    for (const light of lights) {
      light.mesh.destroy();
      light.dist.destroy(true);
    }
    lightMap.clearLights();
    lights = seeds.map((seed, i) => {
      const previous = lights[i];
      return createLight(previous?.x ?? seed.x, previous?.y ?? seed.y);
    });
    for (const light of lights) {
      lightMap.add(light.mesh);
    }
    stripSprite.texture = lights[0].dist;
    stripSprite.texture.source.scaleMode = "nearest";
    stripSprite.width = 480;
    stripSprite.height = 18;
  }

  app.stage.addChild(ground, walls, lightMap.sprite, debugLayer);

  const readout = stats();
  let dirty = true;
  let elapsed = 0;

  function rebuild(): void {
    const t0 = performance.now();
    const active = state.extra ? lights : lights.slice(0, 1);
    const radius = state.radius;

    lightMap.setAmbient(state.ambient);
    debugLayer.visible = state.debug;

    for (const light of lights) {
      light.mesh.visible = active.includes(light);
      if (!light.mesh.visible) {
        continue;
      }

      // Pass 1: the light's box, scaled into the occluder map.
      const scale = OCC_RES / (2 * radius);
      occRoot.scale.set(scale);
      occRoot.position.set(-(light.x - radius) * scale, -(light.y - radius) * scale);
      app.renderer.render({ container: occRoot, target: occTexture, clear: true });

      // Pass 2: reduce to 1 x N.
      distMesh.scale.set(state.resolution, 1);
      app.renderer.render({ container: distMesh, target: light.dist, clear: true });

      // Pass 3 happens with the light map; here we only place the quad and push the
      // knobs. Softness is expressed in slices so it means the same thing at every
      // resolution.
      light.uniforms.uniforms.uSoftness = state.taps > 1 ? state.softness / state.resolution : 0;
      light.uniforms.uniforms.uTaps = state.taps;
      light.uniforms.uniforms.uBias = state.bias;
      light.uniforms.uniforms.uIntensity = state.intensity;
      light.mesh.position.set(light.x - radius, light.y - radius);
      light.mesh.scale.set(radius * 2);
    }

    lightMap.render(app.renderer);

    const ms = performance.now() - t0;
    readout.set(
      [
        `карта       ${state.resolution} x 1 (R8 → ${(state.radius / 256).toFixed(2)} px/квант)`,
        `окклюдер    ${OCC_RES}², марш ${MARCH_STEPS} шагов`,
        `источники   ${active.length}, пассов ${active.length * 2 + 1}`,
        `PCF         ${state.taps} tap${state.taps > 1 ? "s" : ""}`,
        `боксов      ${boxes.length} (на стоимость не влияют)`,
        `CPU кадр    ${ms.toFixed(2)} ms`,
      ].join("\n"),
    );
  }

  function markDirty(): void {
    dirty = true;
  }

  buildLights();

  const tick = (): void => {
    if (state.orbit) {
      elapsed += app.ticker.deltaMS / 1000;
      lights[0].x = WIDTH * 0.5 + Math.cos(elapsed * 0.45) * WIDTH * 0.3;
      lights[0].y = HEIGHT * 0.5 + Math.sin(elapsed * 0.63) * HEIGHT * 0.32;
      dirty = true;
    }
    if (!dirty) {
      return;
    }
    dirty = false;
    rebuild();
  };
  app.ticker.add(tick);

  const orbitBox = toggle("Возить источник по кругу", state.orbit, (v) => {
    state.orbit = v;
  });
  const orbitInput = orbitBox.querySelector("input") as HTMLInputElement;

  const onPointerMove = (event: PointerEvent): void => {
    const rect = app.canvas.getBoundingClientRect();
    lights[0].x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    lights[0].y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    state.orbit = false;
    orbitInput.checked = false;
    markDirty();
  };
  app.canvas.addEventListener("pointermove", onPointerMove);

  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.append(
    group("Карта теней", [
      radio(
        [
          { value: "64", label: "64 слайса" },
          { value: "128", label: "128 слайсов" },
          { value: "256", label: "256 слайсов" },
          { value: "512", label: "512 слайсов" },
        ],
        String(state.resolution),
        (v) => {
          state.resolution = Number(v);
          buildLights();
          markDirty();
        },
      ),
      slider({
        label: "PCF taps",
        min: 1,
        max: MAX_TAPS,
        step: 2,
        value: state.taps,
        format: (v) => `${v.toFixed(0)}`,
        onInput: (v) => {
          state.taps = v;
          markDirty();
        },
      }),
      slider({
        label: "Мягкость (слайсов на tap)",
        min: 0,
        max: 8,
        step: 0.1,
        value: state.softness,
        format: (v) => v.toFixed(1),
        onInput: (v) => {
          state.softness = v;
          markDirty();
        },
      }),
      slider({
        label: "Яркость",
        min: 0.5,
        max: 3,
        step: 0.05,
        value: state.intensity,
        format: (v) => v.toFixed(2),
        onInput: (v) => {
          state.intensity = v;
          markDirty();
        },
      }),
      slider({
        label: "Bias",
        min: 0,
        max: 0.08,
        step: 0.002,
        value: state.bias,
        format: (v) => `${(v * state.radius).toFixed(1)} px`,
        onInput: (v) => {
          state.bias = v;
          markDirty();
        },
      }),
      toggle("Показать обе карты", state.debug, (v) => {
        state.debug = v;
        markDirty();
      }),
      readout.el,
    ]),
    group("Источник", [
      orbitBox,
      toggle("Три источника", state.extra, (v) => {
        state.extra = v;
        markDirty();
      }),
      slider({
        label: "Радиус",
        min: 60,
        max: 420,
        step: 5,
        value: state.radius,
        format: (v) => `${v.toFixed(0)} px`,
        onInput: (v) => {
          state.radius = v;
          markDirty();
        },
      }),
      slider({
        label: "Ambient",
        min: 0,
        max: 1,
        step: 0.01,
        value: state.ambient,
        format: (v) => v.toFixed(2),
        onInput: (v) => {
          state.ambient = v;
          markDirty();
        },
      }),
    ]),
  );

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Курсор двигает первый источник. Внизу — 1D карта расстояний, справа — окклюдер-буфер последнего источника.";

  const stage = document.createElement("div");
  stage.className = "stage";
  stage.append(app.canvas, hint);

  const wrap = document.createElement("div");
  wrap.className = "demo";
  wrap.append(stage, panel);
  host.append(wrap);

  return () => {
    app.canvas.removeEventListener("pointermove", onPointerMove);
    app.ticker.remove(tick);
    for (const light of lights) {
      light.dist.destroy(true);
    }
    app.destroy(true, { children: true });
    lightMap.destroy();
    occTexture.destroy(true);
    quad.destroy();
  };
}

export { mountShadowMap1D };
