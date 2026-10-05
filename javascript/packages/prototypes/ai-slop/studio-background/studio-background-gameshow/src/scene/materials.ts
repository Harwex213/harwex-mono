import * as THREE from "three";

// HDR color for unlit emitters: values above 1 feed the bloom pass.
function glow(hex: number, strength: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(strength);
}

function createMaterials() {
  const materials = {
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a24c, metalness: 1, roughness: 0.27 }),
    goldPolished: new THREE.MeshStandardMaterial({ color: 0xf2c46a, metalness: 1, roughness: 0.16 }),
    goldDark: new THREE.MeshStandardMaterial({ color: 0x8c6226, metalness: 1, roughness: 0.38 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x0b1126, metalness: 0.1, roughness: 0.78 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0x05070f, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }),
    marble: new THREE.MeshStandardMaterial({ color: 0x0b0e1c, metalness: 0.15, roughness: 0.16 }),
    navy: new THREE.MeshStandardMaterial({ color: 0x0c1a44, metalness: 0.35, roughness: 0.32 }),
    velvet: new THREE.MeshPhysicalMaterial({
      color: 0x4a0510,
      roughness: 0.85,
      sheen: 1,
      sheenColor: new THREE.Color(0xff3347),
      sheenRoughness: 0.45,
      side: THREE.DoubleSide,
    }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x2c6a2a, roughness: 0.55, side: THREE.DoubleSide }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5a4024, roughness: 0.8 }),
    screen: new THREE.MeshBasicMaterial({ color: glow(0x5a7dff, 1.4) }),
    bulb: new THREE.MeshBasicMaterial({ color: glow(0xffe2a8, 3) }),
    led: new THREE.MeshBasicMaterial({ color: glow(0xffa548, 1.5) }),
    // Frosted globes: just above the bloom threshold, so they glow without a milky halo.
    lampGlobe: new THREE.MeshBasicMaterial({ color: glow(0xffe6c0, 1.25) }),
    fixture: new THREE.MeshBasicMaterial({ color: glow(0xfff1d6, 2) }),
    fixtureBlue: new THREE.MeshBasicMaterial({ color: glow(0x6c93ff, 9) }),
  };
  // The editor lists and saves shared materials by name.
  for (const [name, material] of Object.entries(materials)) {
    material.name = name;
  }
  return materials;
}

type Materials = ReturnType<typeof createMaterials>;

// A small dark room with warm and blue light panels: metals need it to read as gold instead of black.
function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const room = new THREE.Scene();
  room.background = new THREE.Color(0x020309);

  const addPanel = (color: THREE.Color, width: number, height: number, position: THREE.Vector3) => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    panel.position.copy(position);
    panel.lookAt(0, 0, 0);
    room.add(panel);
  };

  // Warm ceiling ring, like the rows of stage fixtures.
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    addPanel(glow(0xffc27a, 3.5), 1.6, 0.5, new THREE.Vector3(Math.cos(angle) * 6, 5, Math.sin(angle) * 6));
  }
  // Blue side washes.
  addPanel(glow(0x2f5bff, 2.2), 3, 6, new THREE.Vector3(-8, 1, -2));
  addPanel(glow(0x2f5bff, 2.2), 3, 6, new THREE.Vector3(8, 1, -2));
  // Warm floor bounce from the LED strips.
  addPanel(glow(0xff9a40, 1.2), 12, 1, new THREE.Vector3(0, -4, -6));
  addPanel(glow(0xfff2dd, 1.5), 4, 2, new THREE.Vector3(0, 2, 9));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.03).texture;
  pmrem.dispose();
  return texture;
}

export { glow, createMaterials, createEnvironment };
export type { Materials };
