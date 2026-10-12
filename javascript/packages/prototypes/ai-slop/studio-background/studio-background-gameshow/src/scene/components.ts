import * as THREE from "three";
import type { Behaviour, BodyBuilder, ComponentType, StartContext } from "../engine/sceneLoader";
import type { ComponentData } from "../engine/sceneFormat";
import { StaticBatch } from "../engine/staticBatch";
import { inspectorRevision, shot, structureRevision } from "../state";
import { createCameraRig } from "./cameraRig";
import type { CameraRig, RigData, Station } from "./cameraRig";
import { CASINO_BODIES, buildCasinoBody } from "./casino";
import { CasinoLamps } from "./casinoShading";
import type { CasinoSettings } from "./casinoShading";
import { SpotSweep } from "./lights";
import type { SpotSweepData } from "./lights";
import { WheelSpin } from "./wheel";
import type { WheelSpinData } from "./wheel";

// The component types of the scene file that are not bodies: behaviours that animate objects found by id,
// the static batch, and data components that a behaviour reads. Also the procedural bodies (`BODIES`).

function need(context: StartContext, id: unknown, owner: THREE.Object3D): THREE.Object3D {
  const object = typeof id === "string" ? context.objectById(id) : undefined;
  if (!object) {
    throw new Error(`[scene] ${owner.name}: missing object ${String(id)}`);
  }
  return object;
}

// The Main Camera: the shots and the moves between them (cameraRig.ts).
interface RigBehaviour extends Behaviour {
  rig: CameraRig;
}

const cameraRig: ComponentType = {
  start: (object, data, context): RigBehaviour => {
    const rigData = data as unknown as RigData;
    const vector = (values: number[]) => new THREE.Vector3().fromArray(values);
    const stations = {} as Record<Station, { object: THREE.Object3D; camera: THREE.Vector3; target: THREE.Vector3; push: number; period: number }>;
    for (const [name, station] of Object.entries(rigData.stations) as [Station, RigData["stations"][Station]][]) {
      stations[name] = { object: need(context, station.object, object), camera: vector(station.camera), target: vector(station.target), push: station.push, period: station.period };
    }
    const rig = createCameraRig(object as THREE.PerspectiveCamera, shot.peek(), {
      wide: { position: vector(rigData.wide.position), target: vector(rigData.wide.target) },
      close: { position: vector(rigData.close.position), target: vector(rigData.close.target) },
      dollyPeriod: rigData.dollyPeriod,
      stations,
    });
    return { rig };
  },
};

const wheelSpin: ComponentType = {
  start: (object, data, context) => {
    const spin = new WheelSpin(need(context, data.rotor, object), need(context, data.bulbs, object) as THREE.InstancedMesh, data as unknown as WheelSpinData);
    return { step: (dt, time, spinning) => spin.step(dt, time, spinning) };
  },
};

const spotSweep: ComponentType = {
  start: (object, data, context) => {
    const sweep = new SpotSweep(object as THREE.SpotLight, need(context, data.beam, object), data as unknown as SpotSweepData);
    return { update: (time) => sweep.update(time) };
  },
};

const UP = new THREE.Vector3(0, 1, 0);

// Keeps the object at `offset` in the frame of `target` (an id): the origin is the target's pivot, local +z its front.
// Only the target's position and its turn about y count: its scale and tilt must not move the object.
// It runs before every render, also while paused, so a target moved in the editor takes the object along at once.
const followTarget: ComponentType = {
  start: (object, data, context) => {
    const target = need(context, data.target, object);
    const offset = new THREE.Vector3().fromArray(data.offset as number[]);
    const toParent = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const front = new THREE.Vector3();
    const spot = new THREE.Vector3();
    return {
      beforeRender: () => {
        const parent = object.parent;
        if (!parent) {
          return;
        }
        target.updateWorldMatrix(true, false);
        parent.updateWorldMatrix(true, false);
        toParent.copy(parent.matrixWorld).invert().multiply(target.matrixWorld);
        toParent.decompose(position, quaternion, scale);
        front.set(0, 0, 1).applyQuaternion(quaternion);
        const yaw = Math.atan2(front.x, front.z);
        spot.copy(offset).applyAxisAngle(UP, yaw).add(position);
        if (!object.position.equals(spot)) {
          object.position.copy(spot);
          object.updateMatrixWorld();
        }
      },
    };
  },
};

// The city backdrop: animates the skyline and water materials.
const cityBackdrop: ComponentType = {
  start: (_object, _data, context) => ({
    beforeRender: (renderer, time) => context.library.updateCity(renderer, time),
  }),
};

// --- Static batching and the casino hall ----------------------------------------------------------

// The edit counters of the editor: a change means that some object may have moved, changed or left the tree.
function editRevision(): string {
  return `${structureRevision.peek()}:${inspectorRevision.peek()}`;
}

// Merges the static meshes under the object per material (engine/staticBatch.ts). It syncs before every render
// that follows an edit, so a moved part moves in the merged mesh too.
const staticBatch: ComponentType = {
  start: (object) => {
    const batch = new StaticBatch(object);
    let revision = "";
    const sync = () => {
      const current = editRevision();
      if (current !== revision) {
        revision = current;
        batch.sync();
      }
    };
    sync();
    return {
      beforeRender: sync,
      dispose: () => {
        batch.dispose();
      },
    };
  },
};

// Data components: a behaviour or the engine reads them from `userData.components`.
// `lightZone` (lightZones.ts): a room for the light zones. `virtualLamp`, `virtualLine` (casinoShading.ts):
// the lamps that light the casino hall in its shader.
const dataOnly: ComponentType = { start: () => null };

// Rocks the object a little about x and z: the chandeliers. `amplitude` in radians, `rate` and `phase` per axis.
const sway: ComponentType = {
  start: (object, data) => {
    const amplitude = data.amplitude as number;
    const [rateX, rateZ] = data.rate as [number, number];
    const [phaseX, phaseZ] = data.phase as [number, number];
    const update = (time: number) => {
      object.rotation.x = Math.sin(time * rateX + phaseX) * amplitude;
      object.rotation.z = Math.sin(time * rateZ + phaseZ) * amplitude;
    };
    update(0);
    return { update };
  },
};

// The casino hall (on the `Casino` object): the settings of its shader, the scene time and the virtual lamps.
const casinoLighting: ComponentType = {
  start: (object, data, context) => {
    const shading = context.library.casino;
    shading.configure(data as unknown as CasinoSettings);
    const lamps = new CasinoLamps(object, shading);
    lamps.update(editRevision());
    return {
      update: (time) => {
        shading.shared.uTime.value = time;
      },
      beforeRender: () => {
        lamps.update(editRevision());
      },
    };
  },
};

const COMPONENTS: Record<string, ComponentType> = {
  cameraRig,
  wheelSpin,
  spotSweep,
  followTarget,
  cityBackdrop,
  staticBatch,
  sway,
  casinoLighting,
  lightZone: dataOnly,
  virtualLamp: dataOnly,
  virtualLine: dataOnly,
};

// The procedural bodies: the casino props.
const BODIES: Record<string, BodyBuilder> = Object.fromEntries(CASINO_BODIES.map((type) => [type, (data: ComponentData) => buildCasinoBody(type, data)]));

export { BODIES, COMPONENTS };
export type { RigBehaviour };
