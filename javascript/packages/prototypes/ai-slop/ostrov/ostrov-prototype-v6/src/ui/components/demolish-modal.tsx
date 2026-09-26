import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import { getBiome } from "../../core/biomes";
import { getBuilding } from "../../core/buildings";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TCancelDemolishAction, TConfirmDemolishAction } from "../../domain/registry";

type TDemolishModalRegistrySlice = {
  cancelDemolishAction: TCancelDemolishAction;
  confirmDemolishAction: TConfirmDemolishAction;
};

type TDemolishModalProps = {
  registry: TDemolishModalRegistrySlice;
};

/**
 * "Вы уверены?" before a building comes down, with the spec's "больше не
 * спрашивать" toggle. The toggle is answered together with the confirmation,
 * so ticking it and then cancelling changes nothing.
 */
const DemolishModal: FC<TDemolishModalProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const hex = store.derived.demolishTargetHex.value;
  const [skipNextTime, setSkipNextTime] = useState(false);

  if (!hex || !hex.building) {
    return null;
  }

  const building = getBuilding(hex.building);

  return (
    <div className="modal-backdrop" onClick={registry.cancelDemolishAction}>
      <div className="panel modal demolish-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">
          {"Вы уверены?"}
        </h2>

        <p className="modal__text">
          {`«${building.label}» на гексе «${getBiome(hex.biome).label}» будет снесён. Токсичность гекса обнулится.`}
        </p>

        <label className="modal__toggle">
          <input
            type="checkbox"
            checked={skipNextTime}
            onChange={(event) => setSkipNextTime(event.target.checked)}
          />

          <span>
            {"Больше не спрашивать"}
          </span>
        </label>

        <div className="modal__buttons">
          <button type="button" className="button button--ghost" onClick={registry.cancelDemolishAction}>
            {"Отмена"}
          </button>

          <button
            type="button"
            className="button button--danger"
            onClick={() => registry.confirmDemolishAction(skipNextTime)}
          >
            {"Снести"}
          </button>
        </div>
      </div>
    </div>
  );
};

export { DemolishModal };
