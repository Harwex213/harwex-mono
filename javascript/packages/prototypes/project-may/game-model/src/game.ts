import type { TUnit } from "./unit.js";
import type { TMoveUnitProps, TSpawnUnitProps } from "./game-types";

class Game {
  currentTick: number;
  readonly rows: number;
  readonly cols: number;

  nextUnitId: number;
  unitMap: Map<number, TUnit>;
  currentMovedUnits: TUnit[];

  constructor(rows: number, cols: number) {
    this.currentTick = 0;
    this.rows = rows;
    this.cols = cols;

    this.nextUnitId = 0;
    this.unitMap = new Map();
    this.currentMovedUnits = [];
  }

  spawnUnit(props: TSpawnUnitProps) {
    // TODO: validation

    const unit: TUnit = {
      id: this.nextUnitId++,
      movementPath: [],

      ...props,
    };

    this.unitMap.set(unit.id, unit);

    return unit;
  }

  moveUnit(props: TMoveUnitProps) {
    // TODO: validation
    const {
      unitId,
      targetX,
      targetY,
    } = props;

    const unit = this.unitMap.get(unitId);
    if (!unit) {
      // TODO: validation

      return;
    }

    const currentUnitMove: [number, number] = [unit.x, unit.y];

    while (currentUnitMove[0] !== targetX && currentUnitMove[1] !== targetY) {
      if (targetX > currentUnitMove[0]) {
        currentUnitMove[0]++;
      } else if (targetX < currentUnitMove[0]) {
        currentUnitMove[0]--;
      }

      if (targetY > currentUnitMove[1]) {
        currentUnitMove[1]++;
      } else if (targetY < currentUnitMove[1]) {
        currentUnitMove[1]--;
      }

      unit.movementPath.push(currentUnitMove.slice() as [number, number]);
    }

    this.currentMovedUnits.push(unit);
  }

  nextTick() {
    this.#doUnitsMove();

    this.currentTick++;
  }

  #doUnitsMove() {
    const nextMovedUnits: TUnit[] = [];
    for (const currentMovedUnit of this.currentMovedUnits) {
      const nextPosition = currentMovedUnit.movementPath.shift()!;

      currentMovedUnit.x = nextPosition[0];
      currentMovedUnit.y = nextPosition[1];

      if (currentMovedUnit.movementPath.length !== 0) {
        nextMovedUnits.push(currentMovedUnit);
      }
    }
    this.currentMovedUnits = nextMovedUnits;
  }
}

export { Game };
