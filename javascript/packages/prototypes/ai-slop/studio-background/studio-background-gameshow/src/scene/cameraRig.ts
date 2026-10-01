import * as THREE from "three";
import { WHEEL_CENTER } from "./wheel";

const BASE_FOV = 40;
const DESIGN_ASPECT = 16 / 9;
// A full wide -> close -> wide cycle; slow moves with long holds read as a broadcast crane.
const DOLLY_PERIOD = 44;

// The wide shot stands inside the colonnade, so the near side arches loom large at the frame edges.
// It aims a little under the wheel center, which puts the wheel slightly above the middle of the frame.
const FAR = {
  position: new THREE.Vector3(0, 3.9, WHEEL_CENTER.z + 14),
  target: new THREE.Vector3(0, WHEEL_CENTER.y - 0.75, WHEEL_CENTER.z),
};
const NEAR = {
  position: new THREE.Vector3(0, 4.4, WHEEL_CENTER.z + 10.5),
  target: WHEEL_CENTER.clone(),
};

// Ease that holds at both ends: the camera rests wide and rests close.
function dollyCurve(phase: number): number {
  const tri = 1 - Math.abs(2 * phase - 1);
  return tri * tri * tri * (tri * (tri * 6 - 15) + 10);
}

function createCameraRig(camera: THREE.PerspectiveCamera) {
  let swingTime = 0;
  let dollyTime = 0;
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();

  // Narrow screens widen the vertical FOV so that the arches on the sides stay in frame.
  const resize = (aspect: number) => {
    camera.aspect = aspect;
    if (aspect < DESIGN_ASPECT) {
      const halfTan = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * (DESIGN_ASPECT / aspect);
      camera.fov = Math.min(THREE.MathUtils.radToDeg(Math.atan(halfTan) * 2), 80);
    } else {
      camera.fov = BASE_FOV;
    }
    camera.updateProjectionMatrix();
  };

  const update = (dt: number, swing: boolean, dolly: boolean) => {
    if (swing) {
      swingTime += dt;
    }
    if (dolly) {
      dollyTime += dt;
    }
    const k = dollyCurve((dollyTime / DOLLY_PERIOD) % 1);
    position.lerpVectors(FAR.position, NEAR.position, k);
    target.lerpVectors(FAR.target, NEAR.target, k);

    // Slow drift, like a crane operator holding the shot: a few incommensurate sines with
    // periods of 30-90 s and small amplitudes, gentler when the camera is close.
    const t = swingTime;
    const amount = 1 - k * 0.5;
    position.x += (Math.sin(t * 0.11) * 0.35 + Math.sin(t * 0.067 + 1.3) * 0.15) * amount;
    position.y += Math.sin(t * 0.083 + 0.5) * 0.08 * amount;
    position.z += Math.sin(t * 0.071 + 2.0) * 0.15 * amount;
    target.x += Math.sin(t * 0.093 + 0.8) * 0.08 * amount;
    camera.position.copy(position);
    camera.lookAt(target);
    camera.rotateZ(Math.sin(t * 0.059) * 0.003 * amount);
  };

  // Jumps both clocks to a time: used for deterministic captures.
  const seek = (time: number) => {
    swingTime = time;
    dollyTime = time;
  };

  return { resize, update, seek };
}

// Where the wide shot stands: the water waves are anchored relative to it.
const WIDE_SHOT_POSITION = FAR.position;

export { createCameraRig, WIDE_SHOT_POSITION };
