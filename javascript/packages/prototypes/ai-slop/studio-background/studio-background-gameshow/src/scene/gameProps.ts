import * as THREE from "three";
import jesterFaceUrl from "../assets/game-jester-wheel-face.jpg";
import slotScreenUrl from "../assets/game-slot-screen.jpg";
import { glow } from "./materials";

// The three bonus games, each smaller than the hero wheel. They live in the scene file under `Game Props`:
// - "Bonus Show", the jester money wheel: it stands on the Game Show platform of the annex, before the casino hall;
// - "Bonus Dice", the acrylic plinko tower, and "Bonus Luck", the slot cabinet: they stand in the amphitheatre.
// This module keeps their materials.

function loadTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createGameMaterials() {
  const materials = {
    gameBrass: new THREE.MeshStandardMaterial({ color: 0xc89a4a, metalness: 1, roughness: 0.3 }),
    gameBrassDark: new THREE.MeshStandardMaterial({ color: 0x7a5626, metalness: 1, roughness: 0.4 }),
    gameWood: new THREE.MeshStandardMaterial({ color: 0x5a3219, metalness: 0, roughness: 0.55 }),
    gameBlack: new THREE.MeshStandardMaterial({ color: 0x07080c, metalness: 0.4, roughness: 0.25 }),
    gameGold: new THREE.MeshStandardMaterial({ color: 0xf0c060, metalness: 1, roughness: 0.2 }),
    gameChrome: new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 1, roughness: 0.15 }),
    gameAcrylic: new THREE.MeshPhysicalMaterial({
      color: 0xdfeeff,
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    gamePeg: new THREE.MeshStandardMaterial({ color: 0xeaf4ff, emissive: 0xbfdcff, emissiveIntensity: 0.6, roughness: 0.1 }),
    gameRed: new THREE.MeshStandardMaterial({ color: 0xc8202a, emissive: 0x500006, roughness: 0.35 }),
    gameBlue: new THREE.MeshStandardMaterial({ color: 0x2050d0, emissive: 0x081850, roughness: 0.35 }),
    gameGreen: new THREE.MeshStandardMaterial({ color: 0x20a040, emissive: 0x063010, roughness: 0.35 }),
  };
  for (const [name, material] of Object.entries(materials)) {
    material.name = name;
  }
  return materials;
}

// Canvas plaque text: the name of the tower.
function createPlaqueTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d canvas is unavailable");
  }
  ctx.fillStyle = "#c9ced6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#5c616a";
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = "#1e2228";
  ctx.font = "bold 64px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("THE TOWER of JOKER'S SNOW", canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The own materials of the bonus game parts: the printed jester wheel face and the bulbs on its arc,
// the tower plaque, the glowing case edges, the slot screen.
function createGamePropMaterials() {
  const screen = loadTexture(slotScreenUrl);
  const face = loadTexture(jesterFaceUrl);
  return {
    gameJesterFace: new THREE.MeshStandardMaterial({ map: face, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.22, roughness: 0.4 }),
    gameJesterBulb: new THREE.MeshBasicMaterial({ color: glow(0xffe2a8, 4) }),
    gameDicePlaque: new THREE.MeshStandardMaterial({ map: createPlaqueTexture(), metalness: 0.6, roughness: 0.3 }),
    gameDiceEdges: new THREE.LineBasicMaterial({ color: glow(0xdfefff, 3) }),
    gameSlotScreen: new THREE.MeshStandardMaterial({ map: screen, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 0.9, roughness: 0.3 }),
  };
}

export { createGameMaterials, createGamePropMaterials };
