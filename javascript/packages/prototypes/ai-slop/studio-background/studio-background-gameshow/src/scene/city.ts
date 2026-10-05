import * as THREE from "three";
import skylineUrl from "../assets/background-city-skyline.jpg";
import windowsUrl from "../assets/background-city-windows.png";
import skyMaskUrl from "../assets/background-city-sky-mask.png";
import waterUrl from "../assets/background-water.jpg";
import { WIDE_SHOT_POSITION } from "./cameraRig";
import { createCityLights } from "./cityLights";
import { cylinderArc, named } from "./geometry";
import cityFragment from "./shaders/city.frag";
import commonChunk from "./shaders/common.glsl";
import cityVertex from "./shaders/city.vert";
import waterFragment from "./shaders/water.frag";

const deg = THREE.MathUtils.degToRad;

// City with its sky (scripts/build-skyline.py): the lit waterfront at the bottom edge.
const SKYLINE_SIZE = new THREE.Vector2(2688, 978);
// Water plate (scripts/build-water.py), same pixel scale; its width is shorter by the seam cross-fade.
const WATER_SIZE = new THREE.Vector2(2473, 524);

const CITY = {
  // Far enough that a 7 m dolly changes the city size by under 2%.
  radius: 400,
  // Eye height of the camera, so the horizon matches the studio perspective.
  center: new THREE.Vector3(0, 3.9, 8),
  // One photo tile per 30 degrees. Seams fall at 0 (behind the wheel) and at +-30 degrees.
  period: deg(30),
  // The shoreline sits just under the camera horizon.
  shore: deg(-0.4),
  arcHalf: deg(80),
  elevationMin: deg(-15),
  elevationMax: deg(30),
  // The water band reaches this many texels above the shoreline, over the waterfront's bottom rows.
  overlapTexels: 3,
};

function withCommon(source: string): string {
  return source.replace("// @common", commonChunk);
}

// Open cylinder band around the city center between two elevations.
function band(radius: number, from: number, to: number, material: THREE.Material): THREE.Mesh {
  const top = radius * Math.tan(to);
  const bottom = radius * Math.tan(from);
  const { thetaStart, thetaLength } = cylinderArc(-CITY.arcHalf, CITY.arcHalf);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, top - bottom, 128, 1, true, thetaStart, thetaLength),
    material,
  );
  mesh.position.set(CITY.center.x, CITY.center.y + (top + bottom) / 2, CITY.center.z);
  mesh.frustumCulled = false;
  return mesh;
}

function createCity() {
  const texture = new THREE.TextureLoader().load(skylineUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  // Window ID map: exact texel values, never filtered.
  const windows = new THREE.TextureLoader().load(windowsUrl);
  windows.minFilter = THREE.NearestFilter;
  windows.magFilter = THREE.NearestFilter;
  windows.generateMipmaps = false;
  const lights = createCityLights(texture, windows, SKYLINE_SIZE.x, SKYLINE_SIZE.y);
  const loadPlate = (url: string) => {
    const plate = new THREE.TextureLoader().load(url);
    plate.colorSpace = THREE.SRGBColorSpace;
    plate.wrapS = THREE.RepeatWrapping;
    plate.anisotropy = 8;
    return plate;
  };
  // The mask holds coverage, not colour: no sRGB decode.
  const loadMask = (url: string) => {
    const mask = new THREE.TextureLoader().load(url);
    mask.wrapS = THREE.RepeatWrapping;
    return mask;
  };
  // Radians per photo pixel, the same for the city and the water.
  const radiansPerPixel = CITY.period / SKYLINE_SIZE.x;

  const material = new THREE.ShaderMaterial({
    vertexShader: cityVertex,
    fragmentShader: withCommon(cityFragment),
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uLive: { value: lights.texture },
      uSkyMask: { value: loadMask(skyMaskUrl) },
      uMapSize: { value: SKYLINE_SIZE },
      uTime: { value: 0 },
      uCenter: { value: CITY.center },
      uPeriod: { value: CITY.period },
      uShore: { value: CITY.shore },
      // Pixels stay square: every plate height in radians follows from its pixel count.
      uSkylineHeight: { value: SKYLINE_SIZE.y * radiansPerPixel },
      uExposure: { value: 1.05 },
      uHazeColor: { value: new THREE.Color(0x060c1e) },
    },
  });

  // City and sky: from the shoreline up. Drawn first, behind everything.
  const city = named(band(CITY.radius, CITY.shore, CITY.elevationMax, material), "Skyline");
  city.renderOrder = -1;

  const waterTop = CITY.shore + CITY.overlapTexels * radiansPerPixel;
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: cityVertex,
    fragmentShader: withCommon(waterFragment),
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uWater: { value: loadPlate(waterUrl) },
      uTime: { value: 0 },
      uCenter: { value: CITY.center },
      uWaterPeriod: { value: WATER_SIZE.x * radiansPerPixel },
      uWaterHeight: { value: WATER_SIZE.y * radiansPerPixel },
      uTop: { value: waterTop },
      uShore: { value: CITY.shore },
      // Camera height above the water: sets how fast the water recedes towards the shore.
      uEyeHeight: { value: 4 },
      uOrigin: { value: WIDE_SHOT_POSITION },
      uExposure: { value: 0.8 },
      uHazeColor: { value: new THREE.Color(0x060c1e) },
    },
  });
  // Water: a band just in front of the city cylinder, from below the frame up to the overlap.
  const water = named(band(CITY.radius - 1, CITY.elevationMin, waterTop, waterMaterial), "Water");

  const group = named(new THREE.Group(), "City Backdrop", true);
  group.userData.auditIgnore = true;
  group.add(city, water);

  const update = (renderer: THREE.WebGLRenderer, time: number) => {
    lights.render(renderer, time);
    for (const uniforms of [material.uniforms, waterMaterial.uniforms]) {
      const uniform = uniforms.uTime;
      if (uniform) {
        uniform.value = time;
      }
    }
  };

  return { group, update };
}

export { createCity };
