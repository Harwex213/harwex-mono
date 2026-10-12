import * as THREE from "three";
import { decodeColor } from "../engine/sceneFormat";
import type { ColorValue } from "../engine/sceneFormat";
import beamFragment from "./shaders/beam.frag";
import beamVertex from "./shaders/beam.vert";

// The lights live in the scene file. This module keeps two component types:
// - `beam`: an additive cone that fakes the visible beam of a stage light;
// - `spotSweep`: a spot that sweeps the floor slowly and drags its beam cone along.

interface BeamData {
  color: ColorValue;
  intensity: number;
  bottomRadius: number;
  // The cone length at scale 1. A cone between two other points is scaled along y.
  length: number;
}

function createBeam(data: BeamData): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(0.1, data.bottomRadius, data.length, 32, 1, true);
  const material = new THREE.ShaderMaterial({
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    uniforms: {
      uColor: { value: decodeColor(data.color, new THREE.Color()) },
      uIntensity: { value: data.intensity },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // The cones cover half the frame: clicks in the Scene view pass through them to the set.
  mesh.raycast = () => {};
  mesh.userData.length = data.length;
  // A fake light: the editor lighting hides it.
  mesh.userData.beam = true;
  mesh.renderOrder = 10;
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
const beamDirection = new THREE.Vector3();

// Places a beam cone between the fixture and the spot on the floor.
function aimBeam(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  beamDirection.copy(from).sub(to);
  mesh.scale.y = beamDirection.length() / (mesh.userData.length as number);
  mesh.quaternion.setFromUnitVectors(UP, beamDirection.normalize());
}

// The path of one spot. Frequencies (rad/s) are picked to never line up; amplitudes are in metres.
interface SweepPath {
  acrossFrequencies: [number, number];
  acrossAmplitudes: [number, number];
  depthFrequency: number;
  depthAmplitude: number;
  phases: [number, number, number];
  // How fast the operator's attention wanders: sets when the spot slows down and holds.
  holdFrequency: number;
}

interface SpotSweepData {
  // The id of the beam cone that follows the spot.
  beam: string;
  // The rest point of the spot on the floor, in the frame of the light's parent.
  base: [number, number, number];
  path: SweepPath;
}

// The `spotSweep` component: the spot runs its own path on its own clock. The clock now and then slows almost
// to a stop, so the spot holds a moment while the others move.
class SpotSweep {
  private readonly light: THREE.SpotLight;
  private readonly beam: THREE.Object3D;
  private readonly path: SweepPath;
  private readonly base: THREE.Vector3;
  // Unit vectors on the floor: along the wall and towards the centre.
  private readonly side: THREE.Vector3;
  private readonly inward: THREE.Vector3;
  private readonly target = new THREE.Vector3();
  private clock = 0;
  private lastTime = 0;

  constructor(light: THREE.SpotLight, beam: THREE.Object3D, data: SpotSweepData) {
    this.light = light;
    this.beam = beam;
    this.path = data.path;
    this.base = new THREE.Vector3().fromArray(data.base);
    this.inward = new THREE.Vector3(-this.base.x, 0, -this.base.z).normalize();
    this.side = new THREE.Vector3(this.inward.z, 0, -this.inward.x);
  }

  update(time: number): void {
    const dt = time - this.lastTime;
    this.lastTime = time;
    const path = this.path;
    const hold = Math.sin(time * path.holdFrequency + path.phases[2] * 2.0);
    const pace = 0.15 + 0.85 * THREE.MathUtils.smoothstep(hold, -0.6, 0.2);
    // A jump in time (a seek) restarts the clock from the time itself.
    this.clock = dt < 0 || dt > 0.5 ? time * 0.7 : this.clock + dt * pace;
    const t = this.clock;
    const across =
      Math.sin(t * path.acrossFrequencies[0] + path.phases[0]) * path.acrossAmplitudes[0] +
      Math.sin(t * path.acrossFrequencies[1] + path.phases[1]) * path.acrossAmplitudes[1];
    const depth = Math.sin(t * path.depthFrequency + path.phases[2]) * path.depthAmplitude;
    this.target.copy(this.base).addScaledVector(this.side, across).addScaledVector(this.inward, depth);
    this.light.target.position.copy(this.target);
    // The cone starts at the light, so a light moved in the editor keeps its beam.
    aimBeam(this.beam, this.light.position, this.target);
  }
}

export { SpotSweep, createBeam };
export type { BeamData, SpotSweepData };
