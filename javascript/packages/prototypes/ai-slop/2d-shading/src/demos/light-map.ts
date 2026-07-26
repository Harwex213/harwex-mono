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
import { QUAD_VERTEX, unitQuad } from "../lib/mesh";
import { HEIGHT, paintGround, paintOccluders, radialTexture, WIDTH } from "../lib/paint";
import { flatten, shadowHull, sunDirection } from "../lib/projection";
import { buildGrid, freeTile, mergeOccluders } from "../lib/scene";
import type { Teardown } from "./types";

const GLOW_SIZE = 256;

// Torches, in tiles. Fixed positions: the point of this demo is the compositor, so
// the lights themselves must not move around between runs.
const TORCHES: ReadonlyArray<{ tile: [number, number]; color: number; radius: number; power: number }> = [
  { tile: [6, 7], color: 0xffb057, radius: 150, power: 1 },
  { tile: [28, 5], color: 0xff8a4a, radius: 165, power: 0.95 },
  { tile: [12, 19], color: 0xffc879, radius: 140, power: 0.9 },
  { tile: [31, 19], color: 0xff7a5c, radius: 155, power: 1 },
  { tile: [20, 12], color: 0x86c8ff, radius: 190, power: 0.8 },
];


// The composite. Everything interesting about technique 5 is in these four lines:
// the buffer is an unbounded sum of light, and the screen is not — so exposure
// scales it and a tone curve folds the overflow back into 0..1 instead of clipping
// each channel separately (clipping shifts hue: a warm 1.4/1.1/0.7 clamps to white).
const FRAGMENT_COMPOSITE = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uLight;
uniform float uExposure;
uniform float uToneMap;
uniform float uGain;

void main() {
  vec3 l = texture(uLight, vUV).rgb * uExposure;
  vec3 clipped = min(l, vec3(1.0));
  vec3 mapped = vec3(1.0) - exp(-l);
  finalColor = vec4(mix(clipped, mapped, uToneMap) * uGain, 1.0);
}
`;

// Bloom: only the part of the sum that exceeded 1. Costs one extra additive pass
// over the same buffer and needs no threshold tuning — the buffer already knows
// where it blew out.
const FRAGMENT_BLOOM = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uLight;
uniform float uExposure;
uniform float uBloom;

void main() {
  vec3 l = texture(uLight, vUV).rgb * uExposure;
  finalColor = vec4(max(l - vec3(1.0), vec3(0.0)) * uBloom, 1.0);
}
`;

type Mode = "multiply" | "add" | "bloom";

type State = {
  scale: number;
  smooth: boolean;
  mode: Mode;
  exposure: number;
  tonemap: boolean;
  time: number;
  cycle: boolean;
  sunShadows: boolean;
  flicker: boolean;
  inspect: boolean;
};

type Torch = {
  sprite: Sprite;
  power: number;
  phase: number;
};

// One time-of-day value drives ambient, sun colour, sun height and shadow length.
// Keeping them in one function is the point: a light map is only convincing when
// the terms move together.
function sky(time: number): {
  sunHeight: number;
  sunIntensity: number;
  sunColor: number;
  ambientColor: number;
  ambientLevel: number;
  shadowLength: number;
  sunAngle: number;
} {
  const sunHeight = Math.sin((time - 0.25) * Math.PI * 2);
  const day = Math.max(0, sunHeight);
  const sunIntensity = Math.pow(day, 0.8);

  // Low sun is warm and red, high sun is nearly neutral.
  const warm = 1 - Math.min(1, day * 1.6);
  const sunR = 255;
  const sunG = Math.round(247 - 90 * warm);
  const sunB = Math.round(228 - 150 * warm);

  const ambientLevel = 0.1 + 0.42 * Math.max(0, Math.min(1, sunHeight + 0.25));
  const nightMix = 1 - day;
  const ambR = Math.round(255 - 120 * nightMix);
  const ambG = Math.round(252 - 80 * nightMix);
  const ambB = 255;

  return {
    sunHeight,
    sunIntensity,
    sunColor: (sunR << 16) | (sunG << 8) | sunB,
    ambientColor: (ambR << 16) | (ambG << 8) | ambB,
    ambientLevel,
    // Long shadows at dawn and dusk, short ones at noon.
    shadowLength: 24 + 90 * (1 - day),
    sunAngle: (time * 360 + 200) % 360,
  };
}

function scaleColor(color: number, level: number): number {
  const r = Math.round(((color >> 16) & 0xff) * level);
  const g = Math.round(((color >> 8) & 0xff) * level);
  const b = Math.round((color & 0xff) * level);
  return (r << 16) | (g << 8) | b;
}

async function mountLightMap(host: HTMLElement): Promise<Teardown> {
  const state: State = {
    scale: 2,
    smooth: true,
    mode: "multiply",
    exposure: 1.15,
    tonemap: true,
    time: 0.78,
    cycle: true,
    sunShadows: true,
    flicker: true,
    inspect: true,
  };

  const grid = buildGrid();
  const boxes = mergeOccluders(grid);

  const app = new Application();
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    antialias: true,
    background: 0x14161a,
    preference: "webgl",
  });

  const ground = new Graphics();
  paintGround(ground);
  const walls = new Graphics();
  paintOccluders(walls, boxes);

  // The buffer, in draw order. Ambient is opaque (an unlit texel must darken the
  // scene); the sun adds a flat term over it; shadows multiply that term down; the
  // point lights add on top and are never touched by the sun's shadows.
  const lightScene = new Container();
  const ambientGfx = new Graphics();
  const sunGfx = new Graphics();
  const shadowGfx = new Graphics();
  shadowGfx.blendMode = "multiply";
  const torchLayer = new Container();
  lightScene.addChild(ambientGfx, sunGfx, shadowGfx, torchLayer);

  const glow = radialTexture(GLOW_SIZE, "255, 255, 255");
  const torches: Torch[] = TORCHES.map((spec, i) => {
    const spot = freeTile(grid, spec.tile[0], spec.tile[1]);
    const sprite = new Sprite(glow);
    sprite.anchor.set(0.5);
    sprite.blendMode = "add";
    sprite.tint = spec.color;
    sprite.position.set(spot.x, spot.y);
    sprite.width = spec.radius * 2;
    sprite.height = spec.radius * 2;
    torchLayer.addChild(sprite);
    return { sprite, power: spec.power, phase: i * 1.7 };
  });

  // The pointer light is not in TORCHES: it carries no flicker and is cool, so it
  // stays readable against the warm ones while the buffer resolution changes.
  const cursorLight = new Sprite(glow);
  cursorLight.anchor.set(0.5);
  cursorLight.blendMode = "add";
  cursorLight.tint = 0x9fd8ff;
  cursorLight.width = 420;
  cursorLight.height = 420;
  cursorLight.position.set(WIDTH * 0.5, HEIGHT * 0.55);
  torchLayer.addChild(cursorLight);

  const quad = unitQuad();

  const compositeUniforms = new UniformGroup({
    uExposure: { value: state.exposure, type: "f32" },
    uToneMap: { value: 1, type: "f32" },
    uGain: { value: 1, type: "f32" },
  });
  const bloomUniforms = new UniformGroup({
    uExposure: { value: state.exposure, type: "f32" },
    uBloom: { value: 0.7, type: "f32" },
  });

  let buffer: RenderTexture | null = null;
  let composite: Mesh<Geometry, Shader> | null = null;
  let bloom: Mesh<Geometry, Shader> | null = null;
  const inspectSprite = new Sprite();
  inspectSprite.position.set(WIDTH - 252, HEIGHT - 176);
  inspectSprite.width = 240;
  inspectSprite.height = 156;

  const compositeLayer = new Container();
  app.stage.addChild(ground, walls, compositeLayer, inspectSprite);

  // The buffer is recreated rather than resized, and so are the two meshes that read
  // it: a shader's texture resource is bound at construction.
  function buildBuffer(): void {
    composite?.destroy();
    bloom?.destroy();
    buffer?.destroy(true);
    compositeLayer.removeChildren();

    buffer = RenderTexture.create({
      width: Math.round(WIDTH / state.scale),
      height: Math.round(HEIGHT / state.scale),
      resolution: 1,
    });

    composite = new Mesh({
      geometry: quad,
      shader: Shader.from({
        gl: { vertex: QUAD_VERTEX, fragment: FRAGMENT_COMPOSITE },
        resources: { uLight: buffer.source, compositeUniforms },
      }),
    });
    composite.scale.set(WIDTH, HEIGHT);

    bloom = new Mesh({
      geometry: quad,
      shader: Shader.from({
        gl: { vertex: QUAD_VERTEX, fragment: FRAGMENT_BLOOM },
        resources: { uLight: buffer.source, bloomUniforms },
      }),
    });
    bloom.scale.set(WIDTH, HEIGHT);
    bloom.blendMode = "add";

    compositeLayer.addChild(composite, bloom);
    inspectSprite.texture = buffer;
    inspectSprite.width = 240;
    inspectSprite.height = 156;
  }

  const readout = stats();
  let elapsed = 0;

  function rebuild(): void {
    const t0 = performance.now();
    const air = sky(state.time);

    // The whole buffer is authored in world coordinates and squeezed into the
    // smaller target by one scale on the root — the lights below never learn that
    // they are being rendered at a quarter resolution.
    lightScene.scale.set(1 / state.scale);

    ambientGfx.clear();
    ambientGfx.rect(0, 0, WIDTH, HEIGHT).fill(scaleColor(air.ambientColor, air.ambientLevel));

    sunGfx.clear();
    sunGfx.blendMode = "add";
    if (air.sunIntensity > 0) {
      sunGfx.rect(0, 0, WIDTH, HEIGHT).fill(scaleColor(air.sunColor, air.sunIntensity * 0.85));
    }

    shadowGfx.clear();
    const castShadows = state.sunShadows && air.sunIntensity > 0.02;
    if (castShadows) {
      const dir = sunDirection(air.sunAngle);
      // Opaque-black polygons in one pass would zero the ambient term too; the
      // alpha here is what keeps a sunlit shadow darker than the ambient floor but
      // not black.
      const alpha = 0.55 * Math.min(1, air.sunIntensity * 1.6);
      for (const box of boxes) {
        shadowGfx.poly(flatten(shadowHull(box, dir, air.shadowLength))).fill({
          color: 0x000000,
          alpha,
        });
      }
    }

    for (const torch of torches) {
      const flicker = state.flicker
        ? 0.88 + 0.09 * Math.sin(elapsed * 6.1 + torch.phase) + 0.05 * Math.sin(elapsed * 13.7 + torch.phase * 2)
        : 1;
      // Torches fade in as the sun goes down — otherwise the noon frame is a wall of
      // clipped white and the tone curve has nothing to say.
      const night = 1 - Math.max(0, Math.min(1, air.sunHeight * 2));
      torch.sprite.alpha = torch.power * flicker * (0.25 + 0.75 * night);
    }
    cursorLight.alpha = 0.55;

    if (buffer !== null && composite !== null && bloom !== null) {
      buffer.source.scaleMode = state.smooth ? "linear" : "nearest";
      app.renderer.render({ container: lightScene, target: buffer, clear: true });

      compositeUniforms.uniforms.uExposure = state.exposure;
      compositeUniforms.uniforms.uToneMap = state.tonemap ? 1 : 0;
      bloomUniforms.uniforms.uExposure = state.exposure;

      // The three modes differ only in how the same buffer reaches the screen.
      composite.blendMode = state.mode === "add" ? "add" : "multiply";
      compositeUniforms.uniforms.uGain = state.mode === "add" ? 0.8 : 1;
      bloom.visible = state.mode === "bloom";
    }

    inspectSprite.visible = state.inspect;

    const ms = performance.now() - t0;
    const texels = Math.round(WIDTH / state.scale) * Math.round(HEIGHT / state.scale);
    readout.set(
      [
        `буфер      ${Math.round(WIDTH / state.scale)}x${Math.round(HEIGHT / state.scale)} (1/${state.scale}) — ${((texels / (WIDTH * HEIGHT)) * 100).toFixed(0)}% текселей`,
        `в буфере   ambient + солнце ${air.sunIntensity.toFixed(2)}${castShadows ? " − тени" : ""} + ${torches.length + 1} источник${torches.length + 1 > 4 ? "ов" : "а"}`,
        `композит   ${state.mode === "add" ? "add поверх сцены" : state.mode === "bloom" ? "multiply + bloom" : "multiply"}${state.tonemap ? ", тонмап 1−e⁻ˣ" : ", клип"}`,
        `пассов     1 (буфер) + ${state.mode === "bloom" ? 2 : 1} (экран)`,
        `время      ${(state.time * 24).toFixed(1)} ч, солнце ${air.sunHeight > 0 ? "над" : "под"} горизонтом`,
        `CPU кадр   ${ms.toFixed(2)} ms`,
      ].join("\n"),
    );
  }

  buildBuffer();

  let dirty = true;
  function markDirty(): void {
    dirty = true;
  }

  const tick = (): void => {
    elapsed += app.ticker.deltaMS / 1000;
    if (state.cycle) {
      state.time = (state.time + app.ticker.deltaMS / 60000) % 1;
      timeInput.value = String(state.time);
      dirty = true;
    }
    if (state.flicker) {
      dirty = true;
    }
    if (!dirty) {
      return;
    }
    dirty = false;
    rebuild();
  };
  app.ticker.add(tick);

  const timeControl = slider({
    label: "Время суток",
    min: 0,
    max: 1,
    step: 0.001,
    value: state.time,
    format: (v) => {
      const hours = v * 24;
      const h = Math.floor(hours);
      const m = Math.floor((hours - h) * 60);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    },
    onInput: (v) => {
      state.time = v;
      state.cycle = false;
      cycleInput.checked = false;
      markDirty();
    },
  });
  const timeInput = timeControl.querySelector("input") as HTMLInputElement;

  const cycleBox = toggle("Прокручивать сутки", state.cycle, (v) => {
    state.cycle = v;
  });
  const cycleInput = cycleBox.querySelector("input") as HTMLInputElement;

  const onPointerMove = (event: PointerEvent): void => {
    const rect = app.canvas.getBoundingClientRect();
    cursorLight.position.set(
      ((event.clientX - rect.left) / rect.width) * WIDTH,
      ((event.clientY - rect.top) / rect.height) * HEIGHT,
    );
    markDirty();
  };
  app.canvas.addEventListener("pointermove", onPointerMove);

  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.append(
    group("Буфер", [
      radio(
        [
          { value: "1", label: "1/1 — 960×624" },
          { value: "2", label: "1/2 — 480×312" },
          { value: "4", label: "1/4 — 240×156" },
          { value: "8", label: "1/8 — 120×78" },
        ],
        String(state.scale),
        (v) => {
          state.scale = Number(v);
          buildBuffer();
          markDirty();
        },
      ),
      toggle("Билинейный апскейл", state.smooth, (v) => {
        state.smooth = v;
        markDirty();
      }),
      toggle("Показать сам буфер", state.inspect, (v) => {
        state.inspect = v;
        markDirty();
      }),
      readout.el,
    ]),
    group("Композит", [
      radio(
        [
          { value: "multiply", label: "multiply (верно)" },
          { value: "add", label: "add поверх сцены (наивно)" },
          { value: "bloom", label: "multiply + bloom" },
        ],
        state.mode,
        (v) => {
          state.mode = v as Mode;
          markDirty();
        },
      ),
      toggle("Тонмап 1−e⁻ˣ вместо клипа", state.tonemap, (v) => {
        state.tonemap = v;
        markDirty();
      }),
      slider({
        label: "Экспозиция",
        min: 0.3,
        max: 3,
        step: 0.05,
        value: state.exposure,
        format: (v) => v.toFixed(2),
        onInput: (v) => {
          state.exposure = v;
          markDirty();
        },
      }),
    ]),
    group("Сцена", [
      timeControl,
      cycleBox,
      toggle("Тени солнца в буфер", state.sunShadows, (v) => {
        state.sunShadows = v;
        markDirty();
      }),
      toggle("Мерцание факелов", state.flicker, (v) => {
        state.flicker = v;
        markDirty();
      }),
    ]),
  );

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Курсор двигает холодный источник. Справа внизу — содержимое лайтмапа.";

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
    buffer?.destroy(true);
    app.destroy(true, { children: true });
    glow.destroy(true);
    quad.destroy();
  };
}

export { mountLightMap };
