import { useSignals } from "@preact/signals-react/runtime";
import { BUILDING_DEFS, BUILDING_ORDER, canAfford, describeCost } from "../../domain/game/buildings";
import { REFUSAL_LABELS, buildRefusal } from "../../domain/game/rules";
import { RESOURCE_GLYPHS } from "../../domain/game/types";
import { TERRAIN_LABELS } from "../../domain/world/types";
import { useStore } from "../../store/store";
import type { TBuildAction, TPickBuildingAction } from "../../domain/registry";
import type { FC } from "react";

type TBuildMenuRegistrySlice = {
  buildAction: TBuildAction;
  pickBuildingAction: TPickBuildingAction;
};

type TBuildMenuProps = {
  registry: TBuildMenuRegistrySlice;
};

/**
 * The full catalogue, always visible, so the player can see what each terrain is
 * for before owning any of it. An entry builds on the selected tile when it can,
 * and otherwise arms itself for the next click on the map.
 */
const BuildMenu: FC<TBuildMenuProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const world = store.worldState.world.value;
  const buildings = store.gameState.buildings.value;
  const resources = store.gameState.resources.value;
  const victory = store.gameState.victory.value;
  const selectedIndex = store.viewState.selectedIndex.value;
  const pendingKind = store.viewState.pendingKind.value;
  const tile = world.tiles[selectedIndex];

  const handleClick = (kind: typeof BUILDING_ORDER[number]) => {
    const refusal = buildRefusal({
      tile,
      occupant: buildings[selectedIndex] ?? null,
      resources,
      kind,
      victory,
    });

    if (refusal === null) {
      registry.buildAction(selectedIndex, kind);

      return;
    }

    registry.pickBuildingAction(kind);
  };

  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Постройки"}
      </h2>
      <p className="panel__hint">
        {"Клик строит на выбранной клетке. Если нельзя — постройка встаёт «в руку», и следующий клик по подсвеченной клетке поставит её."}
      </p>

      <ul className="build-list">
        {BUILDING_ORDER.map((kind) => {
          const definition = BUILDING_DEFS[kind];
          const refusal = buildRefusal({
            tile,
            occupant: buildings[selectedIndex] ?? null,
            resources,
            kind,
            victory,
          });
          const affordable = canAfford(resources, definition.cost);

          return (
            <li key={kind}>
              <button
                className={[
                  "build-item",
                  pendingKind === kind ? "build-item--armed" : "",
                  affordable ? "" : "build-item--poor",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => handleClick(kind)}
                disabled={victory}
              >
                <span className="build-item__glyph">
                  {definition.glyph}
                </span>

                <span className="build-item__body">
                  <span className="build-item__title">
                    <span className="build-item__label">
                      {definition.label}
                    </span>
                    <span className="build-item__terrain">
                      {TERRAIN_LABELS[definition.terrain]}
                    </span>
                  </span>

                  <span className="build-item__meta">
                    {describeCost(definition.cost).map(([resource, amount]) => (
                      <span className="chip" key={resource}>
                        {`${RESOURCE_GLYPHS[resource]} ${amount}`}
                      </span>
                    ))}
                    <span className="chip">
                      {`⏳ ${definition.buildTurns}`}
                    </span>
                    {definition.workers > 0 && (
                      <span className="chip">
                        {`🧍 ${definition.workers}`}
                      </span>
                    )}
                    {describeCost(definition.yields).map(([resource, amount]) => (
                      <span className="chip chip--yield" key={`yield-${resource}`}>
                        {`${RESOURCE_GLYPHS[resource]} +${amount}`}
                      </span>
                    ))}
                    {definition.housing > 0 && (
                      <span className="chip chip--yield">
                        {`🧍 +${definition.housing} мест`}
                      </span>
                    )}
                    {definition.storage > 0 && (
                      <span className="chip chip--yield">
                        {`📦 +${definition.storage}`}
                      </span>
                    )}
                  </span>

                  <span className="build-item__description">
                    {definition.description}
                  </span>

                  {refusal !== null && (
                    <span className="build-item__refusal">
                      {REFUSAL_LABELS[refusal]}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export { BuildMenu };
