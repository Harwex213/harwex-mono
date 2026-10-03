import { useSignals } from "@preact/signals-react/runtime";
import { BIOMES, BUILDINGS, BUILDING_ORDER, biomesForBuilding } from "../../core/exports";
import { BUILDING_ART } from "../island-canvas/draw-island";
import { RESOURCE_GLYPHS } from "./hex-popup";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TBuildingId, TResources } from "../../core/exports";
import type { TArmBuildingAction } from "../../domain/registry";

/**
 * Seven cards in one row, `BUILDING_ORDER`, reference `01-spec-image-4.png`.
 * A card the player cannot pay for is greyed and its missing resource is red,
 * but it still arms: the highlighted hexes are a preview, and only the
 * placement itself is refused (plan §3.2).
 */

type TBuildingsPanelRegistrySlice = {
  armBuilding: TArmBuildingAction;
};

type TBuildingsPanelProps = {
  registry: TBuildingsPanelRegistrySlice;
};

type TCostPart = {
  readonly key: string;
  readonly glyph: string;
  readonly amount: number;
  readonly missing: boolean;
};

const costParts = (building: TBuildingId, resources: TResources): readonly TCostPart[] => {
  const cost = BUILDINGS[building].cost;

  return [
    { key: "stone", glyph: RESOURCE_GLYPHS.stone, amount: cost.stone, missing: resources.stone < cost.stone },
    { key: "wood", glyph: RESOURCE_GLYPHS.wood, amount: cost.wood, missing: resources.wood < cost.wood },
    { key: "hammers", glyph: RESOURCE_GLYPHS.hammers, amount: cost.hammers, missing: resources.hammers < cost.hammers },
  ].filter((part) => part.amount > 0);
};

const BuildingsPanel: FC<TBuildingsPanelProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const armed = store.ui.armedBuilding.value;
  const resources = store.game.resources.value;
  const affordable = store.derived.affordable.value;

  return (
    <div className="panel buildings-panel">
      {BUILDING_ORDER.map((building) => {
        const info = BUILDINGS[building];
        const isArmed = armed === building;
        const canPay = affordable[building] === true;
        const classNames = [
          "building-card",
          isArmed ? "building-card--armed" : "",
          canPay ? "" : "building-card--poor",
        ].filter((name) => name !== "").join(" ");

        return (
          <button
            key={building}
            type="button"
            className={classNames}
            data-building={building}
            onClick={() => registry.armBuilding(building)}
          >
            <img className="building-card__art" src={BUILDING_ART[building]} alt={info.nameRu} />

            <span className="building-card__name">
              {info.nameRu}
            </span>

            <span className="building-card__cost">
              {costParts(building, resources).map((part) => {
                return (
                  <span
                    key={part.key}
                    className={part.missing ? "building-card__cost-part building-card__cost-part--missing" : "building-card__cost-part"}
                  >
                    {`${part.glyph}${part.amount}`}
                  </span>
                );
              })}
            </span>

            <span className="building-card__tooltip">
              <span className="building-card__tooltip-title">
                {`${info.nameRu} — ${RESOURCE_GLYPHS[info.produces]}`}
              </span>

              {biomesForBuilding(building).map((biome) => {
                const table = info.yields[biome];

                return (
                  <span key={biome} className="building-card__tooltip-row">
                    <span className="building-card__tooltip-biome">
                      {BIOMES[biome].nameRu}
                    </span>

                    <span className="building-card__tooltip-combo">
                      {table === undefined
                        ? ""
                        : `${RESOURCE_GLYPHS[info.produces]} ${table.amount} ${RESOURCE_GLYPHS.toxicity} ${table.toxicity}`}
                    </span>
                  </span>
                );
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export type { TBuildingsPanelRegistrySlice };
export { BuildingsPanel };
