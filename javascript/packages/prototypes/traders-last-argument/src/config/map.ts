const MAP_CONFIG = {
  width: 100,
  height: 100,
  tileSize: 50,

  // Perlin noise
  seed: undefined as number | undefined,

  // Thresholds
  mountainThreshold: 0.45,
  treeThreshold: 0.6,
  stoneThreshold: 0.35,

  // Camera
  minZoom: 0.2,
  maxZoom: 2.0,
  defaultZoom: 1.0,
};

const PAWN_CONFIG = {
  initialCount: 5,
  speed: 1.0,
  maxHealth: 100,
  spawnRadius: 20,
  idleDuration: 1.0,
};

export { MAP_CONFIG, PAWN_CONFIG };
