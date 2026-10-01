import * as THREE from "three";
import { polar } from "./geometry";
import beamFragment from "./shaders/beam.frag";
import beamVertex from "./shaders/beam.vert";
import { LAYOUT } from "./studio";
import { WHEEL_CENTER } from "./wheel";

const deg = THREE.MathUtils.degToRad;

function spot(color: number, intensity: number, angle: number, from: THREE.Vector3, to: THREE.Vector3, shadow = false): THREE.SpotLight {
  const light = new THREE.SpotLight(color, intensity, 0, angle, 0.6, 2);
  light.position.copy(from);
  light.target.position.copy(to);
  if (shadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0004;
    light.shadow.camera.near = 2;
    light.shadow.camera.far = 30;
  }
  return light;
}

// Additive cone that fakes the visible beam of a stage light.
function beam(color: number, from: THREE.Vector3, to: THREE.Vector3, bottomRadius: number, intensity: number): THREE.Mesh {
  const length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(0.1, bottomRadius, length, 32, 1, true);
  const material = new THREE.ShaderMaterial({
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.length = length;
  aimBeam(mesh, from, to);
  mesh.renderOrder = 10;
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
const beamDirection = new THREE.Vector3();

// Places a beam cone between the fixture and the spot on the floor.
function aimBeam(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  beamDirection.copy(from).sub(to);
  mesh.scale.y = beamDirection.length() / mesh.userData.length;
  mesh.quaternion.setFromUnitVectors(UP, beamDirection.normalize());
}

type Mover = {
  light: THREE.SpotLight;
  beam: THREE.Mesh;
  from: THREE.Vector3;
  base: THREE.Vector3;
  // Unit vectors on the floor: along the wall and towards the center.
  side: THREE.Vector3;
  inward: THREE.Vector3;
  path: SweepPath;
  // Own clock: runs faster or slower, so the spots drift in and out of step.
  clock: number;
};

// Each spot gets its own path, so no two move alike.
// Frequencies (rad/s) are picked to never line up; amplitudes are in meters.
type SweepPath = {
  acrossFrequencies: [number, number];
  acrossAmplitudes: [number, number];
  depthFrequency: number;
  depthAmplitude: number;
  phases: [number, number, number];
  // How fast the operator's attention wanders: sets when the spot slows down and holds.
  holdFrequency: number;
};

const SWEEP_PATHS: SweepPath[] = [
  { acrossFrequencies: [0.31, 0.83], acrossAmplitudes: [2.4, 0.6], depthFrequency: 0.19, depthAmplitude: 1.6, phases: [0.0, 1.9, 4.1], holdFrequency: 0.071 },
  { acrossFrequencies: [0.47, 0.13], acrossAmplitudes: [1.6, 1.4], depthFrequency: 0.37, depthAmplitude: 1.1, phases: [2.6, 0.4, 1.3], holdFrequency: 0.053 },
  { acrossFrequencies: [0.23, 0.61], acrossAmplitudes: [2.8, 0.5], depthFrequency: 0.29, depthAmplitude: 1.8, phases: [5.1, 3.3, 0.2], holdFrequency: 0.089 },
  { acrossFrequencies: [0.39, 0.17], acrossAmplitudes: [1.9, 1.2], depthFrequency: 0.43, depthAmplitude: 0.9, phases: [1.2, 5.7, 2.8], holdFrequency: 0.061 },
];

function createLights() {
  const group = new THREE.Group();
  const movers: Mover[] = [];
  const add = (light: THREE.SpotLight) => {
    group.add(light, light.target);
  };

  group.add(new THREE.HemisphereLight(0x23356e, 0x050308, 0.25));

  // Warm key and fills on the wheel from the front ceiling truss.
  add(spot(0xffd9a8, 260, deg(18), new THREE.Vector3(0, 14, 12), WHEEL_CENTER, true));
  add(spot(0xffc58a, 120, deg(17), new THREE.Vector3(-9, 13.5, 7), WHEEL_CENTER));
  add(spot(0xffc58a, 120, deg(17), new THREE.Vector3(9, 13.5, 7), WHEEL_CENTER));
  // Top light that rims the housing and pools on the podium.
  add(spot(0xffe7c4, 110, deg(26), new THREE.Vector3(0, LAYOUT.ceilingY - 0.6, WHEEL_CENTER.z - 3), new THREE.Vector3(0, 0, WHEEL_CENTER.z + 1)));

  // Warm grazing light on the colonnade so the gold columns read.
  for (const angle of [deg(-75), deg(-45), deg(-15), deg(15), deg(45), deg(75)]) {
    const from = polar(angle, LAYOUT.wallRadius * 0.5, LAYOUT.ceilingY - 0.8);
    const to = polar(angle, LAYOUT.wallRadius, 5);
    add(spot(0xffb466, 480, deg(26), from, to));
  }

  // Blue washes from the back fixtures, with visible beams like in the reference.
  const blueAngles = [deg(-62), deg(-26), deg(26), deg(62)];
  for (const angle of blueAngles) {
    const from = polar(angle, LAYOUT.wallRadius * 0.9, LAYOUT.ceilingY - 0.9);
    const to = polar(angle * 0.92, LAYOUT.wallRadius * 0.86, 0.5);
    const light = spot(0x3d66ff, 320, deg(13), from, to);
    add(light);
    const cone = beam(0x3d66ff, from, to, 2.0, 0.35);
    group.add(cone);
    const inward = new THREE.Vector3(-to.x, 0, -to.z).normalize();
    const side = new THREE.Vector3(inward.z, 0, -inward.x);
    const path = SWEEP_PATHS[movers.length % SWEEP_PATHS.length] as SweepPath;
    movers.push({ light, beam: cone, from, base: to.clone(), side, inward, path, clock: 0 });
  }
  // Warm beams falling from the front fixture ring.
  for (const angle of [deg(-45), deg(-15), deg(15), deg(45)]) {
    const from = polar(angle, LAYOUT.wallRadius * 0.68, LAYOUT.ceilingY - 0.95);
    const to = polar(angle * 0.9, LAYOUT.wallRadius * 0.58, 0);
    group.add(beam(0xffb870, from, to, 1.5, 0.05));
  }

  // Glow of the wheel bulbs on the podium.
  const bulbGlow = new THREE.PointLight(0xffcf8a, 5, 9, 2);
  bulbGlow.position.set(WHEEL_CENTER.x, WHEEL_CENTER.y - 2.5, WHEEL_CENTER.z + 1.6);
  group.add(bulbGlow);

  // The blue spots sweep the floor slowly, each on its own path and its own clock.
  // A spot's clock now and then slows almost to a stop, so it holds a moment while others move.
  const target = new THREE.Vector3();
  let lastTime = 0;
  const update = (time: number) => {
    const dt = time - lastTime;
    lastTime = time;
    for (const mover of movers) {
      const path = mover.path;
      const hold = Math.sin(time * path.holdFrequency + path.phases[2] * 2.0);
      const pace = 0.15 + 0.85 * THREE.MathUtils.smoothstep(hold, -0.6, 0.2);
      // A jump in time (a seek) restarts the clock from the time itself.
      mover.clock = dt < 0 || dt > 0.5 ? time * 0.7 : mover.clock + dt * pace;
      const t = mover.clock;
      const across =
        Math.sin(t * path.acrossFrequencies[0] + path.phases[0]) * path.acrossAmplitudes[0] +
        Math.sin(t * path.acrossFrequencies[1] + path.phases[1]) * path.acrossAmplitudes[1];
      const depth = Math.sin(t * path.depthFrequency + path.phases[2]) * path.depthAmplitude;
      target.copy(mover.base).addScaledVector(mover.side, across).addScaledVector(mover.inward, depth);
      mover.light.target.position.copy(target);
      aimBeam(mover.beam, mover.from, target);
    }
  };

  return { group, update };
}

export { createLights };
