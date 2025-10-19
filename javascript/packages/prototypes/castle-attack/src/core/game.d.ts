/**
 *
 * - скорость атаки (в сек?)
 * - урон за атаку
 * - дальность атаки
 */
type TUnitRangedAttack = {
  attackSpeed: number;
  damage: number;
  attackRange: number;
};

type UnitType = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewRange: number;
  maxHp: number;
  hpRegen: number;
  armor: number;
};

type TRaceType = {};

/**
 * For now, let it be as plain square, but in future defining some polygon would be interesting
 */
type TBuildingZoneType = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TMapStructureType = {
  /**
   * In pixels
   */
  width: number;

  /**
   * In pixels
   */
  height: number;

  buildingZones: TBuildingZoneType[];

  /**
   * Polygon
   */
  road: number[];
};

type TGameConfig = {
  raceTypes: TRaceType[];
  mapStructure: TMapStructureType;
};