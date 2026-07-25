import { Application, BlurFilter, Container, Graphics, RenderTexture, Sprite } from "pixi.js";
import { convexHull, type Point } from "../lib/hull";
import { group, slider, stats, toggle } from "../lib/controls";
import {
  buildGrid,
  MAP_H,
  MAP_W,
  mergeOccluders,
  type Occluder,
  TILE,
  tileOccluders,
} from "../lib/scene";
import type { Teardown } from "./types";

const WIDTH = MAP_W * TILE;
const HEIGHT = MAP_H * TILE;

// Top-down foreshortening: a shadow running "down the screen" is a shadow running
// away from the camera, so its screen length is shorter than the same shadow cast
// sideways. One constant is enough to read as a camera tilt; the alternative is a
// real 3D projection, which this technique deliberately does not have.
const Y_SQUASH = 0.62;

const GRASS_A = 0x3f5a3a;
const GRASS_B = 0x445f3e;
const WALL_FACE = 0x6a6f7b;
const WALL_TOP = 0x878d9b;
const PILLAR_FACE = 0x7d7466;
const PILLAR_TOP = 0x9c9282;

type State = {
  angleDeg: number;
  length: number;
  strength: number;
  softness: number;
  merge: boolean;
  buffered: boolean;
  wireframe: boolean;
  animate: boolean;
};

// The shadow of an axis-aligned box under a directional light: the box's four
// corners plus the same four translated along the light, hulled. Elevation scales
// the offset, so pillars reach further than walls under one sun.
function shadowHull(box: Occluder, dir: Point, length: number): Point[] {
  const dx = dir.x * length * box.elev;
  const dy = dir.y * length * box.elev;
  const pts: Point[] = [];
  const corners: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  for (const c of corners) {
    pts.push(c, { x: c.x + dx, y: c.y + dy });
  }
  return convexHull(pts);
}

function flatten(hull: Point[]): number[] {
  const flat: number[] = [];
  for (const p of hull) {
    flat.push(p.x, p.y);
  }
  return flat;
}

function paintGround(g: Graphics): void {
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const tint = (x + y) % 2 === 0 ? GRASS_A : GRASS_B;
      g.rect(x * TILE, y * TILE, TILE, TILE).fill(tint);
    }
  }
}

// Occluders are drawn above the shadow layer, so nothing ever shadows the box that
// cast it — the usual self-shadowing artifact is solved by paint order alone.
function paintOccluders(g: Graphics, boxes: Occluder[]): void {
  for (const box of boxes) {
    const tall = box.elev > 1;
    g.rect(box.x, box.y, box.w, box.h).fill(tall ? PILLAR_FACE : WALL_FACE);
    g.rect(box.x, box.y, box.w, Math.min(7, box.h)).fill(tall ? PILLAR_TOP : WALL_TOP);
  }
}

// A sun dial in the corner: the arrow points where the shadows go, which is the
// only thing the angle slider actually controls.
function paintGizmo(g: Graphics, dir: Point): void {
  const cx = WIDTH - 54;
  const cy = 54;
  const r = 26;
  g.circle(cx, cy, r).fill({ color: 0x000000, alpha: 0.35 });
  g.circle(cx - dir.x * r * 0.9, cy - dir.y * r * 0.9, 6).fill(0xffd479);
  g.moveTo(cx, cy)
    .lineTo(cx + dir.x * r, cy + dir.y * r)
    .stroke({ width: 2, color: 0xffd479, alpha: 0.9 });
}

async function mountProjectedShadows(host: HTMLElement): Promise<Teardown> {
  const state: State = {
    angleDeg: 55,
    length: 38,
    strength: 0.55,
    softness: 2,
    merge: true,
    buffered: true,
    wireframe: false,
    animate: true,
  };

  const grid = buildGrid();
  const merged = mergeOccluders(grid);
  const perTile = tileOccluders(grid);

  const app = new Application();
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    antialias: true,
    background: 0x14161a,
  });

  const ground = new Graphics();
  paintGround(ground);

  // The shadow pass, off-screen. Everything is drawn opaque black into a cleared
  // buffer, so overlapping polygons produce exactly one black — the composite step
  // below applies the strength once. Drawing translucent polygons straight to the
  // stage instead is what the "buffered" toggle turns off, and the overlaps then
  // darken twice.
  const shadowScene = new Container();
  const shadowGfx = new Graphics();
  shadowScene.addChild(shadowGfx);
  const blur = new BlurFilter({ strength: state.softness, quality: 3 });

  const rt = RenderTexture.create({
    width: WIDTH,
    height: HEIGHT,
    antialias: true,
    resolution: app.renderer.resolution,
  });
  const shadowSprite = new Sprite(rt);
  shadowSprite.blendMode = "multiply";

  // The naive path: same polygons, straight onto the stage.
  const directGfx = new Graphics();
  directGfx.blendMode = "multiply";

  const walls = new Graphics();
  paintOccluders(walls, merged);

  const overlay = new Graphics();

  app.stage.addChild(ground, shadowSprite, directGfx, walls, overlay);

  const readout = stats();
  let dirty = true;

  function rebuild(): void {
    const rad = (state.angleDeg * Math.PI) / 180;
    const dir: Point = { x: Math.cos(rad), y: Math.sin(rad) * Y_SQUASH };
    const boxes = state.merge ? merged : perTile;

    const t0 = performance.now();

    shadowGfx.clear();
    directGfx.clear();
    overlay.clear();

    const target = state.buffered ? shadowGfx : directGfx;
    // Buffered: opaque black, strength applied once by the composite sprite.
    // Naive: strength baked per polygon, hence the double darkening on overlaps.
    const alpha = state.buffered ? 1 : state.strength;

    let vertices = 0;
    for (const box of boxes) {
      const hull = shadowHull(box, dir, state.length);
      vertices += hull.length;
      const flat = flatten(hull);
      target.poly(flat).fill({ color: 0x000000, alpha });
      if (state.wireframe) {
        overlay.poly(flat).stroke({ width: 1, color: 0x63d0ff, alpha: 0.8 });
      }
    }

    shadowGfx.filters = state.softness > 0 ? [blur] : [];
    blur.strength = state.softness;

    shadowSprite.visible = state.buffered;
    shadowSprite.alpha = state.strength;
    if (state.buffered) {
      app.renderer.render({ container: shadowScene, target: rt, clear: true });
    }

    paintGizmo(overlay, dir);

    const ms = performance.now() - t0;
    readout.set(
      [
        `путь        ${state.buffered ? "буфер + multiply x1" : "прямо на сцену (naive)"}`,
        `окклюдеры   ${boxes.length}${state.merge ? ` (из ${perTile.length} тайлов)` : ""}`,
        `вершины     ${vertices}`,
        `перестройка ${ms.toFixed(2)} ms`,
      ].join("\n"),
    );
  }

  function markDirty(): void {
    dirty = true;
  }

  const tick = (): void => {
    if (state.animate) {
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

  const angleControl = slider({
    label: "Угол солнца",
    min: 0,
    max: 359,
    step: 1,
    value: state.angleDeg,
    format: (v) => `${v.toFixed(0)}°`,
    onInput: (v) => {
      state.angleDeg = v;
      state.animate = false;
      animateInput.checked = false;
      markDirty();
    },
  });
  const animateBox = toggle("Вращать солнце", state.animate, (v) => {
    state.animate = v;
  });
  const animateInput = animateBox.querySelector("input") as HTMLInputElement;

  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.append(
    group("Свет", [
      angleControl,
      animateBox,
      slider({
        label: "Длина тени",
        min: 0,
        max: 120,
        step: 1,
        value: state.length,
        format: (v) => `${v.toFixed(0)} px / ед. высоты`,
        onInput: (v) => {
          state.length = v;
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
        label: "Мягкость (blur в буфере)",
        min: 0,
        max: 12,
        step: 0.5,
        value: state.softness,
        format: (v) => `${v.toFixed(1)} px`,
        onInput: (v) => {
          state.softness = v;
          markDirty();
        },
      }),
    ]),
    group("Пайплайн", [
      toggle("Буфер + один multiply", state.buffered, (v) => {
        state.buffered = v;
        markDirty();
      }),
      toggle("Мержить тайлы (greedy meshing)", state.merge, (v) => {
        state.merge = v;
        markDirty();
      }),
      toggle("Показать полигоны", state.wireframe, (v) => {
        state.wireframe = v;
        markDirty();
      }),
      readout.el,
    ]),
  );

  const stage = document.createElement("div");
  stage.className = "stage";
  stage.append(app.canvas);

  const wrap = document.createElement("div");
  wrap.className = "demo";
  wrap.append(stage, panel);
  host.append(wrap);

  return () => {
    app.ticker.remove(tick);
    app.destroy(true, { children: true });
    rt.destroy(true);
    blur.destroy();
    wrap.remove();
  };
}

export { mountProjectedShadows };
