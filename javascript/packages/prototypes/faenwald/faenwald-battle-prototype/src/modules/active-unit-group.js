import {
  UNIT_TYPE_ARCHER,
  UNIT_TYPE_CROSSBOWMAN,
  UNIT_TYPE_HEAVY_CAVALRY,
  UNIT_TYPE_HEAVY_INFANTRY,
  UNIT_TYPE_HEAVY_SPEARMAN,
  UNIT_TYPE_HORSE_ARCHER,
  UNIT_TYPE_LIGHT_CAVALRY,
  UNIT_TYPE_LIGHT_INFANTRY,
  UNIT_TYPE_LIGHT_SPEARMAN,
  UNIT_TYPE_LONGBOWMAN,
  UNIT_TYPE_MEDIUM_CAVALRY,
  UNIT_TYPE_MEDIUM_INFANTRY,
  UNIT_TYPE_MEDIUM_SPEARMAN
} from "../data/unit.js";

const ACTIVE_UNIT_GROUP_SIDE = {
  ATTACKER: "attacker",
  DEFENDER: "defender",
};

const ACTIVE_UNIT_GROUP_TYPE = {
  CAVALRY: "cavalry",
  ARCHERS: "archers",
  SHOCK_INFANTRY: "shock-infantry",
  SPEARMEN: "spearmen",
};

const createActiveUnitGroup = (units = []) => {
  const activeUnityGroup = {
    /** `ACTIVE_UNIT_GROUP_SIDE` */
    side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER,
    /** `ACTIVE_UNIT_GROUP_TYPE` */
    type: ACTIVE_UNIT_GROUP_TYPE.CAVALRY,
  };

  if (units.length === 0) {
    return activeUnityGroup;
  }

  const hasCavalry = units.find((unit) => (
    unit.type === UNIT_TYPE_LIGHT_CAVALRY ||
    unit.type === UNIT_TYPE_HORSE_ARCHER ||
    unit.type === UNIT_TYPE_MEDIUM_CAVALRY ||
    unit.type === UNIT_TYPE_HEAVY_CAVALRY
  ));
  if (hasCavalry) {
    return activeUnityGroup;
  }

  const hasArchers = units.find((unit) => (
    unit.type === UNIT_TYPE_ARCHER ||
    unit.type === UNIT_TYPE_LONGBOWMAN ||
    unit.type === UNIT_TYPE_CROSSBOWMAN
  ));
  if (hasArchers) {
    activeUnityGroup.type = ACTIVE_UNIT_GROUP_TYPE.ARCHERS;
    return activeUnityGroup;
  }

  const hasShockInfantry = units.find((unit) => (
    unit.type === UNIT_TYPE_LIGHT_INFANTRY ||
    unit.type === UNIT_TYPE_MEDIUM_INFANTRY ||
    unit.type === UNIT_TYPE_HEAVY_INFANTRY
  ));
  if (hasShockInfantry) {
    activeUnityGroup.type = ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY;
    return activeUnityGroup;
  }

  activeUnityGroup.type = ACTIVE_UNIT_GROUP_TYPE.SPEARMEN;
  return activeUnityGroup;
};

const GROUP_UNIT_TYPES = {
  [ACTIVE_UNIT_GROUP_TYPE.CAVALRY]: [
    UNIT_TYPE_LIGHT_CAVALRY,
    UNIT_TYPE_MEDIUM_CAVALRY,
    UNIT_TYPE_HEAVY_CAVALRY,
    UNIT_TYPE_HORSE_ARCHER,
  ],
  [ACTIVE_UNIT_GROUP_TYPE.ARCHERS]: [
    UNIT_TYPE_ARCHER,
    UNIT_TYPE_LONGBOWMAN,
    UNIT_TYPE_CROSSBOWMAN,
  ],
  [ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY]: [
    UNIT_TYPE_LIGHT_INFANTRY,
    UNIT_TYPE_MEDIUM_INFANTRY,
    UNIT_TYPE_HEAVY_INFANTRY,
  ],
  [ACTIVE_UNIT_GROUP_TYPE.SPEARMEN]: [
    UNIT_TYPE_LIGHT_SPEARMAN,
    UNIT_TYPE_MEDIUM_SPEARMAN,
    UNIT_TYPE_HEAVY_SPEARMAN,
  ],
};
const GROUP_UNIT_KEYS = Object.keys(GROUP_UNIT_TYPES);

const getUnitGroupType = (unitType) => GROUP_UNIT_KEYS.find(
  (group) => GROUP_UNIT_TYPES[group].includes(unitType)
) ?? null;

// activation order: within each group type the defender acts first, then the attacker
const GROUP_CYCLE = [
  { side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER, type: ACTIVE_UNIT_GROUP_TYPE.CAVALRY },
  { side: ACTIVE_UNIT_GROUP_SIDE.ATTACKER, type: ACTIVE_UNIT_GROUP_TYPE.CAVALRY },
  { side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER, type: ACTIVE_UNIT_GROUP_TYPE.ARCHERS },
  { side: ACTIVE_UNIT_GROUP_SIDE.ATTACKER, type: ACTIVE_UNIT_GROUP_TYPE.ARCHERS },
  { side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER, type: ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY },
  { side: ACTIVE_UNIT_GROUP_SIDE.ATTACKER, type: ACTIVE_UNIT_GROUP_TYPE.SHOCK_INFANTRY },
  { side: ACTIVE_UNIT_GROUP_SIDE.DEFENDER, type: ACTIVE_UNIT_GROUP_TYPE.SPEARMEN },
  { side: ACTIVE_UNIT_GROUP_SIDE.ATTACKER, type: ACTIVE_UNIT_GROUP_TYPE.SPEARMEN },
];

const nextActiveUnitGroup = (activeUnitGroup, units = []) => {
  if (units.length === 0) {
    return { ...activeUnitGroup };
  }

  const currentIndex = GROUP_CYCLE.findIndex((group) => (
    group.side === activeUnitGroup.side && group.type === activeUnitGroup.type
  ));

  for (let step = 1; step <= GROUP_CYCLE.length; step += 1) {
    const candidate = GROUP_CYCLE[(currentIndex + step) % GROUP_CYCLE.length];
    const hasUnits = units.some((unit) => (
      unit.side === candidate.side && GROUP_UNIT_TYPES[candidate.type].includes(unit.type)
    ));
    if (hasUnits) {
      return { ...candidate };
    }
  }

  return { ...activeUnitGroup };
};

export {
  createActiveUnitGroup,
  nextActiveUnitGroup,
  getUnitGroupType,

  ACTIVE_UNIT_GROUP_SIDE,
  ACTIVE_UNIT_GROUP_TYPE,
};