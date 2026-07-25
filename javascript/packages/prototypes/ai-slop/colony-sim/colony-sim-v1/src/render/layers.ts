import { ColorMatrixFilter, Container } from "pixi.js";

// The asset pack's palette is very bright at full strength. One colour grade on
// `root` tones the whole world down at render time: cheaper and far more
// tweakable than re-tinting the source art, and the DOM HUD above the canvas is
// left alone.
const GRADE_BRIGHTNESS = 0.82;
const GRADE_SATURATION = -0.12; // a delta, not a factor: negative = calmer colours

// Stage layering: static ground at the bottom, then world objects and living
// entities (both y-sorted for top-down overlap), then transient FX. React HUD
// lives in the DOM above the canvas, not in this tree. `root` carries the camera
// transform (pan offset + zoom scale), so children stay in world px.
interface Layers {
  root: Container;
  ground: Container;
  objects: Container;
  entities: Container;
  fx: Container;
}

function createLayers(): Layers {
  const root = new Container();
  root.filters = [gradeFilter()];

  const ground = new Container();
  const objects = new Container();
  const entities = new Container();
  const fx = new Container();

  objects.sortableChildren = true;
  entities.sortableChildren = true;

  root.addChild(ground, objects, entities, fx);
  return { root, ground, objects, entities, fx };
}

function gradeFilter(): ColorMatrixFilter {
  const grade = new ColorMatrixFilter();
  grade.brightness(GRADE_BRIGHTNESS, false);
  grade.saturate(GRADE_SATURATION, true); // multiply: chain onto the brightness matrix
  return grade;
}

export type { Layers };
export { createLayers };
