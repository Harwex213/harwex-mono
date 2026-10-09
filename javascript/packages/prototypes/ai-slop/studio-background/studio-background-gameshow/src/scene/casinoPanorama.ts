import * as THREE from "three";
import photoUrl from "../assets/casino-panorama.jpg";
import fxUrl from "../assets/casino-panorama-fx.png";
import { named } from "./geometry";
import commonChunk from "./shaders/common.glsl";
import panoramaFragment from "./shaders/casinoPanorama.frag";
import panoramaVertex from "./shaders/casinoPanorama.vert";

// The luxury casino round the Game Show platform: one panoramic photo (scripts/build-casino-panorama.py)
// on a far cylinder sector, with the technique of the city backdrop (city.ts).
// Every fragment looks the photo up by its view direction from a fixed centre near the Bonus Show camera, not by
// a projection onto proxy geometry. So nothing stretches or smears from any viewpoint: the casino behaves like
// a distant environment. Seen from the centre it is exact; seen from a point a few metres off, the picture shifts
// a little as a whole, like a far room.
// The photo looks out level from a gallery over the casino floor; the platform balustrade (annex.ts) hides
// the seam between the real floor and the photo.
// The shader adds life from a small effect mask: crystal twinkle and glints, candle flicker, slot screens that
// cycle and flash, slow haze and faint light shafts, and a soft distance blur.

const deg = THREE.MathUtils.degToRad;

// The photo in pixels, and its horizon row counted from the bottom (as a share of the height).
const PHOTO = { width: 3072, height: 1024, horizon: 0.4727 };

const PANORAMA = {
  // Near the cameras of the Bonus Show shot, at their eye height, so the photo horizon matches the studio.
  center: new THREE.Vector3(6, 3.7, 15.5),
  radius: 60,
  // Azimuth is measured from +x towards +z. The photo is centred on the azimuth of the Bonus Show shot.
  photoCenter: deg(33),
  // Angle per photo pixel: the photo spans this horizontal angle.
  photoSpan: deg(170),
  // The cylinder sector. Past the ends of the photo the hall fades into darkness.
  // It stays clear of the arches seen from the wheel shot (azimuth -62 degrees and less).
  arcFrom: deg(-56),
  arcTo: deg(178),
  elevationMin: deg(-70),
  elevationMax: deg(60),
};

// Open cylinder sector round the centre between two elevations.
function sector(): THREE.Mesh {
  const { radius, center, arcFrom, arcTo, elevationMin, elevationMax } = PANORAMA;
  const top = radius * Math.tan(elevationMax);
  const bottom = radius * Math.tan(elevationMin);
  // three.js cylinders put a vertex at (r sin theta, r cos theta) in (x, z): theta = 90 degrees - azimuth.
  const geometry = new THREE.CylinderGeometry(radius, radius, top - bottom, 160, 24, true, Math.PI / 2 - arcTo, arcTo - arcFrom);
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(center.x, center.y + (top + bottom) / 2, center.z);
  mesh.frustumCulled = false;
  return mesh;
}

function createCasinoPanorama(): { group: THREE.Group; update: (time: number) => void } {
  const photo = new THREE.TextureLoader().load(photoUrl);
  photo.colorSpace = THREE.SRGBColorSpace;
  photo.anisotropy = 8;
  // The mask holds coverage, not colour: no sRGB decode.
  const fx = new THREE.TextureLoader().load(fxUrl);
  const radiansPerPixel = PANORAMA.photoSpan / PHOTO.width;
  const material = new THREE.ShaderMaterial({
    name: "Casino Panorama",
    vertexShader: panoramaVertex,
    fragmentShader: panoramaFragment.replace("// @common", commonChunk),
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uPhoto: { value: photo },
      uFx: { value: fx },
      uSize: { value: new THREE.Vector2(PHOTO.width, PHOTO.height) },
      uCenter: { value: PANORAMA.center },
      uAzimuthLeft: { value: PANORAMA.photoCenter - PANORAMA.photoSpan / 2 },
      uRadiansPerPixel: { value: radiansPerPixel },
      uHorizon: { value: PHOTO.horizon },
      uTime: { value: 0 },
      uExposure: { value: 0.75 },
      uHazeColor: { value: new THREE.Color(0.05, 0.03, 0.018) },
    },
  });
  const mesh = named(sector(), "Panorama");
  mesh.material = material;
  // Behind everything of the studio, like the city.
  mesh.renderOrder = -1;
  const group = named(new THREE.Group(), "Casino Panorama", true);
  group.userData.auditIgnore = true;
  group.add(mesh);

  const update = (time: number) => {
    const uniform = material.uniforms.uTime;
    if (uniform) {
      uniform.value = time;
    }
  };
  return { group, update };
}

export { createCasinoPanorama };
