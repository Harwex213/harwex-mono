import * as THREE from "three";

// Flat static light for the Scene view, so the set reads well while editing:
// the game lights go dark, a sky/ground fill and two fixed sun lights take over,
// the beam cones hide, the mirror floor is swapped for a matte one, and bloom is off.
// Metals (all the gold) take almost no light from lamps: their color is the reflected environment.
// The game environment is a dark room with a few bright panels, so one face of a column reflects
// a panel and turns gold, while the next face reflects the dark and turns black.
// Here the environment is a soft even sky, so metals read evenly from every side.
// A material with its own environment map (`userData.ownEnvironment`, the balcony in annex.ts) gets the sky as that map.
//
// The swap only lasts for one frame: `begin` runs right before the render and `end` right after it,
// so the inspector and saves never see the changed values.
// The game lights are dimmed to 0 instead of hidden, and the editor lights stay in the scene at 0 in the
// game lighting: the number of lights never changes, so three.js never recompiles the shaders.

// Bright sky above, lighter horizon, darker ground, all near neutral: like Unity's default Scene view skybox.
function createEditorEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const geometry = new THREE.SphereGeometry(10, 64, 32);
  const position = geometry.getAttribute("position");
  const colors: number[] = [];
  const sky = new THREE.Color(0.9, 0.93, 1.0);
  const horizon = new THREE.Color(0.75, 0.74, 0.72);
  const ground = new THREE.Color(0.28, 0.27, 0.25);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const height = position.getY(i) / 10;
    if (height >= 0) {
      color.lerpColors(horizon, sky, Math.sqrt(height));
    } else {
      color.lerpColors(horizon, ground, Math.sqrt(-height));
    }
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  geometry.dispose();
  return texture;
}

interface Stash {
  light: THREE.Light;
  intensity: number;
}

const EDITOR_LIGHTS: { light: THREE.Light; intensity: number }[] = [
  { light: new THREE.HemisphereLight(0xdde6ff, 0x4a453d), intensity: 2.0 },
  { light: new THREE.DirectionalLight(0xfff6ea), intensity: 1.8 },
  { light: new THREE.DirectionalLight(0xdfe8ff), intensity: 0.8 },
];

class EditorLighting {
  private readonly root: THREE.Object3D;
  private readonly scene: THREE.Scene;
  private readonly mirror: THREE.Object3D;
  private readonly floor: THREE.Mesh;
  private readonly matteFloor = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 1, metalness: 0 });
  private readonly stash: Stash[] = [];
  private readonly beams: THREE.Object3D[] = [];
  private readonly ownMaps: { material: THREE.MeshStandardMaterial; map: THREE.Texture | null }[] = [];
  private floorMaterial: THREE.Material | THREE.Material[] | null = null;
  private mirrorVisible = true;
  private readonly environment: THREE.Texture;
  private gameEnvironment: THREE.Texture | null = null;
  private environmentIntensity = 1;
  private active = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, root: THREE.Object3D, mirror: THREE.Object3D, floor: THREE.Mesh) {
    this.environment = createEditorEnvironment(renderer);
    this.scene = scene;
    this.root = root;
    this.mirror = mirror;
    this.floor = floor;
    const [, key, fill] = EDITOR_LIGHTS;
    // Fixed suns: the key shines from the front right, the fill from the back left.
    key?.light.position.set(12, 30, 20);
    fill?.light.position.set(-15, 20, -25);
    for (const { light } of EDITOR_LIGHTS) {
      light.name = "Editor Light";
      light.intensity = 0;
      scene.add(light);
    }
  }

  begin(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.stash.length = 0;
    this.beams.length = 0;
    this.ownMaps.length = 0;
    this.root.traverse((object) => {
      const light = object as THREE.Light;
      if (light.isLight) {
        this.stash.push({ light, intensity: light.intensity });
        light.intensity = 0;
      }
      if (object.userData.beam && object.visible) {
        this.beams.push(object);
        object.visible = false;
      }
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const standard = material as THREE.MeshStandardMaterial;
          if (standard.userData.ownEnvironment && !this.ownMaps.some((item) => item.material === standard)) {
            this.ownMaps.push({ material: standard, map: standard.envMap });
            standard.envMap = this.environment;
          }
        }
      }
    });
    for (const { light, intensity } of EDITOR_LIGHTS) {
      light.intensity = intensity;
    }
    this.mirrorVisible = this.mirror.visible;
    this.mirror.visible = false;
    this.floorMaterial = this.floor.material;
    this.floor.material = this.matteFloor;
    this.gameEnvironment = this.scene.environment;
    this.environmentIntensity = this.scene.environmentIntensity;
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 1;
  }

  end(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    for (const { light, intensity } of this.stash) {
      light.intensity = intensity;
    }
    for (const { light } of EDITOR_LIGHTS) {
      light.intensity = 0;
    }
    for (const beam of this.beams) {
      beam.visible = true;
    }
    for (const { material, map } of this.ownMaps) {
      material.envMap = map;
    }
    this.mirror.visible = this.mirrorVisible;
    if (this.floorMaterial) {
      this.floor.material = this.floorMaterial;
    }
    this.scene.environment = this.gameEnvironment;
    this.scene.environmentIntensity = this.environmentIntensity;
  }
}

export { EditorLighting };
