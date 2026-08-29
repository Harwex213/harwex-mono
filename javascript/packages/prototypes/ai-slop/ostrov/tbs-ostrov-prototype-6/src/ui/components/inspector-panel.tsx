import { useSignals } from "@preact/signals-react/runtime";
import { archetypeOf } from "../../domain/battle/archetypes";
import { useStore } from "../../store/store";

const InspectorPanel = () => {
  useSignals();
  const store = useStore();
  const selectedId = store.rosterState.selectedId.value;
  const unit =
    store.rosterState.player.value.find((candidate) => candidate.id === selectedId) ??
    store.rosterState.enemy.value.find((candidate) => candidate.id === selectedId) ??
    null;

  if (!unit) {
    return (
      <section className="panel">
        <header className="panel__head">
          <h2 className="panel__title">
            {"Карточка"}
          </h2>
        </header>

        <p className="panel__empty">
          {"Щёлкните бойца на поле"}
        </p>
      </section>
    );
  }

  const archetype = archetypeOf(unit.archetypeId);
  const rows: [string, string][] = [
    ["Здоровье", `${archetype.maxHp}`],
    ["Урон", `${archetype.damage}`],
    ["Броня", `${archetype.armor}`],
    ["Дальность", `${archetype.range}`],
    ["Удар раз в", `${archetype.attackInterval.toFixed(1)} с`],
    ["Скорость", `${archetype.speed}`],
  ];

  if (archetype.heal > 0) {
    rows.push(["Лечение", `${archetype.heal} в ${archetype.supportRange} радиусе`]);
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className={unit.team === "player" ? "panel__title" : "panel__title panel__title--enemy"}>
          {archetype.name}
        </h2>

        <span className="panel__tag">
          {unit.team === "player" ? "наш" : "враг"}
        </span>
      </header>

      <dl className="specs">
        {rows.map(([label, value]) => (
          <div key={label} className="specs__row">
            <dt className="specs__label">
              {label}
            </dt>

            <dd className="specs__value">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="panel__note">
        {archetype.blurb}
      </p>
    </section>
  );
};

export { InspectorPanel };
