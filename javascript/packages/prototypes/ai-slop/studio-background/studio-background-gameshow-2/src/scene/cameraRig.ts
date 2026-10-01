import * as THREE from "three";
import { group } from "./geometry";

// The rig is the editable part: move or turn it in the Scene view to reframe the shot.
// The camera inside the rig only carries the animation: a dolly towards the wheel and a slow swing.

// A long, shallow push-in: big or fast dolly moves read as motion sickness.
const ZOOM_PERIOD = 26;
const ZOOM_DISTANCE = 4.8;

interface CameraRigHandle {
  rig: THREE.Group;
  camera: THREE.PerspectiveCamera;
  update: (time: number) => void;
}

function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// 0 = wide shot, 1 = close-up. Holds wide, pushes in, holds close, pulls back.
function zoomAmount(time: number): number {
  const p = (time % ZOOM_PERIOD) / ZOOM_PERIOD;
  return smootherstep(0.05, 0.45, p) * (1 - smootherstep(0.55, 0.95, p));
}

function createCameraRig(eye: THREE.Vector3, target: THREE.Vector3, fov: number): CameraRigHandle {
  const rig = group("Main Camera Rig");
  rig.position.copy(eye);
  rig.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0)));

  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 160);
  camera.name = "Main Camera";
  rig.add(camera);

  const distance = eye.distanceTo(target);

  function update(time: number): void {
    const zoom = zoomAmount(time);
    const dolly = zoom * ZOOM_DISTANCE;

    // Swing: two slow sines per axis so the motion never looks like a clean loop.
    // The swing gets smaller near the wheel, otherwise the close-up drifts off the hub.
    const swing = 1 - zoom * 0.6;
    const swayX = (Math.sin(time * 0.22) * 0.4 + Math.sin(time * 0.09 + 1.3) * 0.18) * swing;
    const swayY = (Math.sin(time * 0.16 + 0.7) * 0.07 + Math.sin(time * 0.07) * 0.035) * swing;
    camera.position.set(swayX, swayY, -dolly);

    // Aim back at the wheel so the sway reads as an orbit. No roll: the horizon and the
    // reflection streaks on the water must stay level.
    const remaining = Math.max(1, distance - dolly);
    const yaw = Math.atan2(swayX, remaining) * 0.85 + Math.sin(time * 0.12) * 0.004;
    const pitch = -Math.atan2(swayY, remaining) * 0.85;
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  }

  return { rig, camera, update };
}

export { createCameraRig };
export type { CameraRigHandle };
