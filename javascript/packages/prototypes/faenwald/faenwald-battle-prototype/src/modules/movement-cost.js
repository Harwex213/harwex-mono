/**
 * @param {TerrainDef} terrain
 * @param {TerrainClass} terrainClass
 * @returns {number}
 */
const entryCostFor = (terrain, terrainClass) => {
  const ec = terrain.entryCost;
  if (ec == null) {
    return 1;
  }
  if (typeof ec === "number") {
    return ec;
  }
  return ec[terrainClass] ?? ec.base ?? 1;
};

/**
 * MP cost to advance from `fromTerrain` to `toTerrain`. Not rounded — MP
 * arithmetic stays fractional per the accumulation rule.
 * @param {TerrainDef} fromTerrain
 * @param {TerrainDef} toTerrain
 * @param {UnitType} unitType
 * @returns {number}
 */
const advanceCost = (fromTerrain, toTerrain, unitType) => {
  const exitMult = fromTerrain.occupantMoveCostMult ?? 1;
  const entry = entryCostFor(toTerrain, unitType.terrainClass);
  const climbMult = (toTerrain.elevation ?? 0) > (fromTerrain.elevation ?? 0) ? 2 : 1;
  return exitMult * entry * climbMult;
};

/**
 * @param {number} baseSpeed
 * @param {TerrainDef} terrain
 * @param {UnitType} unitType
 * @returns {number}
 */
const effectiveSpeed = (baseSpeed, terrain, unitType) => {
  const delta = terrain.speedDelta?.[unitType.terrainClass] ?? 0;
  let speed = baseSpeed + delta;
  const cap = terrain.speedCap?.[unitType.terrainClass];
  if (cap != null) {
    speed = Math.min(speed, cap);
  }
  return Math.max(0, speed);
};

export { advanceCost, effectiveSpeed, entryCostFor };
