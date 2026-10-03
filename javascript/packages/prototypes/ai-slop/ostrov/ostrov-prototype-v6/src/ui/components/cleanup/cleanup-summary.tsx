import { useSignals } from "@preact/signals-react/runtime";
import { getBiome } from "../../../core/biomes";
import { ICONS } from "../../../core/icons";
import { getUnit } from "../../../core/units";
import { useStore } from "../../../store/store";
import { Icon } from "../icon";
import type { FC } from "react";
import type { TCleanupOutcome } from "../../../core/cleanup-sim";
import type { TBiomeId } from "../../../core/types";
import type { TUnitId } from "../../../core/units";
import type { TEndPhaseAction } from "../../../domain/registry";

const TITLES: Readonly<Record<TCleanupOutcome, string>> = {
  won: "Уровень зачищен",
  lost: "Остров пал",
  retreated: "Отступление",
  calm: "Море спокойно",
};

const TEXTS: Readonly<Record<TCleanupOutcome, string>> = {
  won: "Все вражеские острова ушли под воду. Захваченные гексы прирастут к острову.",
  lost: "Разрушена последняя постройка. Твердыня лежит в руинах и не приносит дохода, пока её не отстроят. Захваченные в этом бою гексы потеряны, острова врага остаются в клетке.",
  retreated: "Остров ушёл за край карты. Зачищенные острова уже ваши, остальные ждут следующего хода. Кто стоял на чужих островах, остался там.",
  calm: "В этой клетке нет вражеских островов.",
};

const grouped = <T extends string>(items: readonly T[]) => {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  return [...counts.entries()];
};

type TCleanupSummaryRegistrySlice = {
  endPhaseAction: TEndPhaseAction;
};

type TCleanupSummaryProps = {
  registry: TCleanupSummaryRegistrySlice;
};

/** The results of the level, shown before the turn moves on. */
const CleanupSummary: FC<TCleanupSummaryProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const result = store.battle.result.value;

  if (!result) {
    return null;
  }

  const peopleLost = result.lost.reduce((sum, unitId) => sum + getUnit(unitId).upkeep, 0);
  const damagedCount = result.structures.filter((entry) => entry.hp > 0 && entry.hp < entry.startHp).length;

  return (
    <div className="modal-backdrop">
      <div className="panel modal cleanup-summary">
        <h2 className="modal__title">
          {TITLES[result.outcome]}
        </h2>

        <p className="modal__text">
          {TEXTS[result.outcome]}
        </p>

        {result.totalIslands > 0 ? (
          <div className="cleanup-summary__stats">
            <div className="cleanup-summary__stat">
              <span>{"Островов зачищено"}</span>
              <strong>{`${result.clearedIslands} / ${result.totalIslands}`}</strong>
            </div>
            <div className="cleanup-summary__stat">
              <span>{"Врагов убито"}</span>
              <strong>{`${result.kills}`}</strong>
            </div>
            <div className="cleanup-summary__stat">
              <span>{"Гексов к острову"}</span>
              <strong>{`+${result.annexed.length}`}</strong>
            </div>
          </div>
        ) : null}

        {result.razed > 0 || damagedCount > 0 ? (
          <div className="cleanup-summary__section">
            <div className="cleanup-summary__label cleanup-summary__label--danger">
              {`Разрушено построек: ${result.razed}`}
              <span className="cleanup-summary__people">
                {`повреждено: ${damagedCount}`}
              </span>
            </div>
            <p className="cleanup-summary__note">
              {"Разрушенные постройки исчезают с гексов. Повреждённые чинятся сами: +25% прочности в конце каждого хода."}
            </p>
          </div>
        ) : null}

        {result.annexed.length > 0 ? (
          <div className="cleanup-summary__section">
            <div className="cleanup-summary__label">
              {"Новые гексы"}
            </div>
            <div className="cleanup-summary__chips">
              {grouped(result.annexed.map((hex) => hex.biome as TBiomeId)).map(([biome, count]) => (
                <span className="cleanup-summary__chip" key={biome}>
                  <span className="cleanup-summary__swatch" style={{ background: getBiome(biome).color }} />
                  {count > 1 ? `${getBiome(biome).label} ×${count}` : getBiome(biome).label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="cleanup-summary__section">
          <div className="cleanup-summary__label">
            {`Вернулись: ${result.survivors.length}`}
          </div>
          <div className="cleanup-summary__chips">
            {grouped<TUnitId>(result.survivors).map(([kind, count]) => (
              <span className="cleanup-summary__chip" key={kind}>
                <Icon src={getUnit(kind).icon} />
                {`${getUnit(kind).label} ×${count}`}
              </span>
            ))}
          </div>
        </div>

        {result.lost.length > 0 ? (
          <div className="cleanup-summary__section">
            <div className="cleanup-summary__label cleanup-summary__label--danger">
              {`Погибли: ${result.lost.length}`}
              <span className="cleanup-summary__people">
                <Icon src={ICONS.population} />
                {`−${peopleLost}`}
              </span>
            </div>
            <div className="cleanup-summary__chips">
              {grouped<TUnitId>(result.lost).map(([kind, count]) => (
                <span className="cleanup-summary__chip cleanup-summary__chip--lost" key={kind}>
                  <Icon src={getUnit(kind).icon} />
                  {`${getUnit(kind).label} ×${count}`}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="modal__buttons">
          <button type="button" className="button button--primary" onClick={registry.endPhaseAction}>
            {"Следующий ход"}
          </button>
        </div>
      </div>
    </div>
  );
};

export { CleanupSummary };
