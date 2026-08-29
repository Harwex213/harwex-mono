import { useSignals } from "@preact/signals-react/runtime";
import { UNITS } from "../../domain/rules/units";
import { useStore } from "../../store/store";
import type { TSelectArmyAction } from "../../domain/registry";
import type { FC } from "react";

type TArmyListRegistrySlice = {
  selectArmyAction: TSelectArmyAction;
};

type TArmyListProps = {
  registry: TArmyListRegistrySlice;
};

const ArmyList: FC<TArmyListProps> = ({ registry }) => {
  useSignals();
  const store = useStore();

  const armies = store.gameState.armies.value;
  const visible = store.gameState.visible.value;
  const showFog = store.viewState.showFog.value;
  const selectedArmyId = store.selectionState.selectedArmyId.value;

  const own = armies.filter((army) => army.owner === "player");
  const sighted = armies.filter((army) => army.owner === "enemy" && (!showFog || visible.has(army.key)));

  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Армии"}
      </h2>

      {own.length === 0 ? (
        <p className="panel__empty">
          {"Ни одной армии. Наймите отряд в столице."}
        </p>
      ) : (
        <ul className="roster">
          {own.map((army) => (
            <li key={army.id}>
              <button
                type="button"
                className={`roster__item${army.id === selectedArmyId ? " roster__item--active" : ""}`}
                onClick={() => registry.selectArmyAction(army.id)}
              >
                <span className="roster__name">
                  {UNITS[army.kind].name}
                </span>
                <span className="roster__meta">
                  {`${army.hp}/${army.maxHp} HP · ${army.movementLeft}/${army.movement} ходов`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="roster__enemies">
        {sighted.length === 0
          ? "Врагов в поле зрения нет."
          : `Видно вражеских армий: ${sighted.length} (${sighted.map((army) => UNITS[army.kind].name).join(", ")}).`}
      </p>
    </section>
  );
};

export { ArmyList };
