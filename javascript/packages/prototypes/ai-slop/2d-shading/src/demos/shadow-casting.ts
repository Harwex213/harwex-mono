import { Application, Graphics, Sprite, Texture } from "pixi.js";
import { group, radio, slider, stats, toggle } from "../lib/controls";
import { computeFov } from "../lib/fov";
import { LightMap } from "../lib/lightmap";
import { HEIGHT, paintGround, paintOccluders, radialTexture, WIDTH } from "../lib/paint";
import {
  buildGrid,
  freeTile,
  MAP_H,
  MAP_W,
  mergeOccluders,
  occluderSegments,
  type Segment,
  TILE,
  tileSegments,
} from "../lib/scene";
import { visibilityPolygon } from "../lib/visibility";
import type { Teardown } from "./types";

// The radial falloff is sampled, not computed per light, so one texture serves all
// radii — the sprite is just scaled.
const GLOW_SIZE = 256;

type Mode = "polygon" | "fov";

type State = {
  mode: Mode;
  radius: number;
  ambient: number;
  merge: boolean;
  smooth: boolean;
  debug: boolean;
  extra: boolean;
  orbit: boolean;
};

// Everything one light owns in both modes. Both sets exist at all times and the
// mode flips visibility: rebuilding the pixi objects on every mode switch would be
// the only thing in this demo that allocates per frame.
type Light = {
  x: number;
  y: number;
  // Visibility polygon, used as the glow's mask.
  mask: Graphics;
  glow: Sprite;
  // Grid-sized FOV buffer; upscaled by the sprite, so linear filtering is what
  // turns per-tile visibility into a soft edge for free.
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  texture: Texture;
  fovSprite: Sprite;
};

function createLight(glowTexture: Texture): Light {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("2d context unavailable");
  }

  const texture = Texture.from(canvas);
  const fovSprite = new Sprite(texture);
  fovSprite.width = WIDTH;
  fovSprite.height = HEIGHT;
  fovSprite.blendMode = "add";

  const glow = new Sprite(glowTexture);
  glow.anchor.set(0.5);
  glow.blendMode = "add";

  const mask = new Graphics();
  glow.mask = mask;

  return {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    mask,
    glow,
    canvas,
    ctx,
    image: ctx.createImageData(MAP_W, MAP_H),
    texture,
    fovSprite,
  };
}

function writeFov(light: Light, values: Float32Array): void {
  const data = light.image.data;
  for (let i = 0; i < values.length; i += 1) {
    const l = values[i];
    const o = i * 4;
    // Brightness lives in RGB with alpha pinned at 255: the sprite blends additive,
    // so a black texel adds nothing and the alpha channel never enters the
    // premultiplication question at all.
    data[o] = 255 * l;
    data[o + 1] = 232 * l;
    data[o + 2] = 190 * l;
    data[o + 3] = 255;
  }
  light.ctx.putImageData(light.image, 0, 0);
}

function paintSegments(g: Graphics, segments: Segment[]): void {
  for (const s of segments) {
    g.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
  }
  g.stroke({ width: 1, color: 0x63d0ff, alpha: 0.55 });
}

async function mountShadowCasting(host: HTMLElement): Promise<Teardown> {
  const state: State = {
    mode: "polygon",
    radius: 210,
    ambient: 0.24,
    merge: true,
    smooth: true,
    debug: false,
    extra: false,
    orbit: true,
  };

  const grid = buildGrid();
  const boxes = mergeOccluders(grid);
  const mergedSegments = occluderSegments(grid);
  const rawSegments = tileSegments(grid);

  const app = new Application();
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    antialias: true,
    background: 0x14161a,
  });

  const ground = new Graphics();
  paintGround(ground);
  const walls = new Graphics();
  paintOccluders(walls, boxes);

  // Same compositor as technique 5; the only thing this demo owns is where the lit
  // region comes from.
  const lightMap = new LightMap(app.renderer.resolution);

  const glowTexture = radialTexture(GLOW_SIZE);
  const lights: Light[] = [createLight(glowTexture), createLight(glowTexture), createLight(glowTexture)];
  const spotA = freeTile(grid, 19, 11);
  const spotB = freeTile(grid, 30, 21);
  lights[1].x = spotA.x;
  lights[1].y = spotA.y;
  lights[2].x = spotB.x;
  lights[2].y = spotB.y;
  for (const light of lights) {
    lightMap.add(light.mask, light.glow, light.fovSprite);
  }

  const overlay = new Graphics();
  app.stage.addChild(ground, walls, lightMap.sprite, overlay);

  const readout = stats();
  let dirty = true;
  let elapsed = 0;

  function rebuild(): void {
    const t0 = performance.now();
    const segments = state.merge ? mergedSegments : rawSegments;
    const active = state.extra ? lights : lights.slice(0, 1);

    overlay.clear();
    lightMap.setAmbient(state.ambient);

    let rays = 0;
    let tested = 0;
    let visited = 0;

    for (const light of lights) {
      const on = active.includes(light);
      light.glow.visible = on && state.mode === "polygon";
      light.fovSprite.visible = on && state.mode === "fov";
      if (!on) {
        continue;
      }

      if (state.mode === "polygon") {
        const vis = visibilityPolygon(light.x, light.y, state.radius, segments);
        rays += vis.rays;
        tested += vis.rays * vis.tested;

        const flat: number[] = [];
        for (const p of vis.points) {
          flat.push(p.x, p.y);
        }
        light.mask.clear();
        light.mask.poly(flat).fill(0xffffff);

        light.glow.position.set(light.x, light.y);
        light.glow.width = state.radius * 2;
        light.glow.height = state.radius * 2;

        if (state.debug) {
          for (const p of vis.points) {
            overlay.moveTo(light.x, light.y).lineTo(p.x, p.y);
          }
          overlay.stroke({ width: 1, color: 0xffd479, alpha: 0.12 });
          overlay.poly(flat).stroke({ width: 1, color: 0xffd479, alpha: 0.7 });
        }
      } else {
        const fov = computeFov(
          grid,
          Math.floor(light.x / TILE),
          Math.floor(light.y / TILE),
          state.radius / TILE,
        );
        visited += fov.visited;
        writeFov(light, fov.light);
        light.texture.source.scaleMode = state.smooth ? "linear" : "nearest";
        light.texture.source.update();
      }
    }

    if (state.debug) {
      paintSegments(overlay, segments);
    }

    lightMap.render(app.renderer);

    const ms = performance.now() - t0;
    readout.set(
      state.mode === "polygon"
        ? [
            `алгоритм    полигон видимости`,
            `сегменты    ${segments.length}${state.merge ? ` (из ${rawSegments.length} потайловых)` : ""}`,
            `лучи        ${rays} (3 на вершину)`,
            `пересечения ${tested}`,
            `кадр        ${ms.toFixed(2)} ms`,
          ].join("\n")
        : [
            `алгоритм    recursive shadowcasting`,
            `источников  ${active.length}`,
            `тайлов      ${visited} (из ${MAP_W * MAP_H})`,
            `буфер       ${MAP_W}x${MAP_H}, апскейл ${state.smooth ? "linear" : "nearest"}`,
            `кадр        ${ms.toFixed(2)} ms`,
          ].join("\n"),
    );
  }

  function markDirty(): void {
    dirty = true;
  }

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

  // Pointer coordinates are CSS pixels of a canvas that may be scaled down by the
  // layout, so they go through the bounding rect rather than straight into world
  // space.
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
    group("Алгоритм", [
      radio(
        [
          { value: "polygon", label: "Полигон видимости (сегменты)" },
          { value: "fov", label: "Recursive shadowcasting (тайлы)" },
        ],
        state.mode,
        (v) => {
          state.mode = v as Mode;
          markDirty();
        },
      ),
      toggle("Мержить грани (полигон)", state.merge, (v) => {
        state.merge = v;
        markDirty();
      }),
      toggle("Мягкий апскейл (тайлы)", state.smooth, (v) => {
        state.smooth = v;
        markDirty();
      }),
      toggle("Показать сегменты и лучи", state.debug, (v) => {
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
  hint.textContent = "Курсор по канвасу двигает первый источник.";

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
    app.destroy(true, { children: true });
    lightMap.destroy();
    glowTexture.destroy(true);
    for (const light of lights) {
      light.texture.destroy(true);
    }
    wrap.remove();
  };
}

export { mountShadowCasting };
