import { useSignals } from "@preact/signals-react/runtime";
import { UNITS, UNIT_ORDER } from "../../domain/rules/units";
import { useStore } from "../../store/store";
import type { THireArmyAction } from "../../domain/registry";
import type { FC } from "react";

type TCityPanelRegistrySlice = {
  hireArmyAction: THireArmyAction;
};

type TCityPanelProps = {
  registry: TCityPanelRegistrySlice;
};

const CityPanel: FC<TCityPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();

  const structures = store.gameState.structures.value;
  const faction = store.gameState.factions.value.player;
  const phase = store.gameState.phase.value;
  const outcome = store.gameState.outcome.value;

  const city = structures.find((structure) => structure.kind === "city");
  if (!city) {
    return null;
  }

  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Столица"}
      </h2>

      <div className="structure">
        <span className="structure__name">
          {city.name}
        </span>
        <span className="structure__hp">
          {`${city.hp} / ${city.maxHp}`}
        </span>
      </div>

      <ul className="hire">
        {UNIT_ORDER.map((kind) => {
          const blueprint = UNITS[kind];
          const affordable = faction.gold >= blueprint.cost;
          const blocked = faction.hiredThisTurn || phase !== "player" || outcome !== "playing";

          return (
            <li key={kind} className="hire__item">
              <button
                type="button"
                className="hire__button"
                onClick={() => registry.hireArmyAction(kind)}
                disabled={!affordable || blocked}
              >
                <span className="hire__name">
                  {blueprint.name}
                </span>
                <span className="hire__cost">
                  {`${blueprint.cost} зол.`}
                </span>
              </button>
              <p className="hire__stats">
                {`${blueprint.hp} HP · сила ${blueprint.attack} · ходы ${blueprint.movement} · обзор ${blueprint.sight}`}
              </p>
              <p className="hire__hint">
                {blueprint.hint}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="panel__hint">
        {faction.hiredThisTurn ? "Город уже набрал отряд в этот ход." : "Один отряд за ход."}
      </p>
    </section>
  );
};

export { CityPanel };
