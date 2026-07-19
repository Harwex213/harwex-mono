import {
  UNIT_TYPE_ARCHER,
  UNIT_TYPE_CROSSBOWMAN,
  UNIT_TYPE_HEAVY_CAVALRY,
  UNIT_TYPE_HEAVY_INFANTRY,
  UNIT_TYPE_HORSE_ARCHER,
  UNIT_TYPE_LIGHT_CAVALRY,
  UNIT_TYPE_LIGHT_INFANTRY,
  UNIT_TYPE_LONGBOWMAN,
  UNIT_TYPE_MEDIUM_CAVALRY,
  UNIT_TYPE_MEDIUM_INFANTRY
} from "../data/catalog.js";

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

const nextActiveUnitGroup = (units = []) => {
  // TODO
};

export {
  createActiveUnitGroup,
  nextActiveUnitGroup,

  ACTIVE_UNIT_GROUP_SIDE,
  ACTIVE_UNIT_GROUP_TYPE,
};