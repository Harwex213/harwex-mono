import type { GameConfig } from "@hw/ostrov-prototype-v2-config";
import { SCHEMA, config } from "@hw/ostrov-prototype-v2-config";
import type { Price } from "../economy/stock";
import { TRAIN_TIME_MIN_SEC, TRAIN_TIME_SPEEDUP } from "../tuning";

/**
 * The unit roster, read straight out of the config library, exactly the way
 * `buildings/catalog.ts` reads the buildings.
 *
 * Every unit in the roster is a unit the barracks trains, so the panel lists the
 * roster as it stands. A designer who adds a spearman gets it in the panel
 * without editing game code.
 */

type UnitId = keyof GameConfig["units"];

type UnitValues = GameConfig["units"][UnitId];

type UnitSpec = UnitValues & {
  id: UnitId;
  label: string;
  /** One paragraph from the schema, shown in the tooltip. */
  description: string;
};

function unitSpec(id: UnitId): UnitSpec {
  const entity = SCHEMA.units.entities[id];
  return { id, label: entity.label, description: entity.description, ...config.units[id] };
}

function unitLabel(id: UnitId): string {
  return SCHEMA.units.entities[id].label;
}

/** Every unit id the roster knows, in schema order. All of them are trainable. */
function allUnitIds(): UnitId[] {
  return Object.keys(config.units) as UnitId[];
}

/** What one of these costs to train. Unlike a building, a unit eats. */
function unitPrice(id: UnitId): Price {
  const values = config.units[id];
  return { food: values.costFood, wood: values.costWood, gold: values.costGold };
}

/** How many places of the army limit one of these takes up. */
function unitArmyCost(id: UnitId): number {
  return config.units[id].armyCost;
}

/**
 * How long this unit takes to train in the prototype, in seconds. The config
 * number is balance time; the demo cannot sit through half a minute of it.
 */
function trainingSeconds(id: UnitId): number {
  return Math.max(TRAIN_TIME_MIN_SEC, config.units[id].trainTimeSec / TRAIN_TIME_SPEEDUP);
}

/** How fast this unit walks, in world units per second. */
function unitSpeed(id: UnitId, hexStep: number): number {
  return config.units[id].moveSpeed * config.army.moveSpeedScale * hexStep;
}

export type { UnitId, UnitSpec, UnitValues };
export {
  allUnitIds,
  trainingSeconds,
  unitArmyCost,
  unitLabel,
  unitPrice,
  unitSpec,
  unitSpeed,
};
