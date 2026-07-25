import { Container } from "pixi.js";

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

  const ground = new Container();
  const objects = new Container();
  const entities = new Container();
  const fx = new Container();

  objects.sortableChildren = true;
  entities.sortableChildren = true;

  root.addChild(ground, objects, entities, fx);
  return { root, ground, objects, entities, fx };
}

export type { Layers };
export { createLayers };
