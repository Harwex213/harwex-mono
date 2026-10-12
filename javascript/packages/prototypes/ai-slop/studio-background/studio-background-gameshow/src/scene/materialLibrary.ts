import * as THREE from "three";
import { createAnnexMaterials, createDressingMaterials, styleAnnexFloor } from "./annexMaterials";
import { createCityMaterials } from "./city";
import { CasinoShading } from "./casinoShading";
import { createGameMaterials, createGamePropMaterials } from "./gameProps";
import { createCasinoEnvironment, createMaterials } from "./materials";
import type { Materials } from "./materials";
import { createWheelMaterials } from "./wheel";

// Every material the scene file can name, by key. A meshRenderer names its materials by these keys.
// A named lit material (MeshStandardMaterial) is shared and editable: its editable values live in the
// `materials` section of the scene file, by name. Textures, shaders and the other settings stay here, in code.

function standard(name: string, parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const result = new THREE.MeshStandardMaterial(parameters);
  result.name = name;
  return result;
}

function createBuffetMaterials(): THREE.Material[] {
  const silver = standard("buffetSilver", { color: 0xd8dde3, metalness: 1, roughness: 0.22 });
  const list = [
    silver,
    standard("buffetCream", { color: 0xf2e6cf, roughness: 0.7 }),
    standard("buffetCherry", { color: 0xb3121f, roughness: 0.35 }),
    standard("buffetOrange", { color: 0xe07a1f, roughness: 0.55 }),
    standard("buffetApple", { color: 0x6cab3a, roughness: 0.45 }),
    standard("buffetGrape", { color: 0x5b2a6e, roughness: 0.35 }),
    standard("buffetPineapple", { color: 0xc8962e, roughness: 0.75 }),
    standard("buffetLeaf", { color: 0x2f6a2a, roughness: 0.6 }),
    standard("buffetBread", { color: 0xd9b37a, roughness: 0.8 }),
    standard("buffetChampagne", { color: 0xf0d58a, roughness: 0.1, transparent: true, opacity: 0.75 }),
    standard("buffetGlass", { color: 0xe8f2ff, roughness: 0.05, transparent: true, opacity: 0.35 }),
    standard("buffetBottle", { color: 0x173b22, roughness: 0.2, metalness: 0.1 }),
    standard("buffetFlowers", { color: 0xf3eee0, roughness: 0.8 }),
  ];
  // The open ice bucket: silver seen from both sides.
  const open = silver.clone();
  open.side = THREE.DoubleSide;
  open.name = "buffetSilverOpen";
  list.push(open);
  return list;
}

function createLoungeMaterials(): THREE.Material[] {
  return [
    standard("flowers", { color: 0xf3eee0, roughness: 0.8 }),
    standard("glass", { color: 0xe8f2ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35 }),
    standard("satinGold", { color: 0xc9a050, roughness: 0.4, metalness: 0.4 }),
  ];
}

// Fine gold grid of floor tile joints: a decal on the marble, like the inlay rings.
function createFloorGridMaterial(): THREE.MeshStandardMaterial {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d canvas is unavailable");
  }
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(214, 170, 92, 0.55)";
  ctx.fillRect(0, 0, size, 3);
  ctx.fillRect(0, 0, 3, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  // 2 m tiles: the circle UVs run 0..1 across the diameter of the grid circle (radius 22 in the scene file).
  const radius = 22;
  texture.repeat.set(radius, radius);
  return standard("floorGrid", {
    map: texture,
    emissive: 0x6a4818,
    emissiveMap: texture,
    emissiveIntensity: 0.6,
    metalness: 0.6,
    roughness: 0.3,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
}

// The floor materials: the semi-transparent black marble over the mirror, the balcony part of it,
// and the gold inlay rings (decals that win the depth test by polygon offset).
function createFloorMaterials(materials: Materials, casinoEnvironment: THREE.Texture): THREE.Material[] {
  const marble = materials.marble.clone();
  marble.transparent = true;
  marble.opacity = 0.72;
  marble.name = "marbleFloor";
  // The balcony part: the warm veined marble of the casino photo, with the casino environment as its own map.
  const annexMarble = marble.clone();
  annexMarble.name = "marbleFloorAnnex";
  styleAnnexFloor(annexMarble);
  annexMarble.envMap = casinoEnvironment;
  const inlay = materials.goldPolished.clone();
  inlay.name = "goldInlay";
  inlay.polygonOffset = true;
  inlay.polygonOffsetFactor = -1;
  inlay.polygonOffsetUnits = -4;
  // A warm glow, like lit brass in the scene reference.
  inlay.emissive.set(0xffa040);
  inlay.emissiveIntensity = 0.55;
  return [marble, annexMarble, inlay];
}

class MaterialLibrary {
  readonly studio: Materials;
  // The warm environment of the casino hall: balcony and casino materials reflect it as their own map.
  readonly casinoEnvironment: THREE.Texture;
  // The casino materials with their shader of virtual lamps (the `casinoLighting` component drives it).
  readonly casino: CasinoShading;
  // Animates the city materials (the skyline lights texture and the time uniforms).
  readonly updateCity: (renderer: THREE.WebGLRenderer, time: number) => void;
  private readonly byKey = new Map<string, THREE.Material>();
  private readonly keys = new Map<THREE.Material, string>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.casinoEnvironment = createCasinoEnvironment(renderer);
    this.studio = createMaterials();
    this.addAll(this.studio);
    for (const material of createFloorMaterials(this.studio, this.casinoEnvironment)) {
      this.add(material.name, material);
    }
    this.addAll(createGameMaterials());
    this.addAll(createGamePropMaterials());
    this.addAll(createWheelMaterials());
    for (const material of [...createLoungeMaterials(), createFloorGridMaterial(), ...createBuffetMaterials()]) {
      this.add(material.name, material);
    }
    const annex = createAnnexMaterials();
    const dressing = createDressingMaterials();
    const { lit, ...dressingMaterials } = dressing;
    this.addAll(annex);
    this.addAll(dressingMaterials);
    for (const material of [...Object.values(annex), ...lit]) {
      material.envMap = this.casinoEnvironment;
    }
    this.casino = new CasinoShading();
    this.addAll(this.casino.materials);
    for (const material of this.casino.standard) {
      material.envMap = this.casinoEnvironment;
    }
    const city = createCityMaterials();
    this.add("citySkyline", city.citySkyline);
    this.add("cityWater", city.cityWater);
    this.updateCity = city.update;
  }

  get(key: string): THREE.Material | undefined {
    return this.byKey.get(key);
  }

  keyOf(material: THREE.Material): string | undefined {
    return this.keys.get(material);
  }

  private addAll(materials: Record<string, THREE.Material>): void {
    for (const [key, material] of Object.entries(materials)) {
      this.add(key, material);
    }
  }

  private add(key: string, material: THREE.Material): void {
    if (this.byKey.has(key)) {
      throw new Error(`two materials with the key ${key}`);
    }
    this.byKey.set(key, material);
    this.keys.set(material, key);
  }
}

export { MaterialLibrary };
