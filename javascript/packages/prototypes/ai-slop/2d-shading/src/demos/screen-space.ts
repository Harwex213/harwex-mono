import {
  Application,
  BlurFilter,
  Container,
  type Geometry,
  Graphics,
  Mesh,
  RenderTexture,
  type Shader,
  Shader as ShaderClass,
  Sprite,
  UniformGroup,
} from "pixi.js";
import { group, radio, slider, stats, toggle } from "../lib/controls";
import {
  buildHeightfield,
  heightTexture,
  HF_H,
  HF_W,
  H_MAX,
  terrainTexture,
} from "../lib/heightfield";
import { QUAD_VERTEX, unitQuad } from "../lib/mesh";
import { HEIGHT, paintOccluders, WIDTH } from "../lib/paint";
import { sunDirection } from "../lib/projection";
import { buildGrid, mergeOccluders, type Occluder } from "../lib/scene";
import type { Teardown } from "./types";

const MAX_STEPS = 64;

// Relief shadows: for each screen pixel, walk towards the sun over the height field
// and ask whether anything pokes above the ray. No occluder list, no polygons, no
// visibility structure — the cost is uSteps texture samples per pixel and nothing
// else. What it cannot do is shadow from something outside the buffer.
const FRAGMENT_RELIEF = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uHeight;
uniform vec2 uPxToUv;
uniform vec2 uDir;
uniform float uSteps;
uniform float uStepPx;
uniform float uSlope;
uniform float uStrength;
uniform float uSoft;

void main() {
  float h0 = texture(uHeight, vUV).r;

  float occ = 0.0;
  for (int i = 1; i <= ${MAX_STEPS}; i++) {
    if (float(i) > uSteps) {
      break;
    }
    float dist = float(i) * uStepPx;
    // The ray leaves this pixel at the local height and climbs towards the sun;
    // whatever rises above it between here and there is what casts the shadow.
    float ray = h0 + dist * uSlope;
    float h = texture(uHeight, vUV + uDir * dist * uPxToUv).r;
    occ = max(occ, h - ray);
  }

  float s = uStrength * smoothstep(0.0, uSoft, occ);
  finalColor = vec4(mix(vec3(1.0), vec3(0.42, 0.5, 0.78), s), 1.0);
}
`;

type Mode = "relief" | "contact" | "both";

type State = {
  mode: Mode;
  angleDeg: number;
  elevationDeg: number;
  steps: number;
  stepPx: number;
  strength: number;
  soft: number;
  blur: number;
  offset: number;
  contact: number;
  spin: boolean;
  inspect: boolean;
};

function paintSilhouettes(g: Graphics, boxes: Occluder[]): void {
  for (const box of boxes) {
    g.rect(box.x, box.y, box.w, box.h).fill(0xffffff);
  }
}

async function mountScreenSpace(host: HTMLElement): Promise<Teardown> {
  const state: State = {
    mode: "relief",
    angleDeg: 40,
    elevationDeg: 26,
    steps: 32,
    stepPx: 3,
    strength: 0.72,
    soft: 0.02,
    blur: 3,
    offset: 11,
    contact: 0.85,
    spin: true,
    inspect: true,
  };

  const grid = buildGrid();
  const boxes = mergeOccluders(grid);
  const field = buildHeightfield(boxes);

  const app = new Application();
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    antialias: true,
    background: 0x14161a,
    preference: "webgl",
  });

  const terrain = terrainTexture(field);
  const heights = heightTexture(field);
  const ground = new Sprite(terrain);
  ground.width = WIDTH;
  ground.height = HEIGHT;

  const walls = new Graphics();
  paintOccluders(walls, boxes);

  // The cheap half: silhouettes, blurred, laid back down offset along the sun. It
  // knows nothing about height or distance, so it is a contact shadow and no more —
  // but it costs one blur and one sprite regardless of how many casters there are.
  const contactScene = new Container();
  const silhouette = new Graphics();
  paintSilhouettes(silhouette, boxes);
  // The mask is built at half resolution, so a blur radius set here is worth twice
  // as much on screen — a wide one eats a 24 px pillar's shadow entirely.
  const blur = new BlurFilter({ strength: state.blur, quality: 3 });
  silhouette.filters = [blur];
  contactScene.addChild(silhouette);
  contactScene.scale.set(0.5);

  const contactTexture = RenderTexture.create({
    width: Math.round(WIDTH / 2),
    height: Math.round(HEIGHT / 2),
  });
  const contactSprite = new Sprite(contactTexture);
  contactSprite.width = WIDTH;
  contactSprite.height = HEIGHT;
  contactSprite.tint = 0x000000;
  contactSprite.blendMode = "multiply";

  const quad = unitQuad();
  const reliefUniforms = new UniformGroup({
    uPxToUv: { value: new Float32Array([1 / WIDTH, 1 / HEIGHT]), type: "vec2<f32>" },
    uDir: { value: new Float32Array([1, 0]), type: "vec2<f32>" },
    uSteps: { value: state.steps, type: "f32" },
    uStepPx: { value: state.stepPx, type: "f32" },
    uSlope: { value: 0, type: "f32" },
    uStrength: { value: state.strength, type: "f32" },
    uSoft: { value: state.soft, type: "f32" },
  });
  const relief: Mesh<Geometry, Shader> = new Mesh({
    geometry: quad,
    shader: ShaderClass.from({
      gl: { vertex: QUAD_VERTEX, fragment: FRAGMENT_RELIEF },
      resources: { uHeight: heights.source, reliefUniforms },
    }),
  });
  relief.scale.set(WIDTH, HEIGHT);
  relief.blendMode = "multiply";

  const inspect = new Sprite(heights);
  inspect.position.set(WIDTH - 252, HEIGHT - 176);
  inspect.width = 240;
  inspect.height = 156;

  app.stage.addChild(ground, contactSprite, walls, relief, inspect);

  const readout = stats();
  let contactDirty = true;
  let dirty = true;

  function rebuild(): void {
    const t0 = performance.now();
    const shadowDir = sunDirection(state.angleDeg);
    const len = Math.hypot(shadowDir.x, shadowDir.y) || 1;
    // The march runs towards the sun; sunDirection returns where shadows fall.
    const dir = { x: -shadowDir.x / len, y: -shadowDir.y / len };

    const showRelief = state.mode !== "contact";
    const showContact = state.mode !== "relief";

    relief.visible = showRelief;
    if (showRelief) {
      const uniforms = reliefUniforms.uniforms;
      (uniforms.uDir as Float32Array).set([dir.x, dir.y]);
      uniforms.uSteps = state.steps;
      uniforms.uStepPx = state.stepPx;
      // tan(elevation) is a world rise per world pixel; the field stores height as a
      // fraction of H_MAX, so the slope has to be converted into the same unit.
      uniforms.uSlope = Math.tan((state.elevationDeg * Math.PI) / 180) / H_MAX;
      uniforms.uStrength = state.strength;
      uniforms.uSoft = state.soft;
    }

    contactSprite.visible = showContact;
    if (showContact) {
      if (contactDirty) {
        blur.strength = state.blur;
        app.renderer.render({ container: contactScene, target: contactTexture, clear: true });
        contactDirty = false;
      }
      contactSprite.alpha = state.contact;
      contactSprite.position.set(shadowDir.x * state.offset, shadowDir.y * state.offset);
    }

    // The inspector shows whichever buffer the current mode actually reads.
    inspect.texture = state.mode === "contact" ? contactTexture : heights;
    inspect.width = 240;
    inspect.height = 156;
    inspect.visible = state.inspect;

    const reach = state.steps * state.stepPx;
    const ms = performance.now() - t0;
    readout.set(
      [
        `режим       ${state.mode === "relief" ? "марш по height-map" : state.mode === "contact" ? "прижатая маска" : "марш + маска"}`,
        `поле высот  ${HF_W}x${HF_H}, R8, 1.0 = ${H_MAX} px`,
        `марш        ${state.steps} x ${state.stepPx} px = ${reach} px досягаемости`,
        `выборок/px  ${showRelief ? state.steps : 0}`,
        `геометрия   не участвует (${boxes.length} боксов запечены в поле)`,
        `CPU кадр    ${ms.toFixed(2)} ms`,
      ].join("\n"),
    );
  }

  function markDirty(): void {
    dirty = true;
  }

  const tick = (): void => {
    if (state.spin) {
      state.angleDeg = (state.angleDeg + app.ticker.deltaMS * 0.012) % 360;
      dirty = true;
    }
    if (!dirty) {
      return;
    }
    dirty = false;
    rebuild();
  };
  app.ticker.add(tick);

  const spinBox = toggle("Вращать солнце", state.spin, (v) => {
    state.spin = v;
  });
  const spinInput = spinBox.querySelector("input") as HTMLInputElement;

  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.append(
    group("Техника", [
      radio(
        [
          { value: "relief", label: "Марш по height-map" },
          { value: "contact", label: "Прижатая маска (blur)" },
          { value: "both", label: "Оба слоя" },
        ],
        state.mode,
        (v) => {
          state.mode = v as Mode;
          markDirty();
        },
      ),
      toggle("Показать поле высот", state.inspect, (v) => {
        state.inspect = v;
        markDirty();
      }),
      readout.el,
    ]),
    group("Солнце", [
      slider({
        label: "Азимут",
        min: 0,
        max: 359,
        step: 1,
        value: state.angleDeg,
        format: (v) => `${v.toFixed(0)}°`,
        onInput: (v) => {
          state.angleDeg = v;
          state.spin = false;
          spinInput.checked = false;
          markDirty();
        },
      }),
      spinBox,
      slider({
        label: "Высота над горизонтом",
        min: 5,
        max: 75,
        step: 1,
        value: state.elevationDeg,
        format: (v) => `${v.toFixed(0)}°`,
        onInput: (v) => {
          state.elevationDeg = v;
          markDirty();
        },
      }),
    ]),
    group("Марш", [
      slider({
        label: "Шагов",
        min: 4,
        max: MAX_STEPS,
        step: 2,
        value: state.steps,
        format: (v) => v.toFixed(0),
        onInput: (v) => {
          state.steps = v;
          markDirty();
        },
      }),
      slider({
        label: "Длина шага",
        min: 1,
        max: 8,
        step: 0.5,
        value: state.stepPx,
        format: (v) => `${v.toFixed(1)} px`,
        onInput: (v) => {
          state.stepPx = v;
          markDirty();
        },
      }),
      slider({
        label: "Плотность",
        min: 0,
        max: 1,
        step: 0.01,
        value: state.strength,
        format: (v) => v.toFixed(2),
        onInput: (v) => {
          state.strength = v;
          markDirty();
        },
      }),
      slider({
        label: "Мягкость перехода",
        min: 0.002,
        max: 0.1,
        step: 0.002,
        value: state.soft,
        format: (v) => `${(v * H_MAX).toFixed(1)} px высоты`,
        onInput: (v) => {
          state.soft = v;
          markDirty();
        },
      }),
    ]),
    group("Прижатая маска", [
      slider({
        label: "Размытие",
        min: 0,
        max: 16,
        step: 1,
        value: state.blur,
        format: (v) => `${v.toFixed(0)} px`,
        onInput: (v) => {
          state.blur = v;
          contactDirty = true;
          markDirty();
        },
      }),
      slider({
        label: "Смещение по солнцу",
        min: 0,
        max: 32,
        step: 1,
        value: state.offset,
        format: (v) => `${v.toFixed(0)} px`,
        onInput: (v) => {
          state.offset = v;
          markDirty();
        },
      }),
      slider({
        label: "Плотность маски",
        min: 0,
        max: 1,
        step: 0.01,
        value: state.contact,
        format: (v) => v.toFixed(2),
        onInput: (v) => {
          state.contact = v;
          markDirty();
        },
      }),
    ]),
  );

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Рельеф земли и стены лежат в одном поле высот; справа внизу — оно само. Тень не может прийти из-за края буфера.";

  const stage = document.createElement("div");
  stage.className = "stage";
  stage.append(app.canvas, hint);

  const wrap = document.createElement("div");
  wrap.className = "demo";
  wrap.append(stage, panel);
  host.append(wrap);

  return () => {
    app.ticker.remove(tick);
    app.destroy(true, { children: true });
    contactTexture.destroy(true);
    heights.destroy(true);
    terrain.destroy(true);
    blur.destroy();
    quad.destroy();
  };
}

export { mountScreenSpace };
