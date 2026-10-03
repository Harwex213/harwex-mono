import { useMemo } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { archetypeOf } from "../../domain/battle/archetypes";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TSelectUnitAction, TSellUnitAction } from "../../domain/registry";
import type { TRosterUnit } from "../../domain/battle/types";

type TSquadPanelRegistrySlice = {
  selectUnitAction: TSelectUnitAction;
  sellUnitAction: TSellUnitAction;
};

type TSquadPanelProps = {
  registry: TSquadPanelRegistrySlice;
};

const SquadPanel: FC<TSquadPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const roster = store.rosterState.player.value;
  const enemy = store.rosterState.enemy.value;
  const selectedId = store.rosterState.selectedId.value;
  const sim = store.battleState.sim.value;
  const isPrep = store.metaState.phase.value === "prep";

  // The simulation is mutable, so the battle tick is what re-reads it here.
  const tick = store.battleState.tick.value;
  const healthShares = useMemo(() => {
    const shares = new Map<string, number>();
    if (!sim) {
      return shares;
    }

    for (const fighter of sim.fighters) {
      shares.set(fighter.id, fighter.hp / fighter.maxHp);
    }

    return shares;
  }, [sim, tick]);

  const renderRow = (unit: TRosterUnit, own: boolean) => {
    const archetype = archetypeOf(unit.archetypeId);
    const share = healthShares.get(unit.id) ?? 1;

    return (
      <li key={unit.id} className={unit.id === selectedId ? "roster__row roster__row--on" : "roster__row"}>
        <button className="roster__pick" type="button" onClick={() => registry.selectUnitAction(unit.id)}>
          <span className="roster__name">
            {archetype.name}
          </span>

          <span className="roster__bar">
            <span
              className={own ? "roster__fill roster__fill--player" : "roster__fill roster__fill--enemy"}
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </span>
        </button>

        {own && isPrep && (
          <button className="button button--tiny" type="button" onClick={() => registry.sellUnitAction(unit.id)}>
            {"Продать"}
          </button>
        )}
      </li>
    );
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">
          {"Отряд"}
        </h2>
      </header>

      <ul className="roster">
        {roster.length === 0 && (
          <li className="panel__empty">
            {"Пусто — наймите бойцов"}
          </li>
        )}

        {roster.map((unit) => renderRow(unit, true))}
      </ul>

      <header className="panel__head">
        <h2 className="panel__title panel__title--enemy">
          {"Враг"}
        </h2>
      </header>

      <ul className="roster">
        {enemy.map((unit) => renderRow(unit, false))}
      </ul>
    </section>
  );
};

export { SquadPanel };
