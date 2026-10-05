import * as THREE from "three";
import { named } from "./geometry";
import type { Materials } from "./materials";
import { drum, mesh, slab } from "./props";
import { CENTER_BAY, inFrontOfBay } from "./studio";

// Buffet in front of the left drapes: an Art Deco sideboard (navy body with gold flutes, gold band,
// black marble top) with a three-tier cake, a champagne tower, a fruit platter, a chafing dish,
// a canapé tray, an ice bucket with a bottle, a vase of flowers and a globe lamp.
//
// Like the lounge furniture, the buffet is modelled at human size and scaled up as a whole, so every
// contact stays exact. In the buffet frame the back faces the drapes (-z), the front faces the room (+z),
// and the table top is y = TOP. Every part is stacked from the floor or from the part under it;
// round things that rest on a flat surface (fruit, flowers, the cake topper) are `seated`.

const BUFFET_SCALE = 2.0;
const TOP = 0.86;

// The buffet stands in front of the first left drape (bay CENTER_BAY - 2, 3.0 m from the wall).
// The drape folds reach 0.2 m off the drape, so the buffet back (offset 3.3 m) keeps 0.1 m clear of them.
// The front (offset 4.3 m) stays 6 cm outside the 15.1 m inlay ring.
const BAY = CENTER_BAY - 2;
const ALONG = -1.3;
const OFFSET = 3.8;

function material(name: string, parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const result = new THREE.MeshStandardMaterial(parameters);
  result.name = name;
  return result;
}

function createBuffetMaterials() {
  return {
    silver: material("buffetSilver", { color: 0xd8dde3, metalness: 1, roughness: 0.22 }),
    cream: material("buffetCream", { color: 0xf2e6cf, roughness: 0.7 }),
    cherry: material("buffetCherry", { color: 0xb3121f, roughness: 0.35 }),
    orange: material("buffetOrange", { color: 0xe07a1f, roughness: 0.55 }),
    apple: material("buffetApple", { color: 0x6cab3a, roughness: 0.45 }),
    grape: material("buffetGrape", { color: 0x5b2a6e, roughness: 0.35 }),
    pineapple: material("buffetPineapple", { color: 0xc8962e, roughness: 0.75 }),
    leaf: material("buffetLeaf", { color: 0x2f6a2a, roughness: 0.6 }),
    bread: material("buffetBread", { color: 0xd9b37a, roughness: 0.8 }),
    champagne: material("buffetChampagne", { color: 0xf0d58a, roughness: 0.1, transparent: true, opacity: 0.75 }),
    glass: material("buffetGlass", { color: 0xe8f2ff, roughness: 0.05, transparent: true, opacity: 0.35 }),
    bottle: material("buffetBottle", { color: 0x173b22, roughness: 0.2, metalness: 0.1 }),
    flowers: material("buffetFlowers", { color: 0xf3eee0, roughness: 0.8 }),
  };
}

type BuffetMaterials = ReturnType<typeof createBuffetMaterials>;

function at<T extends THREE.Object3D>(object: T, x: number, z: number): T {
  object.position.x = x;
  object.position.z = z;
  return object;
}

// A sphere that rests on a flat surface at `surface`, sunk by 15 % of its radius.
function restingSphere(name: string, radius: number, material: THREE.Material, x: number, surface: number, z: number): THREE.Mesh {
  const sphere = mesh(name, new THREE.SphereGeometry(radius, 16, 12), material, x, surface + radius * 0.85, z);
  sphere.userData.seated = true;
  return sphere;
}

function createSideboard(materials: Materials): THREE.Group {
  const sideboard = named(new THREE.Group(), "Sideboard");
  sideboard.add(slab("Base", 1.8, 0, 0.06, -0.23, 0.23, materials.goldPolished));
  sideboard.add(slab("Body", 1.72, 0.06, 0.79, -0.2, 0.2, materials.navy));
  // Gold flutes stand on the body front.
  const flutes = named(new THREE.Group(), "Flutes");
  const count = 18;
  for (let i = 0; i < count; i++) {
    const x = -0.81 + (1.62 * i) / (count - 1);
    flutes.add(slab(`Flute ${i + 1}`, 0.03, 0.09, 0.76, 0.2, 0.212, materials.gold, x));
  }
  sideboard.add(flutes);
  sideboard.add(slab("Band", 1.76, 0.79, 0.82, -0.21, 0.21, materials.goldPolished));
  sideboard.add(slab("Top", 1.84, 0.82, TOP, -0.25, 0.25, materials.marble));
  return sideboard;
}

function createCake(m: BuffetMaterials, materials: Materials): THREE.Group {
  const cake = named(new THREE.Group(), "Cake");
  cake.add(drum("Board", 0.2, 0.2, TOP, TOP + 0.01, materials.goldPolished, 48));
  const tiers = [
    { radius: 0.17, height: 0.12 },
    { radius: 0.12, height: 0.1 },
    { radius: 0.08, height: 0.08 },
  ];
  let y = TOP + 0.01;
  for (const [index, tier] of tiers.entries()) {
    cake.add(drum(`Tier ${index + 1}`, tier.radius, tier.radius, y, y + tier.height, m.cream, 48));
    // A gold ribbon around the middle of each tier, 1.5 mm off its side.
    const ribbon = mesh(`Ribbon ${index + 1}`, new THREE.TorusGeometry(tier.radius + 0.008 + 0.0015, 0.008, 8, 64), materials.goldPolished, 0, y + tier.height / 2, 0);
    ribbon.rotation.x = Math.PI / 2;
    cake.add(ribbon);
    y += tier.height;
  }
  cake.add(restingSphere("Cherry", 0.03, m.cherry, 0, y, 0));
  return cake;
}

// A coupe: a foot, a stem and a bowl of champagne.
function createCoupe(index: number, m: BuffetMaterials, base: number): THREE.Group {
  const coupe = named(new THREE.Group(), `Coupe ${index}`);
  coupe.add(drum("Foot", 0.025, 0.025, base, base + 0.004, m.glass, 16));
  coupe.add(drum("Stem", 0.004, 0.004, base + 0.004, base + 0.054, m.glass, 8));
  coupe.add(drum("Bowl", 0.035, 0.02, base + 0.054, base + 0.084, m.champagne, 20));
  return coupe;
}

// Three stand plates on a split post, with rings of coupes on the lower two and one coupe on top.
function createChampagneTower(m: BuffetMaterials, materials: Materials): THREE.Group {
  const tower = named(new THREE.Group(), "Champagne Tower");
  const levels = [
    { plate: 0.16, bottom: TOP, ring: 0.11, count: 7 },
    { plate: 0.11, bottom: 0.98, ring: 0.07, count: 5 },
    { plate: 0.06, bottom: 1.09, ring: 0, count: 1 },
  ];
  let coupeIndex = 0;
  for (const [index, level] of levels.entries()) {
    const plateTop = level.bottom + (index === 0 ? 0.015 : 0.01);
    tower.add(drum(`Plate ${index + 1}`, level.plate, level.plate, level.bottom, plateTop, materials.goldPolished, 40));
    const next = levels[index + 1];
    if (next) {
      tower.add(drum(`Post ${index + 1}`, 0.012, 0.012, plateTop, next.bottom, materials.gold, 12));
    }
    for (let i = 0; i < level.count; i++) {
      coupeIndex += 1;
      const angle = (i / level.count) * Math.PI * 2;
      tower.add(at(createCoupe(coupeIndex, m, plateTop), Math.sin(angle) * level.ring, Math.cos(angle) * level.ring));
    }
  }
  return tower;
}

function createFruitPlatter(m: BuffetMaterials, materials: Materials): THREE.Group {
  const platter = named(new THREE.Group(), "Fruit Platter");
  const plateTop = TOP + 0.015;
  platter.add(drum("Platter", 0.17, 0.17, TOP, plateTop, materials.goldPolished, 48));
  const fruit: [string, number, THREE.Material, number, number][] = [
    ["Orange 1", 0.035, m.orange, -0.09, 0.06],
    ["Orange 2", 0.035, m.orange, -0.02, 0.11],
    ["Orange 3", 0.035, m.orange, 0.1, 0.07],
    ["Apple 1", 0.033, m.apple, 0.09, -0.06],
    ["Apple 2", 0.033, m.apple, -0.1, -0.05],
  ];
  for (const [name, radius, fruitMaterial, x, z] of fruit) {
    platter.add(restingSphere(name, radius, fruitMaterial, x, plateTop, z));
  }
  // Grapes: a low pyramid of small berries.
  const grapes = named(new THREE.Group(), "Grapes");
  const berry = 0.014;
  for (const [x, z] of [[0, -0.12], [0.026, -0.12], [0.013, -0.098], [0.013, -0.142]] as const) {
    grapes.add(restingSphere("Berry", berry, m.grape, x, plateTop, z));
  }
  grapes.add(restingSphere("Berry", berry, m.grape, 0.013, plateTop + berry * 1.2, -0.12));
  platter.add(grapes);
  // Pineapple in the middle, with a crown of leaves.
  const pineapple = mesh("Pineapple", new THREE.SphereGeometry(0.045, 16, 12).scale(1, 1.6, 1), m.pineapple, 0, plateTop + 0.045 * 1.6 * 0.9, 0);
  pineapple.userData.seated = true;
  platter.add(pineapple);
  const crownBase = pineapple.position.y + 0.045 * 1.6 - 0.01;
  const crown = mesh("Crown", new THREE.ConeGeometry(0.03, 0.08, 10), m.leaf, 0, crownBase + 0.04, 0);
  crown.userData.seated = true;
  platter.add(crown);
  return platter;
}

// A silver chafing dish: a base and a half-round lid lying on it.
function createChafingDish(m: BuffetMaterials): THREE.Group {
  const dish = named(new THREE.Group(), "Chafing Dish");
  const width = 0.26;
  const depth = 0.18;
  const baseTop = TOP + 0.06;
  dish.add(slab("Base", width, TOP, baseTop, -depth / 2, depth / 2, m.silver));
  const lidGeometry = new THREE.CylinderGeometry(depth / 2, depth / 2, width, 24, 1, false, 0, Math.PI);
  lidGeometry.rotateZ(Math.PI / 2);
  dish.add(mesh("Lid", lidGeometry, m.silver, 0, baseTop, 0));
  dish.add(restingSphere("Handle", 0.015, m.silver, 0, baseTop + depth / 2, 0));
  return dish;
}

function createCanapeTray(m: BuffetMaterials): THREE.Group {
  const tray = named(new THREE.Group(), "Canape Tray");
  const trayTop = TOP + 0.01;
  tray.add(slab("Tray", 0.28, TOP, trayTop, -0.08, 0.08, m.silver));
  let index = 0;
  for (const x of [-0.09, 0, 0.09]) {
    for (const z of [-0.04, 0.04]) {
      index += 1;
      const canape = named(new THREE.Group(), `Canape ${index}`);
      canape.add(drum("Bread", 0.022, 0.022, trayTop, trayTop + 0.02, m.bread, 16));
      canape.add(drum("Topping", 0.012, 0.012, trayTop + 0.02, trayTop + 0.03, index % 2 === 0 ? m.cherry : m.leaf, 12));
      tray.add(at(canape, x, z));
    }
  }
  return tray;
}

// An open silver bucket with a bottle of champagne standing on its floor.
function createIceBucket(m: BuffetMaterials, materials: Materials): THREE.Group {
  const bucket = named(new THREE.Group(), "Ice Bucket");
  const floorTop = TOP + 0.01;
  bucket.add(drum("Floor", 0.07, 0.07, TOP, floorTop, m.silver, 32));
  const wallGeometry = new THREE.CylinderGeometry(0.09, 0.07, 0.2, 32, 1, true);
  const wall = mesh("Wall", wallGeometry, m.silver, 0, floorTop + 0.1, 0);
  wall.material = m.silver.clone();
  (wall.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  (wall.material as THREE.MeshStandardMaterial).name = "buffetSilverOpen";
  bucket.add(wall);
  const bottle = named(new THREE.Group(), "Bottle");
  const bodyTop = floorTop + 0.2;
  bottle.add(drum("Body", 0.035, 0.035, floorTop, bodyTop, m.bottle, 20));
  bottle.add(drum("Shoulder", 0.013, 0.035, bodyTop, bodyTop + 0.04, m.bottle, 20));
  bottle.add(drum("Neck", 0.013, 0.013, bodyTop + 0.04, bodyTop + 0.11, m.bottle, 12));
  bottle.add(drum("Foil", 0.015, 0.015, bodyTop + 0.11, bodyTop + 0.14, materials.goldPolished, 12));
  bucket.add(bottle);
  return bucket;
}

function createVase(m: BuffetMaterials, materials: Materials): THREE.Group {
  const vase = named(new THREE.Group(), "Vase");
  const top = TOP + 0.12;
  vase.add(drum("Pot", 0.04, 0.03, TOP, top, materials.goldPolished, 24));
  const blooms: [number, number][] = [[0, 0], [0.035, 0.01], [-0.03, 0.02], [0.01, -0.035], [-0.015, -0.02]];
  for (const [index, [x, z]] of blooms.entries()) {
    vase.add(restingSphere(`Bloom ${index + 1}`, 0.04, m.flowers, x, top, z));
  }
  return vase;
}

function createGlobeLamp(materials: Materials): THREE.Group {
  const lamp = named(new THREE.Group(), "Globe Lamp");
  lamp.add(drum("Base", 0.05, 0.05, TOP, TOP + 0.03, materials.goldPolished, 24));
  lamp.add(drum("Neck", 0.012, 0.012, TOP + 0.03, TOP + 0.09, materials.gold, 12));
  const globe = mesh("Globe", new THREE.SphereGeometry(0.06, 24, 16), materials.lampGlobe, 0, TOP + 0.09 + 0.06 - 0.008, 0);
  globe.castShadow = false;
  globe.userData.seated = true;
  lamp.add(globe);
  return lamp;
}

function createBuffet(materials: Materials): THREE.Group {
  const m = createBuffetMaterials();
  const buffet = named(new THREE.Group(), "Buffet");
  buffet.add(createSideboard(materials));
  // Along the top, left to right as seen from the room.
  buffet.add(at(createGlobeLamp(materials), -0.82, -0.12));
  buffet.add(at(createVase(m, materials), -0.82, 0.12));
  buffet.add(at(createCake(m, materials), -0.55, 0));
  buffet.add(at(createChafingDish(m), -0.2, -0.1));
  buffet.add(at(createCanapeTray(m), -0.2, 0.13));
  buffet.add(at(createFruitPlatter(m, materials), 0.12, 0.05));
  buffet.add(at(createChampagneTower(m, materials), 0.5, 0));
  buffet.add(at(createIceBucket(m, materials), 0.83, 0));

  inFrontOfBay(buffet, BAY, ALONG, OFFSET);
  buffet.scale.setScalar(BUFFET_SCALE);
  return buffet;
}

export { createBuffet };
