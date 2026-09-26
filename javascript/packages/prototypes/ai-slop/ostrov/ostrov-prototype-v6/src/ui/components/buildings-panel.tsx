import { useSignals } from "@preact/signals-react/runtime";
import { BUILDINGS, canAfford, effectiveCost } from "../../core/buildings";
import { getResource } from "../../core/resources";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TArmBuildingAction } from "../../domain/registry";

type TBuildingsPanelRegistrySlice = {
  armBuildingAction: TArmBuildingAction;
};

type TBuildingsPanelProps = {
  registry: TBuildingsPanelRegistrySlice;
};

/**
 * The building cards. Clicking one arms it; the next click on a hex of the
 * island places it. The armed card stays armed so several hexes can be filled
 * in a row. The price only shows on hover, so the row stays readable.
 */
const BuildingsPanel: FC<TBuildingsPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const pool = store.derived.humanPlayer.value?.resources;
  const armedId = store.ui.armedBuilding.value;
  const locked = store.game.phase.value !== "build" || store.ui.busy.value;
  const discount = store.derived.techEffects.value.stoneDiscount;

  if (!pool) {
    return null;
  }

  return (
    <div className={`panel buildings-panel ${locked ? "panel--locked" : ""}`}>
      {BUILDINGS.map((building) => {
        const affordable = canAfford(pool, building, discount);
        const cost = effectiveCost(building, discount);
        const yields = getResource(building.yields);

        return (
          <button
            key={building.id}
            type="button"
            className={`building-card has-hint ${armedId === building.id ? "building-card--armed" : ""} ${affordable ? "" : "building-card--poor"}`}
            onClick={() => registry.armBuildingAction(building.id)}
          >
            <img className="building-card__art" src={building.art} alt={building.label} />

            <span className="building-card__label">
              {building.label}
            </span>

            <span className="building-card__yield">
              {yields.emoji}
            </span>

            <span className="hint">
              <span className="hint__title">
                {building.label}
              </span>

              <span className="hint__row">
                {`Даёт: ${yields.emoji} ${yields.label}`}
              </span>

              <span className="hint__row">
                {"Цена: "}

                <span className={pool.stone >= cost.stone ? "" : "cost--short"}>
                  {`🪨${cost.stone}`}
                </span>

                <span className={pool.wood >= cost.wood ? "" : "cost--short"}>
                  {`🪵${cost.wood}`}
                </span>

                <span className={pool.hammers >= cost.hammers ? "" : "cost--short"}>
                  {`⚒️${cost.hammers}`}
                </span>
              </span>

              <span className="hint__faces">
                {building.baseFaces.map((item, index) => (
                  <span className="face" key={`${item.amount}-${item.toxicity}-${index}`}>
                    <span className="face__yield">
                      {`${yields.emoji} ${item.amount}`}
                    </span>

                    <span className="face__toxicity">
                      {`☣️ ${item.toxicity}`}
                    </span>
                  </span>
                ))}
              </span>

              <span className="hint__note">
                {"Биом острова добавляет зданию ещё одну грань"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

export { BuildingsPanel };
