import { useSignals } from "@preact/signals-react/runtime";
import { LINK_TRADE_GOLD } from "../../domain/world/resources";
import { TERRAIN_COLORS } from "../palette";
import { TERRAIN_LABELS, TERRAIN_LIST } from "../../domain/island/terrain";
import { linkedIdsOf } from "../../domain/world/world";
import { useStore } from "../../store/store";
import type { FC } from "react";

/** Side panel: the selected island, its ground, its bridges, and the log. */
const IslandPanel: FC = () => {
  useSignals();

  const store = useStore();
  const world = store.gameState.world.value;
  const selectedId = store.gameState.selectedIslandId.value;
  const log = store.gameState.log.value;
  const selected = world.islands.find((entry) => entry.id === selectedId) ?? null;

  return (
    <aside className="side">
      {selected ? (
        <section className="panel">
          <h2 className="panel__title">
            {selected.island.name}
            <span className={`panel__owner panel__owner--${selected.owner}`}>
              {selected.owner === "player" ? "ваш" : "ничей"}
            </span>
          </h2>
          <p className="panel__hint">{`Клетка ${selected.anchor.q}, ${selected.anchor.r} · ${selected.island.landCount} тайлов`}</p>

          <dl className="stats">
            {TERRAIN_LIST.map((terrain) => (
              <div key={terrain} className="stats__row">
                <dt>
                  <span className="stats__swatch" style={{ background: TERRAIN_COLORS[terrain] }} />
                  {TERRAIN_LABELS[terrain]}
                </dt>
                <dd>{selected.island.counts[terrain]}</dd>
              </div>
            ))}
          </dl>

          <h3 className="panel__subtitle">{"Мосты"}</h3>
          {linkedIdsOf(world, selected.id).length === 0 ? (
            <p className="panel__hint">{"Нет соседей. Подлетите к острову вплотную, и мост наведётся сам."}</p>
          ) : (
            <ul className="links">
              {linkedIdsOf(world, selected.id).map((id) => {
                const other = world.islands.find((entry) => entry.id === id)!;

                return (
                  <li key={id} className="links__row">
                    <span>{other.island.name}</span>
                    <span className="links__trade">{`+${LINK_TRADE_GOLD} 🪙`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <section className="panel">
          <h2 className="panel__title">{"Небо"}</h2>
          <p className="panel__hint">{"Нажмите на остров, чтобы узнать о нём."}</p>
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">{"Летопись"}</h2>
        <ul className="log">
          {log.map((line, index) => (
            <li key={`${index}-${line}`} className={`log__row${index === 0 ? " log__row--new" : ""}`}>
              {line}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
};

export { IslandPanel };
