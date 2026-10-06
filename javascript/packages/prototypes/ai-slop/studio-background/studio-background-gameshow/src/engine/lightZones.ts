import * as THREE from "three";
import { HALL } from "../scene/casino";
import { LAYOUT } from "../scene/studio";

// Light zones: the amphitheatre and the casino hall are two rooms, and the lights of one room do not reach
// the other room. three.js shades every lit fragment with every light of the scene, and the cost grows
// faster than the light count: with all 32 lights the wheel shot took 43 ms per frame, with the 21 lights
// of the amphitheatre alone it took 12 ms.
// So each frame the lights of a room that the camera does not see are left out of the render.
// - A light belongs to the hall when it stands inside the hall box. Every other light belongs to the amphitheatre.
// - A hemisphere light lights both rooms and is never left out.
// - Under the editor lighting every game light is left out: the editor lighting dims them all to 0 anyway.
// - A light is left out through its layers, not through `visible`: the scene document saves `visible`.
// - A material keeps a compiled program for every light set it has met, so a change of the set costs a compile
//   only the first time. `warmUp` prepares the sets at startup.

const HALL_BOX = new THREE.Box3(
  new THREE.Vector3(-HALL.halfWidth, 0, HALL.backZ),
  new THREE.Vector3(HALL.halfWidth, HALL.height + HALL.ceilingThickness, HALL.frontZ),
);

// The space of each room, for the frustum test.
// The wide wheel shot stands just inside the hall (z ~10) and looks away from it, so the hall space starts
// 0.6 m in front of the back wall. The amphitheatre space ends at the back wall of the hall.
const HALL_VIEW = new THREE.Box3(
  new THREE.Vector3(-HALL.halfWidth, 0, HALL.backZ + 0.6),
  new THREE.Vector3(HALL.halfWidth, HALL.height + HALL.ceilingThickness, HALL.frontZ),
);
const STUDIO_VIEW = new THREE.Box3(
  new THREE.Vector3(-LAYOUT.wallRadius - 3, -1, -LAYOUT.wallRadius - 3),
  new THREE.Vector3(LAYOUT.wallRadius + 3, LAYOUT.ceilingY + 0.5, HALL.backZ),
);

const NONE = 0b00;
const ALL = 0b11;
const STUDIO = 0b01;
const HALL_ONLY = 0b10;

class LightZones {
  private readonly lights: THREE.Light[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();

  constructor(root: THREE.Object3D) {
    root.traverse((object) => {
      const light = object as THREE.Light;
      if (light.isLight && !(light as THREE.HemisphereLight).isHemisphereLight) {
        this.lights.push(light);
      }
    });
  }

  // Leaves out the lights of the rooms that `camera` does not see.
  // `editorLit`: the editor lighting dims every game light to 0, so all of them are left out.
  update(camera: THREE.Camera, editorLit: boolean): void {
    if (editorLit) {
      this.apply(NONE);
      return;
    }
    camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    let seen = 0;
    if (this.frustum.intersectsBox(STUDIO_VIEW)) {
      seen |= STUDIO;
    }
    if (this.frustum.intersectsBox(HALL_VIEW)) {
      seen |= HALL_ONLY;
    }
    this.apply(seen);
  }

  // Prepares every light set at startup, so the first camera move to another room does not stall.
  // First the programs of each set compile in parallel. Then each set draws the whole scene once into a tiny
  // target of the same format as `target`, with frustum culling off: the GPU driver builds its pipeline
  // for a program on the first draw, and that costs more than 100 ms per set.
  // A program for the canvas carries tone mapping and a program for a render target does not,
  // so the compile runs against `target`, the target the scene renders into.
  // Without parallel compile (a software renderer) the compiles would block the page for a minute: the sets then
  // compile on first use instead.
  warmUp(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget): void {
    if (!renderer.extensions.has("KHR_parallel_shader_compile")) {
      return;
    }
    const sets = [STUDIO, HALL_ONLY, ALL, NONE];
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const compiles = sets.map((seen) => {
      this.apply(seen);
      return renderer.compileAsync(scene, camera);
    });
    renderer.setRenderTarget(previous);
    this.apply(ALL);
    void Promise.all(compiles).then(() => {
      const tiny = target.clone();
      tiny.setSize(4, 4);
      const culled: THREE.Object3D[] = [];
      scene.traverse((object) => {
        if (object.frustumCulled) {
          culled.push(object);
          object.frustumCulled = false;
        }
      });
      const current = renderer.getRenderTarget();
      renderer.setRenderTarget(tiny);
      for (const seen of sets) {
        this.apply(seen);
        renderer.render(scene, camera);
      }
      renderer.setRenderTarget(current);
      for (const object of culled) {
        object.frustumCulled = true;
      }
      tiny.dispose();
      this.apply(ALL);
    });
  }

  private apply(seen: number): void {
    for (const light of this.lights) {
      // The world matrix is the one of the last frame; a light moved in the editor changes room a frame late.
      this.point.setFromMatrixPosition(light.matrixWorld);
      const zone = HALL_BOX.containsPoint(this.point) ? HALL_ONLY : STUDIO;
      if ((seen & zone) !== 0) {
        light.layers.set(0);
      } else {
        light.layers.disableAll();
      }
    }
  }
}

export { LightZones };
