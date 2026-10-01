import * as THREE from "three";
import { group, polar } from "./geometry";

interface LightRigOptions {
  wallRadius: number;
  rigHeight: number;
  ceilingHeight: number;
  wheelCenter: THREE.Vector3;
}

interface LightRigHandle {
  root: THREE.Group;
  update: (time: number) => void;
}

const beamVertexShader = `
varying float vAlong;
varying vec3 vNormalView;
varying vec3 vViewPos;
uniform float uLength;

void main() {
  vAlong = clamp(position.z / uLength, 0.0, 1.0);
  vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
  vViewPos = viewPos.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewPos;
}
`;

const beamFragmentShader = `
varying float vAlong;
varying vec3 vNormalView;
varying vec3 vViewPos;
uniform vec3 uColor;
uniform float uStrength;

void main() {
  // MSAA can extrapolate varyings past [0, 1]; a negative pow base is NaN, and bloom smears NaN into black blocks.
  float along = clamp(vAlong, 0.0, 1.0);
  float facing = clamp(abs(dot(normalize(vNormalView), normalize(-vViewPos))), 0.0, 1.0);
  float core = facing * facing;
  float fade = pow(1.0 - along, 1.6) * smoothstep(0.0, 0.06, along);
  gl_FragColor = vec4(uColor * core * fade * uStrength, 1.0);
}
`;

// Visible light cone. The tip sits at the object's origin and the cone opens along +Z.
function createBeam(name: string, length: number, radius: number, color: THREE.Color, strength: number): THREE.Mesh {
  const geometry = new THREE.ConeGeometry(radius, length, 40, 1, true);
  geometry.translate(0, -length / 2, 0);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    name: "Light Beam",
    vertexShader: beamVertexShader,
    fragmentShader: beamFragmentShader,
    uniforms: {
      uColor: { value: color },
      uStrength: { value: strength },
      uLength: { value: length },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(geometry, material);
  beam.name = name;
  return beam;
}

function aimedSpot(name: string, color: number, intensity: number, angle: number, position: THREE.Vector3, target: THREE.Vector3): THREE.SpotLight {
  const light = new THREE.SpotLight(color, intensity, 0, angle, 0.55, 2);
  light.name = name;
  light.position.copy(position);
  light.target.position.copy(target);
  light.userData.selectable = true;
  return light;
}

function createLightRig(options: LightRigOptions): LightRigHandle {
  const root = group("Lights", false);
  const { wallRadius, rigHeight, ceilingHeight, wheelCenter } = options;

  const hemi = new THREE.HemisphereLight(0x2a3870, 0x0c0904, 0.22);
  hemi.name = "Ambient Hemisphere";
  hemi.userData.selectable = true;
  root.add(hemi);

  const key = aimedSpot("Key Light (Wheel)", 0xffe0b0, 380, 0.3, new THREE.Vector3(0.6, 9.0, 16), wheelCenter);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 40;
  root.add(key, key.target);

  // Warm washes that make the gold arches glint on both sides of the wheel.
  // One narrow wash per visible side arch, so the gold frames shine like in the reference.
  [0.49, 0.98].forEach((phi, index) => {
    for (const side of [-1, 1]) {
      const label = `${side < 0 ? "L" : "R"}${index + 1}`;
      const target = polar(wallRadius - 0.2, side * phi, 6.0);
      const from = new THREE.Vector3(side * 2.0, rigHeight - 0.5, 6.5);
      const wash = aimedSpot(`Arch Wash ${label}`, 0xffc27a, 160, 0.3, from, target);
      root.add(wash, wash.target);
    }
  });

  // Back light that separates the wheel from the wall behind it.
  const rim = new THREE.PointLight(0xffb060, 18, 0, 2);
  rim.name = "Wheel Rim Light";
  rim.position.set(0, wheelCenter.y + 1.6, wheelCenter.z - 3.2);
  rim.userData.selectable = true;
  root.add(rim);

  // Blue spots that fall from the ceiling rig onto the arches, at the angles of the reference beams.
  const beams = group("Blue Beams", false);
  const blue = new THREE.Color(0.25, 0.42, 1.0);
  const bluePhis = [-0.506, -0.244, 0.244, 0.506];
  const movers: { spot: THREE.SpotLight; beam: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; length: number; phase: number }[] = [];
  bluePhis.forEach((phi, index) => {
    const from = polar(wallRadius - 0.6, phi, rigHeight);
    const to = polar(wallRadius - 1.4, phi * 1.06, 1.0);
    const spot = aimedSpot(`Blue Spot ${index + 1}`, 0x4a72ff, 160, 0.18, from, to);
    root.add(spot, spot.target);
    const length = from.distanceTo(to) * 0.95;
    const beam = createBeam(`Beam ${index + 1}`, length, Math.tan(0.18) * length, blue, 0.22);
    beam.position.copy(from);
    beam.lookAt(to);
    beams.add(beam);
    movers.push({ spot, beam, from, to, length: from.distanceTo(to), phase: index * 1.9 });
  });
  root.add(beams);

  // Soft cones of the white ceiling downlights in front of the arches.
  const warmBeam = new THREE.Color(1.0, 0.75, 0.45);
  for (let i = 0; i < 5; i++) {
    const phi = -0.75 + i * 0.375;
    const from = polar(wallRadius - 2.0, phi, ceilingHeight - 0.05);
    const to = polar(wallRadius - 2.6, phi, 0);
    const length = from.distanceTo(to);
    const beam = createBeam(`Downlight Beam ${i + 1}`, length, 0.9, warmBeam, 0.05);
    beam.position.copy(from);
    beam.lookAt(to);
    beams.add(beam);
  }

  const beamMeshes = beams.children as THREE.Mesh[];
  const beamStrengths = beamMeshes.map((beam) => {
    const uniform = (beam.material as THREE.ShaderMaterial).uniforms.uStrength as THREE.IUniform<number>;
    return { uniform, base: uniform.value };
  });

  // The beams breathe slowly, like haze drifting through them.
  // The blue moving heads sweep their spot slowly across the stage: a wide sideways swing
  // and a shorter in-and-out one, each head on its own phase, the outer pairs mirrored.
  const aim = new THREE.Vector3();
  const across = new THREE.Vector3();
  const inward = new THREE.Vector3();
  function moveSpots(time: number): void {
    movers.forEach((mover, index) => {
      const mirror = index < movers.length / 2 ? -1 : 1;
      inward.set(-mover.to.x, 0, -mover.to.z).normalize();
      across.set(-inward.z, 0, inward.x);
      const sweep = Math.sin(time * 0.35 + mover.phase) * 2.6 * mirror;
      const reach = (Math.sin(time * 0.23 + mover.phase * 1.3) * 0.5 + 0.5) * 3.5;
      aim.copy(mover.to).addScaledVector(across, sweep).addScaledVector(inward, reach);
      mover.spot.target.position.copy(aim);
      mover.beam.lookAt(aim);
      // Keep the visible cone reaching the floor as the aim distance changes.
      mover.beam.scale.set(1, 1, mover.from.distanceTo(aim) / mover.length);
    });
  }

  function update(time: number): void {
    moveSpots(time);
    beamStrengths.forEach((beam, index) => {
      beam.uniform.value = beam.base * (0.85 + 0.15 * Math.sin(time * 0.9 + index * 1.7));
    });
  }

  return { root, update };
}

export { createLightRig };
export type { LightRigHandle };
