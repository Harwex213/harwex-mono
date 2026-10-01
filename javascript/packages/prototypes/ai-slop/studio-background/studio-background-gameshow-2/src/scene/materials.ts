import * as THREE from "three";

// Colours above 1.0 are intentional: they push the surface past the bloom threshold.
function createMaterials() {
  return {
    gold: new THREE.MeshStandardMaterial({
      name: "Gold",
      side: THREE.DoubleSide,
      color: 0xd09a45,
      metalness: 1,
      roughness: 0.26,
      // The scene environment is kept dim for the navy walls; gold picks up much more of it.
      envMapIntensity: 7,
    }),
    // Arch gold is only half metallic: pure metal shows nothing but the dim environment,
    // this one also takes the warm washes aimed at the arches.
    goldArch: new THREE.MeshStandardMaterial({
      name: "Gold Arch",
      side: THREE.DoubleSide,
      color: 0xc99540,
      metalness: 0.55,
      roughness: 0.32,
      envMapIntensity: 4,
    }),
    goldDark: new THREE.MeshStandardMaterial({
      name: "Gold Dark",
      side: THREE.DoubleSide,
      color: 0x8c5e22,
      metalness: 1,
      roughness: 0.38,
      envMapIntensity: 5,
    }),
    goldGlow: new THREE.MeshBasicMaterial({
      name: "Gold Glow",
      color: new THREE.Color(1.5, 0.9, 0.34),
    }),
    navyWall: new THREE.MeshStandardMaterial({
      name: "Navy Wall",
      side: THREE.DoubleSide,
      color: 0x0a1230,
      metalness: 0,
      roughness: 0.6,
    }),
    navyLacquer: new THREE.MeshStandardMaterial({
      name: "Navy Lacquer",
      color: 0x101a3a,
      metalness: 0.3,
      roughness: 0.22,
    }),
    blackMarble: new THREE.MeshStandardMaterial({
      name: "Black Marble",
      color: 0x0a0c16,
      metalness: 0.1,
      roughness: 0.16,
    }),
    floorGloss: new THREE.MeshStandardMaterial({
      name: "Floor Gloss",
      color: 0x060814,
      metalness: 0.1,
      roughness: 0.32,
      transparent: true,
      opacity: 0.7,
    }),
    ceiling: new THREE.MeshStandardMaterial({
      name: "Ceiling",
      color: 0x05070f,
      metalness: 0,
      roughness: 0.9,
    }),
    velvet: new THREE.MeshPhysicalMaterial({
      name: "Red Velvet",
      color: 0x7a0a18,
      emissive: 0x320409,
      metalness: 0,
      roughness: 0.75,
      sheen: 1,
      sheenColor: new THREE.Color(0xff3b4c),
      sheenRoughness: 0.45,
      side: THREE.DoubleSide,
    }),
    bulb: new THREE.MeshBasicMaterial({
      name: "Bulb",
      color: 0xffffff,
    }),
    lampGlobe: new THREE.MeshBasicMaterial({
      name: "Lamp Globe",
      color: new THREE.Color(1.3, 1.02, 0.74),
    }),
    spotLens: new THREE.MeshBasicMaterial({
      name: "Spot Lens",
      color: new THREE.Color(4, 3.3, 2.2),
    }),
    blueLens: new THREE.MeshBasicMaterial({
      name: "Blue Lens",
      color: new THREE.Color(1.2, 2.2, 6),
    }),
    fixture: new THREE.MeshStandardMaterial({
      name: "Fixture",
      color: 0x16171c,
      metalness: 0.7,
      roughness: 0.4,
    }),
    leaf: new THREE.MeshStandardMaterial({
      name: "Palm Leaf",
      color: 0x355f22,
      metalness: 0,
      roughness: 0.55,
      side: THREE.DoubleSide,
    }),
    trunk: new THREE.MeshStandardMaterial({
      name: "Palm Trunk",
      color: 0x4a3420,
      metalness: 0,
      roughness: 0.9,
    }),
    screen: new THREE.MeshBasicMaterial({
      name: "Screen",
      color: new THREE.Color(0.25, 0.4, 0.9),
    }),
    black: new THREE.MeshStandardMaterial({
      name: "Black Plastic",
      color: 0x050506,
      metalness: 0.2,
      roughness: 0.35,
    }),
  };
}

type StudioMaterials = ReturnType<typeof createMaterials>;

export { createMaterials };
export type { StudioMaterials };
