import { useSignals } from "@preact/signals-react/runtime";
import { REROLL_COST } from "../../domain/actions/shop-actions";
import { ROSTER_LIMIT } from "../../domain/game/roster";
import { archetypeOf } from "../../domain/battle/archetypes";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TBuyUnitAction, TRerollShopAction } from "../../domain/registry";

type TShopPanelRegistrySlice = {
  buyUnitAction: TBuyUnitAction;
  rerollShopAction: TRerollShopAction;
};

type TShopPanelProps = {
  registry: TShopPanelRegistrySlice;
};

const ShopPanel: FC<TShopPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const offers = store.shopState.offers.value;
  const gold = store.metaState.gold.value;
  const squadSize = store.rosterState.player.value.length;
  const locked = store.metaState.phase.value !== "prep";

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">
          {"Наём"}
        </h2>

        <button
          className="button button--tiny"
          type="button"
          disabled={locked || gold < REROLL_COST}
          onClick={() => registry.rerollShopAction()}
        >
          {`Обновить · ${REROLL_COST} з.`}
        </button>
      </header>

      <div className="shop">
        {offers.length === 0 && (
          <p className="panel__empty">
            {"Все наёмники разобраны — обновите список"}
          </p>
        )}

        {offers.map((offerId, index) => {
          const archetype = archetypeOf(offerId);
          const affordable = gold >= archetype.cost && squadSize < ROSTER_LIMIT;

          return (
            <button
              key={`${offerId}-${index}`}
              className="card"
              type="button"
              disabled={locked || !affordable}
              onClick={() => registry.buyUnitAction(index)}
            >
              <span className="card__head">
                <span className="card__name">
                  {archetype.name}
                </span>

                <span className="card__cost">
                  {`${archetype.cost} з.`}
                </span>
              </span>

              <span className="card__role">
                {archetype.role}
              </span>

              <span className="card__stats">
                {`${archetype.maxHp} хп · ${archetype.damage} урон · ${archetype.range} дист.`}
              </span>

              <span className="card__blurb">
                {archetype.blurb}
              </span>
            </button>
          );
        })}
      </div>

      <p className="panel__note">
        {`Отряд: ${squadSize} из ${ROSTER_LIMIT}`}
      </p>
    </section>
  );
};

export { ShopPanel };
