import * as THREE from "three";
// The same skyline as background-city, with a starry night sky painted above it.
import cityUrl from "../assets/background-city-sky.jpg";
import fragmentShader from "./city.frag.glsl";
import { arcBand } from "./geometry";

const vertexShader = `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// Image facts, measured on background-city.png (v = 0 at the bottom).
const IMAGE_ASPECT = 2688 / 1520;
const IMAGE_HORIZON = 0.35;

// View angle, in radians, of the full picture height.
// 0.313 matched the reference skyline; a smaller angle pushes the city further away.
const IMAGE_ANGULAR_HEIGHT = 0.42;

interface CityOptions {
  radius: number;
  phiFrom: number;
  phiTo: number;
  bottom: number;
  height: number;
}

interface CityHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  update: (time: number) => void;
}

function createCityBackdrop(renderer: THREE.WebGLRenderer, options: CityOptions): CityHandle {
  const texture = new THREE.TextureLoader().load(cityUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const timeUniform = { value: 0 };
  const material = new THREE.ShaderMaterial({
    name: "City Depth",
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    uniforms: {
      uMap: { value: texture },
      uTime: timeUniform,
      uHorizon: { value: IMAGE_HORIZON },
      // One copy of the picture spans this view angle, matched to the reference frame:
      // the tallest spire stands ~205 px above the waterline at a 1664 px focal length.
      uAngularHeight: { value: IMAGE_ANGULAR_HEIGHT },
      uAngularWidth: { value: IMAGE_ANGULAR_HEIGHT * IMAGE_ASPECT },
      uOffsetU: { value: 0.18 },
      // The waterline is lowered by 4°: the arches then show the starry sky of the picture above the skyline.
      uHorizonElevation: { value: -0.07 },
      uExposure: { value: 0.85 },
      uHazeColor: { value: new THREE.Color(0.03, 0.04, 0.09) },
      // How much the brightest windows are pushed past the bloom threshold.
      uWindowGlow: { value: 1.4 },
      uWaterColor: { value: new THREE.Color(0.004, 0.008, 0.022) },
    },
  });

  const geometry = arcBand(options.radius, options.phiFrom, options.phiTo, options.bottom, options.height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "City Backdrop";
  mesh.userData.selectable = true;

  function update(time: number): void {
    timeUniform.value = time;
  }

  return { mesh, material, update };
}

export { createCityBackdrop };
export type { CityHandle };
