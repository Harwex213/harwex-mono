import { scaleResources } from "./resources";
import type { TBuildingDef, TBuildingKind } from "./building-def";
import type { TResources } from "./resources";

type TBuildingStatus = "construction" | "active";

/** Plain data of a building, for saving or for `new Building(data)`. */
type TBuildingData = {
  id: string;
  kind: TBuildingKind;
  tileKey: string;
  level: number;
  /** Turns until the building starts to work. `0` means it works. */
  turnsLeft: number;
  /** The turn it was placed on. */
  placedOn: number;
};

let nextId = 1;

/**
 * One building on one tile. Immutable: every change returns a new instance,
 * so a settlement can be held in a signal and swapped as a whole.
 */
class Building {
  readonly id: string;
  readonly def: TBuildingDef;
  readonly tileKey: string;
  readonly level: number;
  readonly turnsLeft: number;
  readonly placedOn: number;

  constructor(def: TBuildingDef, data: Omit<TBuildingData, "kind"> & { kind?: TBuildingKind }) {
    if (data.kind !== undefined && data.kind !== def.id) {
      throw new Error(`Building data kind ${data.kind} does not match def ${def.id}`);
    }

    this.def = def;
    this.id = data.id;
    this.tileKey = data.tileKey;
    this.level = data.level;
    this.turnsLeft = data.turnsLeft;
    this.placedOn = data.placedOn;
  }

  /** A fresh level-1 building at the start of its construction. */
  static place(def: TBuildingDef, tileKey: string, turn: number) {
    const id = `${def.id}-${nextId}`;
    nextId += 1;

    return new Building(def, { id, tileKey, level: 1, turnsLeft: def.buildTurns, placedOn: turn });
  }

  get kind() {
    return this.def.id;
  }

  get label() {
    return this.def.label;
  }

  get status(): TBuildingStatus {
    return this.turnsLeft > 0 ? "construction" : "active";
  }

  get isActive() {
    return this.turnsLeft === 0;
  }

  get canUpgrade() {
    return this.isActive && this.level < this.def.maxLevel;
  }

  /** What the next level costs, or `null` at the top level. */
  get upgradeCost(): TResources | null {
    if (this.level >= this.def.maxLevel) {
      return null;
    }

    return scaleResources(this.def.cost, this.level + 1);
  }

  /** Gained per turn once active. Under construction it yields nothing. */
  get production(): TResources {
    if (!this.isActive) {
      return scaleResources(this.def.produces, 0);
    }

    return scaleResources(this.def.produces, this.level);
  }

  /** Science points per turn once active. */
  get science() {
    return this.isActive ? this.def.science * this.level : 0;
  }

  /** People this building houses once active. */
  get housing() {
    return this.isActive ? this.def.housing * this.level : 0;
  }

  /** One turn of construction passes. An active building is returned as is. */
  advance() {
    if (this.isActive) {
      return this;
    }

    return this.with({ turnsLeft: this.turnsLeft - 1 });
  }

  upgraded() {
    if (!this.canUpgrade) {
      throw new Error(`${this.id} cannot be upgraded`);
    }

    return this.with({ level: this.level + 1 });
  }

  toData(): TBuildingData {
    return {
      id: this.id,
      kind: this.kind,
      tileKey: this.tileKey,
      level: this.level,
      turnsLeft: this.turnsLeft,
      placedOn: this.placedOn,
    };
  }

  private with(patch: Partial<Omit<TBuildingData, "kind">>) {
    return new Building(this.def, { ...this.toData(), ...patch });
  }
}

export type { TBuildingData, TBuildingStatus };
export { Building };
