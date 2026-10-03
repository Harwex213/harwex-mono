import { TERRAIN_LABELS } from "@hw/ostrov-island-system";
import { useSignals } from "@preact/signals-react/runtime";
import { BUILDING_ICONS, TERRAIN_COLORS } from "../palette";
import { useStore } from "../../store/store";
import { ResourceChips } from "./resource-chips";
import type { FC } from "react";
import type { TClearSelectionAction, TDemolishBuildingAction, TUpgradeBuildingAction } from "../../domain/registry";

type TTilePanelRegistrySlice = {
  clearSelectionAction: TClearSelectionAction;
  upgradeBuildingAction: TUpgradeBuildingAction;
  demolishBuildingAction: TDemolishBuildingAction;
};

type TTilePanelProps = {
  registry: TTilePanelRegistrySlice;
};

/** Popup over the board: the selected tile and whatever stands on it. Hidden with no selection. */
const TilePanel: FC<TTilePanelProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const island = store.gameState.island.value;
  const settlement = store.gameState.settlement.value;
  const selectedKey = store.gameState.selectedKey.value;
  const tile = island.tileByKey(selectedKey);

  if (!tile || tile.terrain === null) {
    return null;
  }

  const building = settlement.buildingAt(tile.key);

  return (
    <section className="panel popup">
      <button className="popup__close" type="button" aria-label="Закрыть" onClick={registry.clearSelectionAction}>
        {"×"}
      </button>
      <h2 className="panel__title">
        <span className="swatch" style={{ background: TERRAIN_COLORS[tile.terrain] }} />
        {TERRAIN_LABELS[tile.terrain]}
        {tile.coastal ? <span className="panel__tag">{"берег"}</span> : null}
      </h2>
      <p className="panel__hint">{`Клетка ${tile.q}, ${tile.r}`}</p>

      {building ? (
        <div className="building">
          <div className="building__head">
            <span className="building__icon">{BUILDING_ICONS[building.kind]}</span>
            <span className="building__label">{building.label}</span>
            <span className="building__level">{`ур. ${building.level}/${building.def.maxLevel}`}</span>
          </div>
          <p className="panel__hint">{building.def.description}</p>

          {building.isActive ? (
            <div className="building__row">
              <span className="building__row-label">{"За ход"}</span>
              <ResourceChips amounts={building.production} signed />
              {building.science > 0 ? <span className="chip" data-tip="Очки науки">{`🔬 +${building.science}`}</span> : null}
              {building.housing > 0 ? <span className="chip" data-tip="Жители">{`👥 ${building.housing}`}</span> : null}
            </div>
          ) : (
            <div className="building__row">
              <span className="building__row-label">{"Стройка"}</span>
              <span>{`осталось ${building.turnsLeft} х.`}</span>
            </div>
          )}

          {building.upgradeCost ? (
            <div className="building__row">
              <span className="building__row-label">{"Улучшение"}</span>
              <ResourceChips amounts={building.upgradeCost} />
            </div>
          ) : null}

          <div className="building__actions">
            <button
              className="controls__button controls__button--primary"
              type="button"
              disabled={!settlement.canUpgrade(building)}
              onClick={() => registry.upgradeBuildingAction(tile.key)}
            >
              {"Улучшить"}
            </button>
            <button
              className="controls__button"
              type="button"
              disabled={building.def.unique === true}
              onClick={() => registry.demolishBuildingAction(tile.key)}
            >
              {"Снести"}
            </button>
          </div>
        </div>
      ) : (
        <p className="panel__hint">{"Пусто."}</p>
      )}
    </section>
  );
};

export { TilePanel };
