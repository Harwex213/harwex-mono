import * as THREE from "three";
import { structureRevision } from "../state";

// Light zones: the amphitheatre and the annex (the casino) are two rooms, and the lights of one room do not reach
// the other room. three.js shades every lit fragment with every light of the scene, and the cost grows
// faster than the light count: with all 32 lights the wheel shot took 43 ms per frame, with the 21 lights
// of the amphitheatre alone it took 12 ms.
// So each frame the lights of a room that the camera does not see are left out of the render.
// - A room is an object with a `lightZone` component: `name`, and the space of the room for the frustum test
//   (`min`, `max`: a box in the frame of the object). One zone has `default: true`.
// - A light belongs to the zone of the nearest object above it with a `lightZone` component (the `Annex` group).
//   A light without such an object belongs to the default zone (the amphitheatre), even when it hangs over the
//   annex floor (the wheel key light).
// - A hemisphere light lights every room and is never left out.
// - Under the editor lighting every game light is left out: the editor lighting dims them all to 0 anyway.
// - A light is left out through its layers, not through `visible`: the scene document saves `visible`.
// - The lists of zones and lights are read again after every change to the tree (`structureRevision`): a light added,
//   deleted or moved into another room in the editor gets its zone on the next frame.
// - A material keeps a compiled program for every light set it has met, so a change of the set costs a compile
//   only the first time. `warmUp` prepares the sets at startup.

interface ZoneData {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
  default?: boolean;
}

interface Zone {
  object: THREE.Object3D;
  box: THREE.Box3;
  bit: number;
}

function zoneData(object: THREE.Object3D): ZoneData | undefined {
  return (object.userData.components as Record<string, unknown> | undefined)?.lightZone as ZoneData | undefined;
}

class LightZones {
  private readonly root: THREE.Object3D;
  private readonly lights: { light: THREE.Light; zone: number }[] = [];
  private readonly zones: Zone[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private all = 0;
  private revision = -1;

  constructor(root: THREE.Object3D) {
    this.root = root;
    this.scan();
  }

  private scan(): void {
    this.revision = structureRevision.peek();
    for (const { light } of this.lights) {
      // A deleted light keeps no stale layer mask: undo brings it back lit.
      light.layers.set(0);
    }
    this.lights.length = 0;
    this.zones.length = 0;
    let fallback = 0;
    this.root.traverse((object) => {
      const data = zoneData(object);
      if (data) {
        const bit = 1 << this.zones.length;
        this.zones.push({ object, box: new THREE.Box3(new THREE.Vector3().fromArray(data.min), new THREE.Vector3().fromArray(data.max)), bit });
        if (data.default) {
          fallback = bit;
        }
      }
    });
    this.all = (1 << this.zones.length) - 1;
    this.root.traverse((object) => {
      const light = object as THREE.Light;
      if (light.isLight && !(light as THREE.HemisphereLight).isHemisphereLight) {
        this.lights.push({ light, zone: this.zoneOf(light) || fallback || this.all });
      }
    });
  }

  // The bit of the zone of the nearest object above the light with a `lightZone` component, or 0.
  private zoneOf(light: THREE.Light): number {
    let current: THREE.Object3D | null = light;
    while (current) {
      const zone = this.zones.find((item) => item.object === current);
      if (zone) {
        return zone.bit;
      }
      current = current.parent;
    }
    return 0;
  }

  // Leaves out the lights of the rooms that `camera` does not see.
  // `editorLit`: the editor lighting dims every game light to 0, so all of them are left out.
  update(camera: THREE.Camera, editorLit: boolean): void {
    if (this.revision !== structureRevision.peek()) {
      this.scan();
    }
    if (editorLit) {
      this.apply(0);
      return;
    }
    camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    let seen = 0;
    for (const zone of this.zones) {
      zone.object.updateWorldMatrix(true, false);
      if (this.frustum.intersectsBox(this.box.copy(zone.box).applyMatrix4(zone.object.matrixWorld))) {
        seen |= zone.bit;
      }
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
    // Each room alone, all rooms, no room.
    const sets = [...this.zones.map((zone) => zone.bit), this.all, 0];
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const compiles = sets.map((seen) => {
      this.apply(seen);
      return renderer.compileAsync(scene, camera);
    });
    renderer.setRenderTarget(previous);
    this.apply(this.all);
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
      this.apply(this.all);
    });
  }

  private apply(seen: number): void {
    for (const { light, zone } of this.lights) {
      if ((seen & zone) !== 0) {
        light.layers.set(0);
      } else {
        light.layers.disableAll();
      }
    }
  }
}

export { LightZones };
