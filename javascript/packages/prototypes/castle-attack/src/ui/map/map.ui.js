import { button, div } from "@hw/html-lib";
import { clsx } from "@hw/utils";
import { signal } from "@hw/signals";
import classes from "./map.module.css";

const UNITS_HORIZONTALLY = 100;
const UNITS_VERTICALLY = 10;

const UNIT_TYPE = {
  SOLDIER: "SOLDIER",
  ARCHER: "ARCHER",
  SPEARMAN: "SPEARMAN",
  CAVALRY: "CAVALRY",
};

const TEAM_1 = "TEAM_1";
const TEAM_2 = "TEAM_2";

const UNIT_TYPES = Object.values(UNIT_TYPE);

const spawnUnit = (units, type, team, row) => {
  const newUnits = { ...units.peek() };

  newUnits[newUnits._nextId++] = {
    col: team === TEAM_1 ? 0 : (UNITS_HORIZONTALLY - 1),
    row,
    type,
    team,
  };

  units.value = newUnits;
};

/* Ui */

const renderControlPanel = (unitsVertically, unitToSpawn, units, team) => {
  const style = {
    width: "calc(var(--unit-width) * 1)",
    height: `calc(var(--unit-height) * ${unitsVertically})`,
  }

  const container = div({ className: classes.controlPanelContainer, style });

  const spawns = [...Array(unitsVertically)].map((_, row) => {
    return button({
      className: classes.spawn,
      onClick: () => {
        if (!unitToSpawn.peek()) {
          return;
        }

        spawnUnit(units, unitToSpawn.peek(), team, row);
      }
    });
  });

  container.children(spawns);

  return container;
}

const renderUnitToSpawnPanel = (unitToSpawn) => {
  const container = div({ className: classes.unitToSpawnContainer });

  container.assocEffect(() => {
    const possibleUnitsToSpawn = UNIT_TYPES.map((unitType) => {
      const isActive = unitType === unitToSpawn.value;

      return button({
        key: unitType + isActive,
        className: clsx(classes.unitToSpawn, isActive && classes.active),
        onClick: () => {
          unitToSpawn.value = unitType;
        }
      }).content(unitType);
    });

    container.children(possibleUnitsToSpawn);
  });

  return container;
}

const renderGameMap = (units$) => {
  const container = div({ className: classes.map });

  container.assocEffect(() => {
    const unitsRender = [];
    const units = units$.value;

    for (const unitId in units) {
      if (unitId[0] === "_") {
        continue;
      }

      const unit = units[unitId];
      if (!unit) {
        continue;
      }

      const style = {
        "--unit-col": unit.col,
        "--unit-row": unit.row,
      };

      const key = `${unit.team}-${unit.row}-${unit.col}`;

      unitsRender.push(div({ key, className: classes.unit, style }));
    }

    container.children(unitsRender);
  });

  return container;
}

const renderMap = () => {
  const unitToSpawn = signal(null);
  const units = signal({ _nextId: 0 });

  const variables = {
    "--unit-width": "10px",
    "--unit-height": "10px",
    "--units-horizontally": UNITS_HORIZONTALLY,
    "--units-vertically": UNITS_VERTICALLY,
  }

  const layout = div({ className: classes.centerContainer }).children([
    renderUnitToSpawnPanel(unitToSpawn),
    div({ className: clsx(classes.mapContainer), style: variables }).children([
      renderControlPanel(UNITS_VERTICALLY, unitToSpawn, units, TEAM_1),
      renderGameMap(units),
      renderControlPanel(UNITS_VERTICALLY, unitToSpawn, units, TEAM_2),
    ]),
  ]);

  return layout;
};

export { renderMap };