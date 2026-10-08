import * as THREE from "three";
import type { Shot } from "../state";
import { GAMESHOW_SHOT } from "./annex";
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

// The Game Show shot (annex.ts) pushes in by this share of the distance to its target and back, once per period.
const GAMESHOW_PERIOD = 36;
const GAMESHOW_PUSH = 0.12;

// A move between shots: the camera cranes up to this height on the way, over every prop of the set.
// The move from the wheel shot to the Game Show shot runs in a straight line on the plan: from the front of the
// amphitheatre to the right, into the Game Show room, and the view turns right from -z to +x.
const TRAVEL_APEX = 7;
const TRAVEL_BASE = 2.4;
const TRAVEL_PER_METRE = 0.015;
const TRAVEL_MAX = 3.2;

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  roll: number;
}

interface Travel {
  from: THREE.Vector3;
  yaw: number;
  pitch: number;
  // The turn from the start view to the destination view at the start; it fixes the direction of a half turn.
  turn: number;
  destinationYaw: number;
  elapsed: number;
  duration: number;
}

// Ease that holds at both ends: the camera rests wide and rests close.
function dollyCurve(phase: number): number {
  const tri = 1 - Math.abs(2 * phase - 1);
  return tri * tri * tri * (tri * (tri * 6 - 15) + 10);
}

function smootherstep(x: number): number {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Wraps an angle into -PI..PI.
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function yawOf(direction: THREE.Vector3): number {
  return Math.atan2(direction.x, direction.z);
}

function pitchOf(direction: THREE.Vector3): number {
  return Math.asin(THREE.MathUtils.clamp(direction.y / Math.max(direction.length(), 1e-6), -1, 1));
}

// The hero wheel shot: a dolly between the wide and the close position, with a slow drift.
function wheelPose(swingTime: number, dollyTime: number, pose: Pose): void {
  const k = dollyCurve((dollyTime / DOLLY_PERIOD) % 1);
  pose.position.lerpVectors(FAR.position, NEAR.position, k);
  pose.target.lerpVectors(FAR.target, NEAR.target, k);

  // Slow drift, like a crane operator holding the shot: a few incommensurate sines with
  // periods of 30-90 s and small amplitudes, gentler when the camera is close.
  const t = swingTime;
  const amount = 1 - k * 0.5;
  pose.position.x += (Math.sin(t * 0.11) * 0.35 + Math.sin(t * 0.067 + 1.3) * 0.15) * amount;
  pose.position.y += Math.sin(t * 0.083 + 0.5) * 0.08 * amount;
  pose.position.z += Math.sin(t * 0.071 + 2.0) * 0.15 * amount;
  pose.target.x += Math.sin(t * 0.093 + 0.8) * 0.08 * amount;
  pose.roll = Math.sin(t * 0.059) * 0.003 * amount;
}

const side = new THREE.Vector3();

// The Game Show shot: a slow push in and out, and a sideways drift across the line of sight.
function gameShowPose(swingTime: number, dollyTime: number, pose: Pose): void {
  const base = GAMESHOW_SHOT;
  const k = dollyCurve((dollyTime / GAMESHOW_PERIOD) % 1);
  pose.position.lerpVectors(base.position, base.target, k * GAMESHOW_PUSH);
  pose.target.copy(base.target);
  side.subVectors(base.target, base.position).setY(0).normalize();
  side.set(-side.z, 0, side.x);
  const t = swingTime;
  pose.position.addScaledVector(side, Math.sin(t * 0.11) * 0.3 + Math.sin(t * 0.067 + 1.3) * 0.12);
  pose.position.y += Math.sin(t * 0.083 + 0.5) * 0.06;
  pose.target.addScaledVector(side, Math.sin(t * 0.093 + 0.8) * 0.06);
  pose.roll = Math.sin(t * 0.059) * 0.003;
}

function createCameraRig(camera: THREE.PerspectiveCamera, initialShot: Shot) {
  let swingTime = 0;
  let dollyTime = 0;
  let shot = initialShot;
  let travel: Travel | null = null;
  const pose: Pose = { position: new THREE.Vector3(), target: new THREE.Vector3(), roll: 0 };
  const direction = new THREE.Vector3();
  const look = new THREE.Vector3();

  const evaluate = () => {
    if (shot === "wheel") {
      wheelPose(swingTime, dollyTime, pose);
    } else {
      gameShowPose(swingTime, dollyTime, pose);
    }
  };

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

  // The move to the destination pose: the position eases along a raised arc, the view turns by yaw and pitch.
  const applyTravel = (move: Travel) => {
    const s = smootherstep(move.elapsed / move.duration);
    look.subVectors(pose.target, pose.position);
    const yaw = move.yaw + (move.turn + wrapAngle(yawOf(look) - move.destinationYaw)) * s;
    const pitch = THREE.MathUtils.lerp(move.pitch, pitchOf(look), s);
    const lift = Math.max(0, TRAVEL_APEX - Math.max(move.from.y, pose.position.y));
    camera.position.lerpVectors(move.from, pose.position, s);
    camera.position.y += lift * (1 - (2 * s - 1) ** 6);
    direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(look.copy(camera.position).add(direction));
    camera.rotateZ(pose.roll * s);
  };

  const update = (dt: number, swing: boolean, dolly: boolean) => {
    if (swing) {
      swingTime += dt;
    }
    if (dolly) {
      dollyTime += dt;
    }
    evaluate();
    if (travel) {
      travel.elapsed += dt;
      if (travel.elapsed < travel.duration) {
        applyTravel(travel);
        return;
      }
      travel = null;
    }
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.rotateZ(pose.roll);
  };

  // Starts a move from wherever the camera is now (a move in progress, or a camera moved in the editor).
  const travelTo = (next: Shot) => {
    if (next === shot && !travel) {
      return;
    }
    shot = next;
    camera.getWorldDirection(direction);
    evaluate();
    look.subVectors(pose.target, pose.position);
    const destinationYaw = yawOf(look);
    const yaw = yawOf(direction);
    const distance = camera.position.distanceTo(pose.position);
    travel = {
      from: camera.position.clone(),
      yaw,
      pitch: pitchOf(direction),
      turn: wrapAngle(destinationYaw - yaw),
      destinationYaw,
      elapsed: 0,
      duration: Math.min(TRAVEL_BASE + distance * TRAVEL_PER_METRE, TRAVEL_MAX),
    };
  };

  const isTraveling = () => travel !== null;

  // Jumps both clocks to a time and ends any move: used for deterministic captures.
  const seek = (time: number) => {
    swingTime = time;
    dollyTime = time;
    travel = null;
  };

  return { resize, update, seek, travelTo, isTraveling };
}

// Where the wide shot stands: the water waves are anchored relative to it.
const WIDE_SHOT_POSITION = FAR.position;

export { createCameraRig, WIDE_SHOT_POSITION };
