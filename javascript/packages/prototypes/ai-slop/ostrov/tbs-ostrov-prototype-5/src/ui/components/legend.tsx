import { useSignals } from "@preact/signals-react/runtime";
import { TERRAIN_LABELS } from "../../domain/world/types";
import { LEGEND_ORDER, TERRAIN_STYLES } from "../render/palette";
import { useStore } from "../../store/store";
import type { TSetHexSizeAction, TToggleYieldsAction } from "../../domain/registry";
import type { ChangeEvent, FC } from "react";

type TLegendRegistrySlice = {
  setHexSizeAction: TSetHexSizeAction;
  toggleYieldsAction: TToggleYieldsAction;
};

type TLegendProps = {
  registry: TLegendRegistrySlice;
};

const Legend: FC<TLegendProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const hexSize = store.viewState.hexSize.value;
  const showYields = store.viewState.showYields.value;

  const handleSize = (event: ChangeEvent<HTMLInputElement>) => {
    registry.setHexSizeAction(Number(event.target.value));
  };

  return (
    <div className="legend">
      <div className="legend__terrains">
        {LEGEND_ORDER.map((terrain) => (
          <span className="legend__item" key={terrain}>
            <span className="legend__swatch" style={{ background: TERRAIN_STYLES[terrain].fill }} />
            {TERRAIN_LABELS[terrain]}
          </span>
        ))}
      </div>

      <label className="legend__control">
        {"Масштаб"}
        <input type="range" min={14} max={40} step={1} value={hexSize} onChange={handleSize} />
      </label>

      <label className="legend__control">
        <input type="checkbox" checked={showYields} onChange={registry.toggleYieldsAction} />
        {"Показывать постройки"}
      </label>
    </div>
  );
};

export { Legend };
